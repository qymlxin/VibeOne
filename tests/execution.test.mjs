import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
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
    await wait(id, (s) => s.stopReason === "end_turn");
    await call(`/sessions/${id}/configure`, { id: "mode", value: "normal" });
    assert.equal(
      (await call("/snapshot")).sessions.find((s) => s.id === id).agentState
        .configOptions[0].currentValue,
      "normal",
    );
  },
);

test("an unresponsive ACP process is closed after the grace period with its child process",{timeout:25000,skip:process.platform==="win32"},async t=>{
  const {directory,call,wait}=await host(t);
  const profile=await call("/profiles",{name:"stubborn fixture",provider:"demo",args:[join(directory,"demo-agent.mjs"),"--stubborn"]});
  const {id}=await call("/sessions",{provider:"demo",workspace:directory,profileId:profile.id});
  await call(`/sessions/${id}/messages`,{text:"/wait"});
  const running=await wait(id,session=>session.messages.some(message=>message.role==="assistant"&&message.text.startsWith("stubborn-child-pid:")));
  const pid=Number(running.messages.find(message=>message.role==="assistant"&&message.text.startsWith("stubborn-child-pid:")).text.split(":")[1]);
  t.after(()=>{try{process.kill(pid,"SIGKILL");}catch{}});
  await new Promise(resolve=>setTimeout(resolve,200));
  await call(`/sessions/${id}/messages`,{text:"must stay queued"});
  await call(`/sessions/${id}/cancel`,{});
  const cancelled=await wait(id,session=>session.stopReason==="cancelled");
  assert.equal(cancelled.queuePaused,true);assert.equal(cancelled.queue.length,1);
  let alive=true;for(let i=0;i<100;i++){try{process.kill(pid,0);}catch{alive=false;break;}await new Promise(resolve=>setTimeout(resolve,30));}
  assert.equal(alive,false,"SDK process-group cleanup must also stop the fixture child");
});

test("request-scoped input can be answered before ACP session creation completes",{timeout:20000},async t=>{
  const {directory,call,wait}=await host(t);
  const profile=await call("/profiles",{name:"session input",provider:"demo",args:[join(directory,"demo-agent.mjs"),"--input-before-session"]});
  const {id}=await call("/sessions",{provider:"demo",workspace:directory,profileId:profile.id});
  await call(`/sessions/${id}/messages`,{text:"complete initialization"});
  const attention=await wait(id,session=>session.inputs.length===1);
  assert.equal(attention.status,"starting");
  await call(`/sessions/${id}/inputs/${attention.inputs[0].id}`,{action:"accept",content:{name:"initialized"}});
  await wait(id,session=>session.stopReason==="end_turn");
});

test('manual queue pause survives normal completion and resume does not overlap a running task',{timeout:15000},async t=>{
 const {directory,call,wait}=await host(t);
 const {id}=await call('/sessions',{provider:'demo',workspace:directory});
 await call(`/sessions/${id}/messages`,{text:'/pause-test',key:'first'});
 await wait(id,session=>session.status==='running');
 const queued=await call(`/sessions/${id}/messages`,{text:'after manual pause',key:'second'});
 await call(`/sessions/${id}/queue`,{pause:true,resume:true},false);
 await call(`/sessions/${id}/queue`,{pause:true});
 const ended=await wait(id,session=>session.runs[0].status==='completed');
 assert.equal(ended.queuePaused,true);
 assert.equal(ended.queue[0].id,queued.operationId);
 assert.equal(ended.runs.find(run=>run.id===queued.operationId).status,'queued');
 await call(`/sessions/${id}/queue`,{resume:true});
 await wait(id,session=>session.runs.find(run=>run.id===queued.operationId)?.status==='completed');
 await call(`/sessions/${id}/queue`,{pause:true},false);
});
