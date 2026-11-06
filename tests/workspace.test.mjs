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
