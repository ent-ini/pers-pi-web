// Run in an isolated checkout: node e2e/corporate-models.mjs.
// All APIs are intercepted in a fresh browser context: no BPM users or secrets.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = process.env.TEST_ARTIFACTS || await mkdtemp(join(tmpdir(), "pi-web-corporate-models-"));
await mkdir(artifacts, { recursive: true });
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-model-fixture-"));
const probe = createServer().listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const mode = process.env.E2E_SERVER_MODE || "dev";
assert.ok(mode === "dev" || mode === "start", "E2E_SERVER_MODE must be dev or start");
const server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), mode, "-H", "127.0.0.1", "-p", String(port)], {
  cwd: root,
  env: { ...process.env, PI_WEB_MODE: "single", PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
const log = createWriteStream(join(artifacts, "server.log"));
server.stdout.pipe(log); server.stderr.pipe(log);
let browser;
try {
  const deadline = Date.now() + 120_000;
  while (!(await fetch(`${base}/admin`).catch(() => null))?.ok) {
    assert.ok(Date.now() < deadline && server.exitCode === null, "Server not ready; see server.log");
    await delay(300);
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU", reducedMotion: "reduce" });
  let allowPersonalModels = true;
  let failPolicy = false;
  let config = { providers: {}, revision: "fixture-1" };
  const requests = [];
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push(path);
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/multi/auth/session") return json({ user: { fullName: "Тестовый администратор", role: "admin" } });
    if (path === "/api/multi/admin/users") return json({ users: [], workerAvailable: true });
    if (path === "/api/multi/admin/template/tree") return json({ entries: [], revision: "template-fixture" });
    if (path === "/api/multi/admin/model-settings") {
      if (request.method() === "PATCH") {
        if (failPolicy) return json({ error: "Тестовый отказ сохранения" }, 503);
        allowPersonalModels = request.postDataJSON().allowPersonalModels;
      }
      return json({ allowPersonalModels });
    }
    if (path === "/api/multi/admin/models-config/presets") return json({ presets: [{ id: "fixture", displayName: "Тестовый провайдер", provider: { api: "openai-completions", baseUrl: "https://provider.example.invalid/v1", models: [{ id: "fixture-model", name: "Fixture model" }] } }] });
    if (path === "/api/multi/admin/models-config") {
      if (request.method() === "PUT") {
        const data = request.postDataJSON();
        assert.equal(data.revision, config.revision);
        config = { ...data, revision: "fixture-2" };
        for (const provider of Object.values(config.providers)) if (provider.apiKey) provider.apiKey = "retain:opaque-fixture";
      }
      return json(config);
    }
    if (path === "/api/multi/admin/models-config/discover") return json({ models: [{ id: "new-fixture-model", name: "Новая тестовая модель" }], endpoint: "https://provider.example.invalid/v1/models" });
    if (path === "/api/multi/admin/models-config/test") return json({ ok: true, latencyMs: 1, responseText: "OK" });
    return json({ error: `Unexpected API: ${path}` }, 500);
  });
  await page.goto(`${base}/admin`);
  await page.getByRole("button", { name: "Модели", exact: true }).click();
  const policy = page.getByRole("switch", { name: "Разрешить сотрудникам подключать собственные модели" });
  await policy.waitFor();
  await assert.doesNotReject(() => policy.waitFor({ state: "visible" }));
  await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "true");
  failPolicy = true;
  await policy.click();
  await page.getByRole("alert").filter({ hasText: "Тестовый отказ сохранения" }).waitFor();
  assert.equal(await policy.getAttribute("aria-checked"), "true", "failed save must not change the switch");
  failPolicy = false;
  await policy.click();
  await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "false");
  await page.reload();
  await page.getByRole("button", { name: "Модели", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "false");
  await page.getByRole("button", { name: /Добавить провайдера/ }).click();
  await page.getByRole("button", { name: /Тестовый провайдер/ }).click();
  const key = page.locator('input[aria-label="API Key"]');
  await key.fill("ephemeral-fixture-key-not-a-credential");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="API Key"]')?.placeholder.includes("Ключ сохранён"));
  assert.equal(await key.inputValue(), "", "saved credentials must not remain in the input");
  assert.equal(config.providers.fixture.models[0].id, "fixture-model");
  assert.equal(config.providers.fixture.apiKey, "retain:opaque-fixture");
  await page.screenshot({ path: join(artifacts, "models-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: /Импортировать модели/ }).click();
  await page.getByText("Новая тестовая модель", { exact: true }).waitFor();
  assert.ok(requests.includes("/api/multi/admin/models-config/discover"));
  assert.ok(!requests.some((path) => path.startsWith("/api/auth/") || path === "/api/models/enabled" || path === "/api/models-config"), "corporate editor must never read personal providers");
  await page.getByRole("button", { name: "Включить тёмную тему" }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await delay(250);
  await page.screenshot({ path: join(artifacts, "models-mobile-dark.png"), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, "mobile page must not overflow horizontally");
  assert.deepEqual(errors, []);
  await context.close();
  console.log(`Corporate model UI smoke passed. Artifacts: ${artifacts}`);
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    await exited;
  }
  log.end();
  await rm(agentDir, { recursive: true, force: true });
}
