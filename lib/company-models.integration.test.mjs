import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": new URL("..", import.meta.url).pathname } });
const { nameCorporateSession } = await jiti.import("./corporate-auto-name.ts");
const { PATCH } = await jiti.import("../app/api/sessions/[id]/route.ts");
const { startRpcSession, AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { readSessionInfo, attachSessionProjectInfo } = await jiti.import("./session-reader.ts");
const { sessionDisplayTitle } = await jiti.import("./session-fork-name.ts");
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const reply = { role: "assistant", content: [{ type: "text", text: "Настройка корпоративного рабочего чата" }], api: "openai-completions", provider: "corp-company", model: "other", timestamp: Date.now(), usage, stopReason: "stop" };

async function fixture(run) {
  const root = mkdtempSync(`${tmpdir()}/company-models-integration-`);
  const old = { snapshot: process.env.PI_WEB_MODEL_SNAPSHOT, agent: process.env.PI_CODING_AGENT_DIR };
  const agent = `${root}/agent`; mkdirSync(agent);
  writeFileSync(`${agent}/settings.json`, JSON.stringify({ defaultProvider: "personal", defaultModel: "own", enabledModels: ["corp-company/other"] }));
  const snapshot = `${root}/snapshot.json`;
  const policy = { version: 1, revision: "1", allowPersonalModels: false, defaultModel: { provider: "corp-company", modelId: "chat" }, namingModel: null, providers: { "corp-company": { api: "openai-completions", apiKey: "fixture-gateway-token", baseUrl: "http://127.0.0.1:1/gateway/v1", models: ["chat", "other", "naming"].map((id) => ({ id, name: id, contextWindow: 8192, maxTokens: 256, input: ["text"], reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })) } } };
  const savePolicy = () => writeFileSync(snapshot, JSON.stringify(policy)); savePolicy();
  process.env.PI_WEB_MODEL_SNAPSHOT = snapshot; process.env.PI_CODING_AGENT_DIR = agent;
  const wrappers = [];
  try { await run({ root, agent, policy, savePolicy, wrappers }); }
  finally {
    for (const wrapper of wrappers) wrapper.destroy();
    if (old.snapshot === undefined) delete process.env.PI_WEB_MODEL_SNAPSHOT; else process.env.PI_WEB_MODEL_SNAPSHOT = old.snapshot;
    if (old.agent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old.agent;
    rmSync(root, { recursive: true, force: true });
  }
}

test("real SDK fresh sessions use company default; explicit and restored choices survive", async () => fixture(async ({ root, wrappers }) => {
  const fresh = (await startRpcSession("new-default", "", root)).session; wrappers.push(fresh);
  assert.equal(fresh.inner.model.id, "chat");
  const explicit = (await startRpcSession("new-explicit", "", root, { initialModel: { provider: "corp-company", modelId: "other" } })).session; wrappers.push(explicit);
  assert.equal(explicit.inner.model.id, "other");
  const disk = SessionManager.create(root, `${root}/sessions`);
  disk.appendModelChange("corp-company", "other");
  disk.appendMessage({ role: "user", content: "История с другим выбором", timestamp: Date.now() }); disk.appendMessage(reply);
  const restored = (await startRpcSession(disk.getSessionId(), disk.getSessionFile(), root)).session; wrappers.push(restored);
  assert.equal(restored.inner.model.id, "other");
}));

test("actual sidebar PATCH beats a pending automatic title", async () => fixture(async ({ root, policy, savePolicy, wrappers }) => {
  const wrapper = (await startRpcSession("sidebar-name-race", "", root)).session; wrappers.push(wrapper);
  await wrapper.waitUntilReady();
  const target = { inner: wrapper.inner, isAlive: () => wrapper.isAlive(), isRunning: () => wrapper.isRunning() };
  await nameCorporateSession(target); // drain startup's disabled no-op flight
  const sm = wrapper.inner.sessionManager;
  sm.appendMessage({ role: "user", content: "Тема чата", timestamp: Date.now() }); sm.appendMessage(reply);
  policy.namingModel = { provider: "corp-company", modelId: "naming" }; savePolicy();
  let release;
  wrapper.inner.modelRuntime.completeSimple = () => new Promise((resolve) => { release = resolve; });
  const pending = nameCorporateSession(target);
  const response = await PATCH(new Request(`http://localhost/api/sessions/${wrapper.sessionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Название вручную через сайдбар" }) }), { params: Promise.resolve({ id: wrapper.sessionId }) });
  assert.equal(response.status, 200);
  release(reply); await pending;
  assert.equal(SessionManager.open(sm.getSessionFile()).getSessionName(), "Название вручную через сайдбар");
}));

test("run-completion hook names without a browser and pending disk/runtime titles stay stable", async () => fixture(async ({ root, policy, savePolicy, wrappers }) => {
  policy.namingModel = { provider: "corp-company", modelId: "naming" }; savePolicy();
  const sm = SessionManager.create(root, `${root}/sessions`);
  sm.appendMessage({ role: "user", content: "PRIVATE_FIRST_PROMPT", timestamp: Date.now() }); sm.appendMessage(reply);
  const info = await readSessionInfo(sm.getSessionFile());
  assert.equal(info.awaitingName, true);
  assert.equal(sessionDisplayTitle(info), "Новая сессия");
  assert.equal((await attachSessionProjectInfo([info]))[0].name, undefined, "placeholder is not a stored name");
  let listener; let resolveName;
  const named = new Promise((resolve) => { resolveName = resolve; });
  let requests = 0;
  const inner = {
    sessionId: sm.getSessionId(), sessionFile: sm.getSessionFile(), sessionManager: sm,
    agent: { state: { messages: [] } }, isStreaming: false, isCompacting: false, isBashRunning: false,
    subscribe(fn) { listener = fn; return () => {}; }, dispose() {},
    setSessionName(title) { sm.appendSessionInfo(title); resolveName(title); },
    modelRuntime: { getModel(provider, id) { return { provider, id, reasoning: false }; }, async completeSimple(model) { assert.equal(model.id, "naming"); requests++; return reply; } },
  };
  const wrapper = new AgentSessionWrapper(inner); wrappers.push(wrapper); wrapper.start();
  listener({ type: "agent_start" }); listener({ type: "agent_settled", aborted: false });
  assert.equal(requests, 1, "server lifecycle, not a frontend auto-name POST, launches naming");
  assert.equal(await named, "Настройка корпоративного рабочего чата");
  const updated = await readSessionInfo(sm.getSessionFile());
  assert.equal(updated.awaitingName, false);
  assert.equal(sessionDisplayTitle(updated), "Настройка корпоративного рабочего чата");
}));
