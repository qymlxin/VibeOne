import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export async function host(t, environment = {}) {
  const directory = await mkdtemp(join(tmpdir(), "vibeone-feature-"));
  const child = spawn(resolve("target/debug/vibeone-host"), ["serve", "--data-dir", directory], { stdio: "ignore", env: {...process.env, ...environment} });
  const exited = once(child, "exit");
  let connection;
  t.after(async () => {
    if (connection) await fetch(`${connection.url}/v1/host/stop`, { method: "POST", headers: { Authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(2500) }).catch(() => {});
    const kill = setTimeout(() => child.kill("SIGKILL"), 8500);
    await exited; clearTimeout(kill);
    await rm(directory, { recursive: true, force: true });
  });
  for (let i = 0; i < 150; i++) {
    try { connection = JSON.parse(await readFile(join(directory, "host.json"), "utf8")); break; } catch { await sleep(30); }
  }
  assert.ok(connection, "Host must start");
  async function call(path, body, ok = true, token = connection.token) {
    const response = await fetch(`${connection.url}/v1${path}`, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.equal(response.ok, ok, result.error); return result;
  }
  async function wait(id, predicate) {
    let latest;
    for (let i = 0; i < 240; i++) {
      const session = (await call("/snapshot")).sessions.find(item => item.id === id);
      latest=session;
      if (predicate(session)) return session;
      await sleep(30);
    }
    throw Error(`Session condition timed out: ${JSON.stringify({status:latest?.status,error:latest?.error,inputs:latest?.inputs?.length})}`);
  }
  return { directory, connection, call, wait };
}
