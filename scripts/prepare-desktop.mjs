import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const release = process.argv.includes("--release");
const result = spawnSync(
  "cargo",
  ["build", "-p", "vibeone-host", ...(release ? ["--release"] : [])],
  { cwd: root, stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
const directory = join(root, "apps/desktop/src-tauri/bin");
mkdirSync(directory, { recursive: true });
copyFileSync(
  join(
    root,
    "target",
    release ? "release" : "debug",
    process.platform === "win32" ? "vibeone-host.exe" : "vibeone-host",
  ),
  join(directory, "vibeone-host"),
);
if (process.platform !== "win32")
  chmodSync(join(directory, "vibeone-host"), 0o755);
