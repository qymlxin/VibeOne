#!/usr/bin/env node
import {
  mkdir,
  readFile,
  writeFile,
  cp,
  realpath,
  stat,
} from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { loadWorkerPackage } from "../packages/plugin-runtime/dist/manifest.js";
const root = fileURLToPath(new URL("..", import.meta.url));
const [command, input, output] = process.argv.slice(2);
async function manifest(path) {
  return JSON.parse(await readFile(join(path, "plugin.json"), "utf8"));
}
async function check(path) {
  const pkg = await loadWorkerPackage(path),
    value = await manifest(path);
  if (value.entrypoints?.app) {
    const app = await realpath(join(path, value.entrypoints.app.path));
    if (
      !app.startsWith(`${await realpath(path)}/`) ||
      !(await stat(app)).isFile()
    )
      throw Error("Invalid App entry");
  }
  if (Object.keys(value.dependencies ?? {}).length)
    throw Error(
      "Bundle dependencies into the plugin; inter-plugin dependencies are not supported yet",
    );
  return pkg;
}
async function sourceEntry(path, kind) {
  for (const extension of ["tsx", "ts", "jsx", "js", "mjs"]) {
    const file = join(path, `src/${kind}.${extension}`);
    if (
      await stat(file)
        .then((value) => value.isFile())
        .catch(() => false)
    )
      return file;
  }
  throw Error(`Missing src/${kind}.ts or JavaScript source`);
}
async function run() {
  if (!input || !["create", "build", "check", "pack"].includes(command))
    throw Error(
      "Usage: npm run plugin:dev -- create|build|check <directory> OR pack <directory> <output>",
    );
  const path = resolve(input);
  if (command === "create") {
    await mkdir(dirname(path), { recursive: true });
    await mkdir(path);
    await mkdir(join(path, "src"));
    await writeFile(
      join(path, "package.json"),
      JSON.stringify(
        {
          name: "vibeone-local-plugin",
          version: "0.1.0",
          private: true,
          type: "module",
          devDependencies: {
            "@vibeone/plugin-sdk": `file:${join(root, "packages/plugin-sdk")}`,
          },
        },
        null,
        2,
      ) + "\n",
    );
    await writeFile(
      join(path, "plugin.json"),
      JSON.stringify(
        {
          manifestVersion: 1,
          id: "dev.local.example",
          name: "本地示例",
          version: "0.1.0",
          engines: { pluginApi: ">=0.1 <0.2" },
          entrypoints: {
            worker: {
              path: "dist/worker.js",
              runtime: "node",
              protocolVersion: 1,
            },
            app: { path: "dist/app.js" },
          },
          hostRequirements: [],
          contributions: [
            {
              id: "echo",
              title: "执行示例",
              kind: "app.command",
              kindVersion: 1,
              binding: { type: "worker", handler: "echo" },
            },
            {
              id: "panel",
              kind: "app.panel",
              kindVersion: 1,
              binding: { type: "app" },
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );
    await writeFile(
      join(path, "src/worker.ts"),
      "import {defineWorker} from '@vibeone/plugin-sdk/worker';\nexport default defineWorker(registrar=>{registrar.handle('echo',input=>({echo:input}));});\n",
    );
    await writeFile(
      join(path, "src/app.ts"),
      "import React from 'react';\nimport {defineApp} from '@vibeone/plugin-sdk/app';\nexport default defineApp(ctx=>{ctx.panels.register('panel',()=>React.createElement('p',null,'来自本地插件的面板'));});\n",
    );
    console.log(`Created ${path}`);
    return;
  }
  if (command === "build" || command === "pack") {
    const value = await manifest(path);
    for (const kind of ["worker", "app"])
      if (value.entrypoints?.[kind])
        await build({
          entryPoints: [await sourceEntry(path, kind)],
          outfile: join(path, value.entrypoints[kind].path),
          bundle: true,
          format: "esm",
          platform: kind === "worker" ? "node" : "browser",
          target: "es2022",
          external: [
            "@vibeone/plugin-sdk",
            "@vibeone/plugin-sdk/*",
            "react",
            "react/*",
            "react-dom",
            "react-dom/*",
          ],
          nodePaths: [join(root, "node_modules")],
        });
  }
  const pkg = await check(path);
  if (command === "pack") {
    if (!output) throw Error("Pack needs a new output directory");
    const destination = resolve(output);
    if (destination === path || destination.startsWith(`${path}/`))
      throw Error("Output must be outside the source package");
    await mkdir(destination);
    await cp(join(path, "dist"), join(destination, "dist"), {
      recursive: true,
    });
    await cp(join(path, "plugin.json"), join(destination, "plugin.json"));
    await writeFile(
      join(destination, "package.json"),
      JSON.stringify(
        { name: pkg.id, version: pkg.version, type: "module", private: true },
        null,
        2,
      ) + "\n",
    );
    await check(destination);
    console.log(`Packed ${destination}`);
  } else console.log(`Valid ${pkg.id} ${pkg.version}`);
}
await run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
