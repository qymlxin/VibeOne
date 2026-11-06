import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

test("SQLite restores history after a crash without replaying runs or approvals", { timeout: 45_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "vibeone-recovery-"));
  let child, exited, connection;
  t.after(async () => {
    if (child?.exitCode === null && child?.signalCode === null) child.kill("SIGKILL");
    await exited;
    await rm(directory, { recursive: true, force: true });
  });
  async function start() {
    child = spawn(resolve("target/debug/vibeone-host"), ["serve", "--data-dir", directory], { stdio: "ignore" });
    exited = once(child, "exit");
    for (let i = 0; i < 200; i++) {
      try {
        const record = JSON.parse(await readFile(join(directory, "host.json"), "utf8"));
        if (record.pid === child.pid && (await fetch(`${record.url}/v1/health`, { headers: { Authorization: `Bearer ${record.token}` } })).ok) {
          connection = record;
          return;
        }
      } catch {}
      await sleep(30);
    }
    throw Error("Host failed to start");
  }
  async function request(path, body, ok = true) {
    const response = await fetch(`${connection.url}/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    assert.equal(response.ok, ok, result.error);
    return result;
  }
  async function waitFor(id, predicate) {
    for (let i = 0; i < 200; i++) {
      const session = (await request("/snapshot")).sessions.find(item => item.id === id);
      if (predicate(session)) return session;
      await sleep(30);
    }
    throw Error("Expected session state did not arrive");
  }
  await start();
  const { id } = await request("/sessions", { provider: "demo", workspace: directory });
  const empty = await request("/sessions", { provider: "demo", workspace: directory });
  await request(`/sessions/${id}/metadata`, { title: "保留的会话" });
  await request(`/sessions/${id}/messages`, { text: "/approve" });
  const pending = await waitFor(id, session => session.approvals.length === 1);
  const approval = pending.approvals[0].id;
  await request(`/sessions/${id}/approvals/${approval}`, { option: "nonexistent" }, false);
  assert.equal((await request("/snapshot")).sessions.find(item => item.id === id).approvals.length, 1);
  const oldToken = connection.token;
  child.kill("SIGKILL");
  await exited;
  await start();
  assert.ok(oldToken !== connection.token, "Host credentials rotate after restart");
  const snapshot = await request("/snapshot");
  assert.equal(snapshot.persistent, true);
  assert.equal(snapshot.workspaces.length, 1);
  const restored = snapshot.sessions.find(item => item.id === id);
  assert.equal(restored.title, "保留的会话");
  assert.equal(restored.status, "interrupted");
  assert.equal(restored.historyOnly, true);
  assert.equal(restored.approvals.length, 0);
  assert.ok(restored.messages.some(message => message.text.includes("/approve")));
  await request(`/sessions/${id}/messages`, { text: "do not replay" }, false);
  await request(`/sessions/${id}/approvals/${approval}`, { option: "allow" }, false);
  await request(`/sessions/${id}/metadata`, { archived: true });
  await request(`/sessions/${empty.id}/messages`, { text: "fresh execution" });
  await waitFor(empty.id, session => session.stopReason === "end_turn");
  await request("/host/stop", {});
  await exited;
  // The upgrade import is idempotent: an older snapshot cannot overwrite SQLite.
  await writeFile(join(directory, "legacy-snapshot.json"), JSON.stringify({ sessions: [pending] }));
  await start();
  const final = (await request("/snapshot")).sessions;
  assert.equal(final.find(item => item.id === id).archived, true);
  assert.equal(final.find(item => item.id === empty.id).historyOnly, true);
  assert.equal(final.find(item => item.id === id).messages.length, restored.messages.length);
  await request("/host/stop", {});
  await exited;
});
