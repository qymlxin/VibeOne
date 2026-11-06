import test from "node:test";
import assert from "node:assert/strict";
import { host } from "./helpers/host.mjs";

test(
  "serial runs, idempotent submission, queue withdrawal, pause/resume and workspace exclusion",
  { timeout: 30_000 },
  async (t) => {
    const { directory, call, wait } = await host(t);
    const { id } = await call("/sessions", {
      provider: "demo",
      workspace: directory,
    });
    const other = await call("/sessions", {
      provider: "demo",
      workspace: directory,
    });
    await call(`/sessions/${id}/messages`, { text: "/wait", key: "active" });
    await wait(id, (s) => s.status === "running");
    await call(
      `/sessions/${other.id}/messages`,
      { text: "conflicting write" },
      false,
    );
    const [a, b] = await Promise.all([
      call(`/sessions/${id}/messages`, { text: "next", key: "same" }),
      call(`/sessions/${id}/messages`, { text: "next", key: "same" }),
    ]);
    assert.equal(a.operationId, b.operationId);
    await call(
      `/sessions/${id}/messages`,
      { text: "different", key: "same" },
      false,
    );
    await call(`/sessions/${id}/queue`, { withdraw: a.operationId });
    const next = await call(`/sessions/${id}/messages`, {
      text: "after resume",
      key: "next",
    });
    assert.equal(next.queued, true);
    await call(`/sessions/${id}/cancel`, {});
    const paused = await wait(id, (s) => s.stopReason === "cancelled");
    assert.equal(paused.queuePaused, true);
    assert.equal(paused.queue.length, 1);
    await call(`/sessions/${id}/queue`, { resume: true });
    const completed = await wait(id, (s) =>
      s.runs.some((r) => r.id === next.operationId && r.status === "completed"),
    );
    assert.equal(completed.queue.length, 0);
    assert.ok(completed.runs.some((r) => r.status === "withdrawn"));
    await call(`/sessions/${id}/messages`, { text: "/approve" });
    const pending = await wait(id, (s) => s.approvals.length === 1);
    const request = pending.approvals[0].id;
    const decisions = await Promise.all([
      call(`/sessions/${id}/approvals/${request}`, { option: "allow" }),
      call(`/sessions/${id}/approvals/${request}`, { option: "allow" }),
    ]);
    assert.equal(decisions.length, 2);
    await call(
      `/sessions/${id}/approvals/${request}`,
      { option: "deny" },
      false,
    );
    const decided = await wait(id, (s) =>
      s.decisions.some((d) => d.requestId === request && d.delivery === "sent"),
    );
    assert.equal(
      decided.decisions.filter((d) => d.requestId === request).length,
      1,
    );
    await wait(id, (s) => s.stopReason === "end_turn");
    await call(`/sessions/${id}/messages`, { text: "/input" });
    const input = await wait(id, (s) => s.inputs?.length === 1);
    const inputId = input.inputs[0].id;
    await call(
      `/sessions/${id}/inputs/${inputId}`,
      { action: "accept", content: { name: "x" } },
      false,
    );
    await call(`/sessions/${id}/inputs/${inputId}`, {
      action: "accept",
      content: { name: "my-project" },
    });
    await wait(id, (s) =>
      s.messages.some((m) => m.text.includes("已收到项目名称：my-project")),
    );
  },
);
