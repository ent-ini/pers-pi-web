// Run against an isolated build/server, never a live employee session.
// E2E_BASE_URL=http://localhost:30144 node e2e/multiuse-admin-reset.mjs
// Optional: E2E_CDP_URL for an existing Chromium; always uses a new context.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = process.env.E2E_CDP_URL
  ? await chromium.connectOverCDP(process.env.E2E_CDP_URL)
  : await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
try {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const id = "2b0b19f0-7a39-4e85-8c08-886cefc3dac1";
  const revision = "b".repeat(64);
  let resets = 0;
  let fail = false;
  let releaseReset;
  await page.route("**/api/multi/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path.endsWith("/auth/session")) body = { user: { fullName: "Администратор", role: "admin" } };
    else if (path.endsWith("/admin/users")) body = { workerAvailable: true, users: [
      { id, name: "Тестовый сотрудник", email: "test@example.test", role: "employee", status: "active", worker: "running", workspaceTemplate: { revision: "a".repeat(64), appliedAt: new Date().toISOString(), trackedFiles: 1 } },
      { id: "3b0b19f0-7a39-4e85-8c08-886cefc3dac1", name: "Новый сотрудник", email: "new@example.test", role: "employee", status: "active", worker: "not-created" },
    ] };
    else if (path.endsWith("/template/tree")) body = { entries: [{ path: "AGENTS.md", type: "file" }], revision };
    else if (path.endsWith("/template/file")) body = { content: "Шаблон v2" };
    else if (path.endsWith("/reset-workspace")) {
      resets++;
      await new Promise((resolve) => { releaseReset = resolve; });
      if (fail) return route.fulfill({ status: 409, json: { error: "Конфликт с личным файлом «отчёт.txt»" } });
      body = { ok: true, worker: "running", revision, appliedAt: new Date().toISOString(), trackedFiles: 1, legacy: false };
    } else throw new Error(`Unexpected API request: ${path}`);
    await route.fulfill({ json: body });
  });
  await page.goto(`${process.env.E2E_BASE_URL || "http://127.0.0.1:30144"}/admin`);
  await page.getByText("Есть изменения · файлов: 1").waitFor();
  const buttons = page.getByRole("button", { name: "Пересоздать workspace", exact: true });
  assert.equal(await buttons.count(), 2);
  assert.equal(await buttons.nth(1).isDisabled(), true);
  page.once("dialog", (dialog) => dialog.dismiss());
  await buttons.first().click();
  assert.equal(resets, 0);
  page.once("dialog", (dialog) => { assert.match(dialog.message(), /Личные файлы/); return dialog.accept(); });
  await buttons.first().click();
  await page.getByRole("button", { name: "Пересоздаём…" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Пересоздаём…" }).isDisabled(), true);
  assert.equal(resets, 1);
  releaseReset();
  await page.getByRole("status").filter({ hasText: "пересоздан" }).waitFor();
  await page.getByText("Актуальный · файлов: 1").waitFor();
  fail = true;
  page.once("dialog", (dialog) => dialog.accept());
  await buttons.first().click();
  await page.getByRole("button", { name: "Пересоздаём…" }).waitFor();
  releaseReset();
  await page.getByRole("alert").filter({ hasText: "Конфликт с личным файлом" }).waitFor();
  assert.equal(await buttons.first().isEnabled(), true);
  await page.getByRole("button", { name: "Файлы по умолчанию" }).click();
  await page.getByText("Версия:").waitFor();
  await page.getByRole("button", { name: "AGENTS.md" }).click();
  await page.getByText("Шаблон v2").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Включить тёмную тему" }).click();
  assert.deepEqual(errors, []);
  console.log("PASS: confirm/cancel, pending, success/revision, conflict/retry, template preview, mobile/dark, no page errors");
} finally {
  await context.close();
  await browser.close();
}
