import { build } from "esbuild";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Electron 主进程与 Preload 的 TypeScript 编译脚本
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = join(root, "apps/desktop");
const outdir = join(desktopDir, "dist-electron");

rmSync(outdir, { recursive: true, force: true });

const sharedOptions = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  packages: "external",
  outExtension: { ".js": ".cjs" },
  outdir,
};

await Promise.all([
  // 打包主进程、Preload 以及独立导出的辅助模块（供测试或外部引用）
  build({
    ...sharedOptions,
    entryPoints: [
      join(desktopDir, "electron/main.ts"),
      join(desktopDir, "electron/preload.ts"),
      join(desktopDir, "electron/plugin-source.ts"),
      join(desktopDir, "electron/project-details.ts"),
    ],
  }),
  // dev-bootstrap 需保留对同目录 ./main.cjs 的动态同步 require，以确保协议在 app.ready 前注册
  build({
    ...sharedOptions,
    entryPoints: [join(desktopDir, "electron/dev-bootstrap.ts")],
    external: ["./main.cjs"],
  }),
]);
