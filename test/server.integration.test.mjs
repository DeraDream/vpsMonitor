import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
const auth = `Basic ${Buffer.from("admin:integration-password").toString("base64")}`;

async function waitFor(url, headers) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(url, { headers }); if (response.ok) return response; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("测试服务器未能启动");
}

test("HTTP API 保护、监控任务、失败状态和 Token 加密可以协同工作", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "vps-monitor-test-"));
  const port = 44000 + Math.floor(Math.random() * 1000);
  const seed = {
    providers: [{ id: "demo", name: "Demo Provider", adapterKey: "demo", adapterVersion: "0.1.0", status: "active", lastCheckedAt: null }],
    plans: [{ id: "demo:starter", providerId: "demo", externalId: "starter", name: "Starter", available: false, quantity: null }],
    monitors: [], notifications: [], events: [], runtime: {},
    settings: { telegram: { botToken: "", chatId: "", enabled: false, showQuantity: true, showBuyLink: true, soldoutMode: "edit" }, updates: { repository: "", branch: "main" } }
  };
  await writeFile(join(dataDir, "store.json"), JSON.stringify(seed));
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, ADMIN_PASSWORD: "integration-password", TOKEN_ENCRYPTION_KEY: "integration-encryption-key" },
    stdio: "ignore"
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(`${base}/api/dashboard`, { Authorization: auth });
    const denied = await fetch(`${base}/api/dashboard`);
    assert.equal(denied.status, 401);

    const create = await fetch(`${base}/api/monitors`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ providerId: "demo", scope: "all", enabled: true, intervalSeconds: 30 }) });
    assert.equal(create.status, 201);
    const monitor = await create.json();
    assert.equal(monitor.providerName, "Demo Provider");

    const run = await fetch(`${base}/api/monitors/${monitor.id}/run`, { method: "POST", headers: { Authorization: auth } });
    assert.equal(run.status, 400);
    assert.match((await run.json()).error, /尚未安装/);

    const events = await (await fetch(`${base}/api/events`, { headers: { Authorization: auth } })).json();
    assert.ok(events.some((event) => event.type === "monitor_failed"));

    const settings = await fetch(`${base}/api/settings`, { method: "PUT", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ telegram: { botToken: "123456:real-looking-test-token", chatId: "-1001" } }) });
    assert.equal(settings.status, 200);
    const visible = await settings.json();
    assert.equal(visible.telegram.botTokenConfigured, true);
    assert.equal(Object.hasOwn(visible.telegram, "botToken"), false);

    const stored = await readFile(join(dataDir, "store.json"), "utf8");
    assert.doesNotMatch(stored, /123456:real-looking-test-token/);
    assert.match(stored, /botTokenEncrypted/);
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
});
