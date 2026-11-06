import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { host } from "./helpers/host.mjs";
test(
  "trusted plugin prepare/commit, scoped reverse RPC and failed candidate keep the active version",
  { timeout: 25000 },
  async (t) => {
    const { call, wait, directory } = await host(t);
    const workspace = await call("/workspaces", { path: directory });
    const path = resolve("examples/plugins/workspace-tools");
    await call("/plugins/prepare", { path, trusted: false }, false);
    const inspected = await call("/plugins/inspect", { path });
    const candidate = await call("/plugins/prepare", {
      path,
      trusted: true,
      workspaces: [workspace.id],
      expectedManifest: inspected,
    });
    assert.ok(candidate.app.source.includes("defineApp"));
    await call("/plugins/commit", { ticket: candidate.ticket });
    const id = candidate.plugin.id;
    const scan = await call(`/plugins/${id}/invoke`, {
      handler: "workspace.scan",
      workspaceId: workspace.id,
      input: { path: "." },
    });
    assert.ok(Array.isArray(scan.entries));
    await call(
      `/plugins/${id}/invoke`,
      {
        handler: "workspace.scan",
        workspaceId: "unauthorized",
        input: { path: "." },
      },
      false,
    );
    const bad = join(directory, "bad-package");
    await mkdir(bad);
    const manifest = {
      ...inspected,
      entrypoints: {
        worker: { path: "worker.mjs", runtime: "node", protocolVersion: 1 },
      },
    };
    await writeFile(join(bad, "plugin.json"), JSON.stringify(manifest));
    await writeFile(
      join(bad, "worker.mjs"),
      "throw Error('broken candidate');",
    );
    await call(
      "/plugins/prepare",
      { path: bad, trusted: true, workspaces: [workspace.id] },
      false,
    );
    await call(`/plugins/${id}/invoke`, {
      handler: "workspace.scan",
      workspaceId: workspace.id,
      input: { path: "." },
    });

    const providerPackage = join(directory, "provider-package");
    await mkdir(providerPackage);
    const providerManifest = {
      ...inspected,
      entrypoints: {
        worker: { path: "worker.mjs", runtime: "node", protocolVersion: 1 },
      },
      contributions: [
        {
          id: "agent",
          kind: "agent.provider",
          kindVersion: 1,
          binding: {
            type: "declarative",
            descriptor: {
              name: "Plugin demo",
              command: "$node",
              args: [join(directory, "demo-agent.mjs")],
            },
          },
        },
        {
          id: "notify",
          kind: "notification.channel",
          kindVersion: 1,
          binding: { type: "worker", handler: "notify" },
        },
      ],
      hostRequirements: ["agent.spawn", "notifications.send"],
    };
    await writeFile(
      join(providerPackage, "plugin.json"),
      JSON.stringify(providerManifest),
    );
    await writeFile(
      join(providerPackage, "worker.mjs"),
      "export default {apiVersion:'0.1',setup(registrar){registrar.handle('notify',async(input,ctx)=>ctx.host.call('notifications.send','show',{message:'Run finished via plugin'}));}};",
    );
    const providerCandidate = await call("/plugins/prepare", {
      path: providerPackage,
      trusted: true,
      workspaces: [workspace.id],
    });
    await call("/plugins/commit", { ticket: providerCandidate.ticket });
    const providerId = `${id}:agent`;
    assert.ok(
      (await call("/snapshot")).providers.some(
        (provider) => provider.id === providerId,
      ),
    );
    const session = await call("/sessions", {
      provider: providerId,
      workspace: directory,
    });
    const notified = await call(`/sessions/${session.id}/messages`, {
      text: "notification extension consumer",
    });
    await wait(session.id, (session) =>
      session.runs.some(
        (run) => run.id === notified.operationId && run.status === "completed",
      ),
    );
    let found = false;
    for (let i = 0; i < 100; i++) {
      found = (await call("/snapshot")).notifications.some(
        (item) => item.message === "Run finished via plugin",
      );
      if (found) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(found);
    await call(`/plugins/${id}/disable`, {});
    await call(
      `/plugins/${id}/invoke`,
      {
        handler: "workspace.scan",
        workspaceId: workspace.id,
        input: { path: "." },
      },
      false,
    );
    assert.equal(
      (await call("/snapshot")).plugins.find((plugin) => plugin.id === id)
        .enabled,
      false,
    );
    await call(
      "/sessions",
      { provider: providerId, workspace: directory },
      false,
    );
    const pinned = await call(`/sessions/${session.id}/messages`, {
      text: "pinned provider generation",
    });
    await wait(session.id, (session) =>
      session.runs.some(
        (run) => run.id === pinned.operationId && run.status === "completed",
      ),
    );
  },
);
