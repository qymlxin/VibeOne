import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { host } from "./helpers/host.mjs";
const exec = promisify(execFile);
test(
  "workspace files and Git differences remain scoped; profiles are pinned and diagnostics are redacted",
  { timeout: 25_000 },
  async (t) => {
    const { directory, call } = await host(t);
    const workspace = join(directory, "project");
    await mkdir(workspace);
    await exec("git", ["init", workspace]);
    await writeFile(join(workspace, "tracked.txt"), "before\n");
    await exec("git", ["-C", workspace, "add", "tracked.txt"]);
    await exec("git", [
      "-C",
      workspace,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "initial",
    ]);
    await writeFile(join(workspace, "tracked.txt"), "after\n");
    await writeFile(join(workspace, "binary"), Buffer.from([0, 1, 2]));
    await call("/workspaces", { path: workspace });
    await call("/workspaces", { path: workspace });
    assert.equal((await call("/snapshot")).workspaces.length, 1);
    const profile = await call("/profiles", {
      name: "demo profile",
      provider: "demo",
    });
    const { id } = await call("/sessions", {
      provider: "demo",
      workspace,
      profileId: profile.id,
    });
    await call("/profiles", { ...profile, name: "changed profile" });
    assert.equal(
      (await call("/snapshot")).sessions.find((s) => s.id === id).profile.name,
      "demo profile",
    );
    const changes = await call(`/sessions/${id}/changes`);
    assert.equal(changes.isGit, true);
    assert.ok(
      changes.files.some(
        (file) => file.path === "tracked.txt" && file.unstaged,
      ),
    );
    const diff = await call(`/sessions/${id}/diff?path=tracked.txt`);
    assert.ok(diff.text.includes("+after"));
    assert.equal((await call(`/sessions/${id}/file?path=binary`)).binary, true);
    await call(`/sessions/${id}/file?path=../host.json`, undefined, false);
    if (process.platform !== "win32") {
      await symlink(directory, join(workspace, "outside"));
      await call(
        `/sessions/${id}/file?path=outside/host.json`,
        undefined,
        false,
      );
    }
    const artifact = await call(`/sessions/${id}/artifacts`, {
      path: "tracked.txt",
    });
    await writeFile(join(workspace, "tracked.txt"), "newer\n");
    const artifacts = await call(`/sessions/${id}/artifacts`);
    assert.equal(artifacts[0].content.text, "after\n");
    await call(
      `/sessions/${id}/messages`,
      { text: "reference file", files: ["../host.json"] },
      false,
    );
    await call(`/sessions/${id}/messages`, {
      text: "reference file",
      files: ["tracked.txt"],
      key: "file-ref",
    });
    await call("/profiles",{id:profile.id,revision:1,name:"stale",provider:"demo"},false);
    await call("/profiles",{id:profile.id,revision:2,remove:true});
    assert.ok(!(await call("/snapshot")).profiles.some(item=>item.id===profile.id));
    const events = await call("/event-log?after=0");
    assert.ok(events.events.length >= 4);
    assert.ok(
      events.events.every(
        (event, index, list) =>
          index === 0 || event.cursor > list[index - 1].cursor,
      ),
    );
    const diagnostic = JSON.stringify(await call("/diagnostics"));
    assert.ok(!diagnostic.includes(directory));
    assert.ok(!diagnostic.includes("token"));
  },
);

test('sessions can create independent managed projects without choosing a directory', {timeout:20000}, async t => {
  const {directory,call,wait}=await host(t);
  const first=await call('/sessions',{provider:'demo'});
  const second=await call('/sessions',{provider:'demo',workspace:''});
  const snapshot=await call('/snapshot');
  const a=snapshot.sessions.find(s=>s.id===first.id),b=snapshot.sessions.find(s=>s.id===second.id);
  const {realpath,stat}=await import('node:fs/promises');
  const base=await realpath(join(directory,'projects'));
  assert.equal(a.workspace.startsWith(base+'/'),true);
  assert.notEqual(a.workspace,b.workspace);
  assert.equal((await stat(a.workspace)).isDirectory(),true);
  assert.equal(a.messages.length,0);
  const reused=await call('/sessions',{provider:'demo',workspace:a.workspace});
  assert.equal((await call('/snapshot')).sessions.find(s=>s.id===reused.id).workspace,a.workspace);
  await call(`/sessions/${first.id}/messages`,{text:'managed project works'});
  await wait(first.id,s=>s.stopReason==='end_turn');
});

test('folder references send only bounded names and reject escaped or invalid context', {timeout:15000}, async t=>{
  const {directory,call,wait}=await host(t);
  await mkdir(join(directory,'context folder'));
  await writeFile(join(directory,'context folder','note.txt'),'PRIVATE_FILE_BODY_NOT_SELECTED');
  await mkdir(join(directory,'context folder','nested'));
  await writeFile(join(directory,'context folder','nested','deep.txt'),'DEEP_BODY_NOT_SELECTED');
  const {id}=await call('/sessions',{workspace:directory,provider:'demo'});
  await call(`/sessions/${id}/messages`,{text:'',files:['../'],key:'escaped'},false);
  await call(`/sessions/${id}/messages`,{text:'',files:['context folder/note.txt/'],key:'not-dir'},false);
  const accepted=await call(`/sessions/${id}/messages`,{text:'',files:['context folder/'],key:'folder-context'});
  const done=await wait(id,session=>session.runs.some(run=>run.id===accepted.operationId&&run.status==='completed'));
  const message=done.messages.find(message=>message.role==='user').text;
  assert.match(message,/工作区文件夹 context folder\//);
  assert.match(message,/note.txt/);assert.match(message,/nested/);
  assert.doesNotMatch(message,/PRIVATE_FILE_BODY_NOT_SELECTED|DEEP_BODY_NOT_SELECTED|deep.txt/);
  assert.deepEqual(done.runs.find(run=>run.id===accepted.operationId).files,['context folder/']);
});
