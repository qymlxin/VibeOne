// 开发模式引导入口：启动或复用 Vite 服务，并在 Electron TS 源码变更时重新编译并重启
import { app } from "electron";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
const electronSourceDir = path.join(root, "apps/desktop/electron");
process.env.VIBEONE_DEV_URL = "http://127.0.0.1:5174";
process.env.VIBEONE_RESOURCES_DIR = path.join(root, "target/desktop-resources");

let server: { listen(): Promise<unknown>; close(): Promise<void> } | undefined;
let watcher: fs.FSWatcher | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

globalThis.vibeoneDevReady = (async () => {
  let existing = false;
  try {
    const response = await fetch(`${process.env.VIBEONE_DEV_URL}/src/main.tsx`, {
      signal: AbortSignal.timeout(1000),
    });
    existing = response.ok && (await response.text()).includes("ProjectSwitcher");
    if (!existing) {
      throw new Error("5174端口不是VibeOne开发服务");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("不是VibeOne")) {
      throw error;
    }
  }

  if (!existing) {
    const { createServer } = await import("vite");
    server = await createServer({ root: path.join(root, "apps/desktop") });
    await server.listen();
  }

  watcher = fs.watch(electronSourceDir, (_event, name) => {
    if (!name?.endsWith(".ts")) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      try {
        execFileSync(
          process.execPath,
          [path.join(root, "scripts/build-electron.mjs")],
          { cwd: root, stdio: "inherit" },
        );
        app.relaunch();
        app.quit();
      } catch {
        // 编译失败时不重启，等待下一次保存修复
      }
    }, 350);
  });
})();

// 在 app.ready 前同步加载主进程，确保特权协议完成注册
require("./main.cjs");

app.on("will-quit", () => {
  if (timer) {
    clearTimeout(timer);
  }
  watcher?.close();
  void server?.close();
});
