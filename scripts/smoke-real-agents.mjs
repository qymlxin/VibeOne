// Explicit manual smoke check; never run real model calls in the default test suite.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
const data = await mkdtemp(join(tmpdir(), "vibeone-real-host-"));
const workspace = await mkdtemp(join(tmpdir(), "vibeone-real-workspace-"));
const host = spawn(
  resolve("target/debug/vibeone-host"),
  ["serve", "--data-dir", data],
  { stdio: "ignore" },
);
const exited = once(host, "exit");
let connection;
const reports = [];
try {
  for (let i = 0; i < 100; i++) {
    try {
      connection = JSON.parse(await readFile(join(data, "host.json"), "utf8"));
      break;
    } catch {
      await sleep(50);
    }
  }
  if (!connection) throw Error("Host did not start");
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
    if (!response.ok) throw Error(result.error);
    return result;
  };
  for (const provider of process.argv.slice(2).length
    ? process.argv.slice(2)
    : ["codex", "claude"]) {
    const { id } = await call("/sessions", { provider, workspace });
    await call(`/sessions/${id}/messages`, {
      text: "Reply with exactly VIBEONE_ACP_V2_OK. Do not use any tools or read or modify any files.",
    });
    let terminal;
    for (let i = 0; i < 600; i++) {
      const session = (await call("/snapshot")).sessions.find(
        (session) => session.id === id,
      );
      if (session.stopReason || session.error || session.approvals.length) {
        terminal = session;
        break;
      }
      await sleep(200);
    }
    if (!terminal) {
      await call(`/sessions/${id}/cancel`, {});
      reports.push({ provider, protocolVersion: 2, outcome: "timeout" });
      continue;
    }
    const output = terminal.messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.text)
      .join("");
    reports.push({
      provider,
      protocolVersion: 2,
      stopReason: terminal.stopReason,
      outcome: output.includes("VIBEONE_ACP_V2_OK")
        ? "passed"
        : terminal.approvals.length
          ? "permission_required"
          : "failed",
      error: terminal.error?.slice(0, 600) ?? null,
    });
  }
  await writeFile(
    join(tmpdir(), "vibeone-real-agent-smoke.json"),
    JSON.stringify(reports, null, 2),
  );
  console.log(JSON.stringify(reports, null, 2));
  await call("/host/stop", {});
} finally {
  const kill = setTimeout(() => host.kill("SIGKILL"), 8000);
  if (!connection) host.kill("SIGINT");
  await exited;
  clearTimeout(kill);
  await rm(data, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}
