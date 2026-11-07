import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync, chmodSync, cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {packageBridges} from './package-bridges.mjs';
const root = fileURLToPath(new URL("..", import.meta.url));
const release = process.argv.includes("--release");
for (const args of [
  ["run", "build"],
  ["run", "build:web", "-w", "@vibeone/desktop"],
]) {
  const build = spawnSync("npm", args, { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const resources = join(root, "target/desktop-resources");
for (const name of ["runtime", "web", "examples", "bridges"]) {
  rmSync(join(resources, name), { recursive: true, force: true });
  mkdirSync(join(resources, name), { recursive: true });
}
cpSync(join(root, "apps/desktop/dist"), join(resources, "web"), {
  recursive: true,
});
cpSync(
  join(root, "packages/plugin-sdk"),
  join(resources, "runtime/plugin-sdk"),
  { recursive: true, filter: (path) => !path.includes("node_modules") },
);
mkdirSync(join(resources, "runtime/plugin-runtime/dist"), { recursive: true });
const bundle = spawnSync(
  join(root, "node_modules/.bin/esbuild"),
  [
    "packages/plugin-runtime/src/main.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    `--outfile=${join(resources, "runtime/plugin-runtime/dist/main.js")}`,
  ],
  { cwd: root, stdio: "inherit" },
);
if (bundle.status !== 0) process.exit(bundle.status ?? 1);
cpSync(
  join(root, "examples/plugins/workspace-tools"),
  join(resources, "examples/workspace-tools"),
  { recursive: true, filter: (path) => !path.includes("node_modules") },
);
packageBridges(root,join(resources,"bridges"));
const result = spawnSync(
  "cargo",
  ["build", "-p", "vibeone-host", ...(release ? ["--release"] : [])],
  { cwd: root, stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
const directory = join(root, "target/desktop-resources/bin");
mkdirSync(directory, { recursive: true });
copyFileSync(
  join(
    root,
    "target",
    release ? "release" : "debug",
    process.platform === "win32" ? "vibeone-host.exe" : "vibeone-host",
  ),
  join(directory, process.platform === "win32" ? "vibeone-host.exe" : "vibeone-host"),
);
if (process.platform !== "win32")
  chmodSync(join(directory, process.platform === "win32" ? "vibeone-host.exe" : "vibeone-host"), 0o755);
