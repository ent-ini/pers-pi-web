import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
const { nameCorporateSession, cleanCorporateSessionTitle } = await createJiti(import.meta.url).import("./corporate-auto-name.ts");
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const reply = () => ({ role: "assistant", api: "openai-completions", provider: "corp-company", model: "naming", timestamp: Date.now(), content: [{ type: "text", text: "Настройка бухгалтерского рабочего чата" }], usage, stopReason: "stop" });

async function fixture(run) {
  const root = mkdtempSync(`${tmpdir()}/company-naming-`);
  const previous = process.env.PI_WEB_MODEL_SNAPSHOT;
  const snapshot = `${root}/snapshot.json`;
  const policy = { version: 1, revision: "1", allowPersonalModels: false, namingModel: { provider: "corp-company", modelId: "naming" }, providers: { "corp-company": { apiKey: "gateway-token-not-vendor-key", baseUrl: "http://gateway", models: [{ id: "chat" }, { id: "naming" }] } } };
  const savePolicy = () => writeFileSync(snapshot, JSON.stringify(policy));
  savePolicy();
  process.env.PI_WEB_MODEL_SNAPSHOT = snapshot;
  const sm = SessionManager.create(root, `${root}/sessions`);
  let complete = async () => reply();
  const requests = [];
  const model = { id: "naming", provider: "corp-company", api: "openai-completions", reasoning: false };
  const target = {
    alive: true, running: false,
    isAlive() { return this.alive; }, isRunning() { return this.running; },
    inner: {
      sessionId: sm.getSessionId(), sessionManager: sm,
      setSessionName(title) { this.sessionManager.appendSessionInfo(title); },
      modelRuntime: { getModel(provider, id) { assert.equal(provider, "corp-company"); assert.equal(id, "naming"); return model; }, completeSimple(chosen, context, options) { requests.push({ chosen, context, options }); return complete(); } },
    },
  };
  function turn() {
    target.inner.sessionManager.appendMessage({ role: "user", content: "Помоги настроить бухгалтерский чат", timestamp: Date.now() });
    target.inner.sessionManager.appendMessage(reply());
  }
  try { await run({ sm, target, requests, turn, policy, savePolicy, setComplete(value) { complete = value; }, reopen() { target.inner.sessionManager = SessionManager.open(sm.getSessionFile()); } }); }
  finally { if (previous === undefined) delete process.env.PI_WEB_MODEL_SNAPSHOT; else process.env.PI_WEB_MODEL_SNAPSHOT = previous; rmSync(root, { recursive: true, force: true }); }
}

test("naming uses its own model, no tools/agent, personal 2/6/16 thresholds survive resume", async () => fixture(async ({ sm, target, turn, requests, reopen }) => {
  for (let count = 2; count <= 18; count += 2) {
    turn();
    await nameCorporateSession(target);
    assert.equal(requests.length, count < 6 ? 1 : count < 16 ? 2 : 3);
    if (count === 2) reopen();
  }
  assert.equal(target.inner.sessionManager.getSessionName(), "Настройка бухгалтерского рабочего чата");
  for (const { chosen, context } of requests) {
    assert.equal(chosen.id, "naming");
    assert.equal(context.tools, undefined);
    assert.equal(context.messages.length, 1);
    assert.equal(context.messages[0].role, "user");
    assert.match(context.systemPrompt, /на русском/);
  }
  assert.equal(sm.getEntries().filter((entry) => entry.type === "message").length, 2, "reopened SessionManager, not a competing old instance, owns later appends");
}));

test("thinking/tool-only replies do not count or enter naming context", async () => fixture(async ({ sm, target, requests }) => {
  sm.appendMessage({ role: "user", content: "Подготовить отчёт", timestamp: Date.now() });
  sm.appendMessage({ ...reply(), content: [{ type: "thinking", thinking: "THINKING_SECRET" }, { type: "toolCall", id: "t", name: "bash", arguments: { text: "TOOL_SECRET" } }] });
  await nameCorporateSession(target);
  assert.equal(requests.length, 0);
  sm.appendMessage({ role: "toolResult", toolCallId: "t", toolName: "bash", content: [{ type: "text", text: "TOOL_SECRET" }], isError: false, timestamp: Date.now() });
  sm.appendMessage(reply());
  await nameCorporateSession(target);
  assert.equal(requests.length, 1);
  assert.doesNotMatch(JSON.stringify(requests[0].context), /THINKING_SECRET|TOOL_SECRET/);
}));

test("same-text manual rename is protected after restart", async () => fixture(async ({ sm, target, turn, requests, reopen }) => {
  turn(); await nameCorporateSession(target);
  sm.appendSessionInfo(sm.getSessionName());
  reopen(); turn(); turn();
  await nameCorporateSession(target);
  assert.equal(requests.length, 1);
}));

test("single flight; an in-flight manual rename or disposal wins", async () => fixture(async ({ sm, target, turn, requests, setComplete }) => {
  turn(); let release;
  setComplete(() => new Promise((resolve) => { release = resolve; }));
  const pending = nameCorporateSession(target);
  const duplicate = nameCorporateSession(target);
  await assert.rejects(nameCorporateSession(target, false), /уже генерируется/);
  assert.equal(requests.length, 1);
  sm.appendSessionInfo("Моё ручное название");
  release(reply()); await pending; await duplicate;
  assert.equal(sm.getSessionName(), "Моё ручное название");
  const manual = nameCorporateSession(target, false);
  target.alive = false; release(reply());
  await assert.rejects(manual, /изменились/);
  assert.equal(sm.getSessionName(), "Моё ручное название");
}));

test("errors do not leak or retry the same completed turn; later turn can retry", async () => fixture(async ({ target, turn, requests, setComplete }) => {
  turn(); setComplete(async () => { throw new Error("vendor-key-secret"); });
  await assert.rejects(nameCorporateSession(target), (error) => /Не удалось/.test(error.message) && !error.message.includes("vendor-key-secret"));
  await nameCorporateSession(target);
  assert.equal(requests.length, 1);
  turn(); setComplete(async () => reply());
  await nameCorporateSession(target);
  assert.equal(requests.length, 2);
}));

test("crash after result marker before name recovers without another paid request", async () => fixture(async ({ target, turn, requests, reopen }) => {
  turn(); const setName = target.inner.setSessionName;
  target.inner.setSessionName = () => { throw new Error("simulated crash"); };
  await assert.rejects(nameCorporateSession(target), /simulated crash/);
  reopen(); target.inner.setSessionName = setName;
  const recovered = await nameCorporateSession(target);
  assert.equal(recovered?.title, "Настройка бухгалтерского рабочего чата");
  assert.equal(requests.length, 1);
}));

test("policy changes during generation discard the result, no fallback chat model", async () => fixture(async ({ target, turn, requests, policy, savePolicy, setComplete }) => {
  turn(); let release; setComplete(() => new Promise((resolve) => { release = resolve; }));
  const pending = nameCorporateSession(target);
  policy.namingModel = null; savePolicy(); release(reply()); await pending;
  assert.equal(target.inner.sessionManager.getSessionName(), undefined);
  assert.equal(await nameCorporateSession(target), null);
  assert.equal(requests.length, 1);
}));

test("overlapping completed turns re-evaluate the newest transcript after the old flight", async () => fixture(async ({ target, turn, requests, setComplete }) => {
  turn(); let release;
  setComplete(() => new Promise((resolve) => { release = resolve; }));
  const first = nameCorporateSession(target);
  turn(); turn();
  nameCorporateSession(target);
  setComplete(async () => reply());
  release(reply()); await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2, "a completed later threshold must not be swallowed by single-flight");
  assert.equal(requests[1].context.messages[0].content.match(/Помоги настроить/g).length, 3);
}));

test("abandoned branches neither trigger nor contaminate naming", async () => fixture(async ({ sm, target, turn, requests }) => {
  turn(); const leaf = sm.getLeafId();
  sm.appendMessage({ role: "user", content: "ABANDONED_BRANCH_SECRET", timestamp: Date.now() }); sm.appendMessage(reply());
  sm.branch(leaf); turn();
  await nameCorporateSession(target);
  assert.equal(requests.length, 1);
  assert.doesNotMatch(JSON.stringify(requests[0].context), /ABANDONED_BRANCH_SECRET/);
  // The active branch has four visible messages, not six.
  await nameCorporateSession(target);
  assert.equal(requests.length, 1);
}));

test("corporate names strip reasoning and stay within four words", () => {
  assert.equal(cleanCorporateSessionTitle("<think>private hidden thought</think>\nНастройка корпоративного чата компании сегодня"), "Настройка корпоративного чата компании");
  assert.throws(() => cleanCorporateSessionTitle("<thinking>private hidden thought"));
});
