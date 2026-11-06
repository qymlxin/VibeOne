import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

test(
  "authenticated Host handles real ACP v2 fixture messages, approval, cancellation and reconnect snapshots",
  { timeout: 25_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "vibeone-host-test-"));
    const child = spawn(
      resolve("target/debug/vibeone-host"),
      ["serve", "--data-dir", directory],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const exited = once(child, "exit");
    let stderr = "";
    let stopped = false;
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    t.after(async () => {
      if (!stopped) child.kill("SIGINT");
      const kill = setTimeout(() => child.kill("SIGKILL"), 8000);
      await exited;
      clearTimeout(kill);
      if (stopped) assert.equal(child.exitCode, 0, stderr);
      await rm(directory, { recursive: true, force: true });
    });
    let connection;
    for (let i = 0; i < 100; i++) {
      try {
        connection = JSON.parse(
          await readFile(join(directory, "host.json"), "utf8"),
        );
        break;
      } catch {
        await sleep(30);
      }
    }
    assert.ok(connection, `Host did not start: ${stderr}`);
    const call = async (path, body) => {
      const response = await fetch(`${connection.url}/v1${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${connection.token}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      assert.ok(response.ok, result.error);
      return result;
    };
    assert.equal((await fetch(`${connection.url}/v1/snapshot`)).status, 401);
    assert.equal(
      (
        await fetch(`${connection.url}/v1/snapshot`, {
          headers: {
            Authorization: `Bearer ${connection.token}`,
            Origin: "https://untrusted.example",
          },
        })
      ).status,
      403,
    );
    const { id } = await call("/sessions", {
      provider: "demo",
      workspace: directory,
    });
    assert.equal((await call("/snapshot")).sessions[0].messages.length, 0);
    const waitFor = async (predicate) => {
      for (let i = 0; i < 120; i++) {
        const session = (await call("/snapshot")).sessions.find(
          (session) => session.id === id,
        );
        if (predicate(session)) return session;
        await sleep(30);
      }
      throw Error("Expected session state did not arrive");
    };
    await call(`/sessions/${id}/messages`, { text: "hello" });
    const completed = await waitFor(
      (session) => session.stopReason === "end_turn",
    );
    assert.equal(
      completed.messages.filter((message) => message.role === "user").length,
      1,
    );
    assert.ok(
      completed.messages
        .find((message) => message.role === "assistant")
        .text.includes("hello"),
    );
    await call(`/sessions/${id}/messages`, { text: "/approve" });
    const attention = await waitFor(
      (session) => session.approvals.length === 1,
    );
    const approval = attention.approvals[0].id;
    await call(`/sessions/${id}/approvals/${approval}`, { option: "allow" });
    const decided = await waitFor(
      (session) =>
        session.stopReason === "end_turn" && !session.approvals.length,
    );
    assert.ok(decided.messages.at(-1).text.includes("允许一次"));
    await call(`/sessions/${id}/messages`, { text: "/wait" });
    await waitFor((session) => session.status === "running");
    await call(`/sessions/${id}/cancel`, {});
    await waitFor((session) => session.stopReason === "cancelled");
    const revisited = await call("/snapshot");
    assert.equal(revisited.protocolVersion, 2);
    assert.ok(revisited.sessions[0].messages.length >= 4);
    await call("/host/stop", {});
    stopped = true;
  },
);
