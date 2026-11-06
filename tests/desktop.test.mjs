import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";

test(
  "desktop React view controls the live Host: messages, approvals, stop, themes and reconnect",
  { timeout: 60_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "vibeone-desktop-test-"));
    const child = spawn(
      resolve("target/debug/vibeone-host"),
      ["serve", "--data-dir", directory],
      { stdio: "ignore" },
    );
    const exited = once(child, "exit");
    const frontend = "http://127.0.0.1:5174";
    let vite;
    try {
      if (!(await fetch(frontend)).ok) throw Error();
    } catch {
      vite = spawn(
        process.execPath,
        [
          resolve("node_modules/vite/bin/vite.js"),
          "--host",
          "127.0.0.1",
          "--port",
          "5174",
          "--strictPort",
        ],
        { cwd: resolve("apps/desktop"), stdio: "ignore" },
      );
    }
    let connection;
    for (let i = 0; i < 100; i++) {
      try {
        connection = JSON.parse(
          await readFile(join(directory, "host.json"), "utf8"),
        );
        if ((await fetch(frontend)).ok) break;
      } catch {
        /* Wait for both test processes. */
      }
      await sleep(40);
    }
    assert.ok(connection);
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined);
    const browser = await chromium.launch({ executablePath });
    t.after(async () => {
      await browser.close();
      await fetch(`${connection.url}/v1/host/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${connection.token}` },
      }).catch(() => {});
      const kill = setTimeout(() => child.kill("SIGKILL"), 8000);
      await exited;
      clearTimeout(kill);
      vite?.kill();
      await rm(directory, { recursive: true, force: true });
    });
    const context = await browser.newContext({
      viewport: { width: 1360, height: 900 },
    });
    await context.addInitScript(
      ({ connection, directory }) => {
        const NativeWebSocket = window.WebSocket;
        window.__testSockets = [];
        window.WebSocket = class extends NativeWebSocket {
          constructor(...args) {
            super(...args);
            window.__testSockets.push(this);
          }
        };
        window.__TAURI_INTERNALS__ = {
          invoke: async (command) => {
            if (command === "host_connection") return connection;
            if (command === "restart_host") { await new Promise(resolve=>setTimeout(resolve,500)); return connection; }
            if (command === "choose_workspace") return directory;
            throw Error(`Unexpected native command: ${command}`);
          },
        };
      },
      { connection, directory },
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(frontend);
    await page.getByText("工作主机 · 本机已连接", { exact: true }).waitFor();
    // Optional workspace must work through the actual form, without a native picker.
    await page.getByRole('button',{name:'创建会话',exact:true}).click();
    await page.getByRole('textbox',{name:'发送任务'}).waitFor();
    const managed=await (await fetch(`${connection.url}/v1/snapshot`,{headers:{Authorization:`Bearer ${connection.token}`}})).json();
    assert.ok(managed.sessions.some(s=>s.workspace.includes('/projects/project-')));
    await page.getByRole('button',{name:'新建会话',exact:true}).click();
    await page.getByRole("button", { name: "选择工作区目录" }).click();
    await page
      .waitForFunction(
        () => !document.querySelector(".desktop-setup-form .primary")?.disabled,
        {},
        { timeout: 3000 },
      )
      .catch(async () => {
        throw Error(await page.locator("body").innerText());
      });
    await page.getByRole("button", { name: "创建会话", exact: true }).click();
    await page
      .getByRole("textbox", { name: "发送任务" })
      .fill("桌面集成测试 /thought");
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.getByText("本轮执行结束", { exact: true }).waitFor({timeout:8000}).catch(async error=>{throw new Error(`${error.message}\nReact errors: ${JSON.stringify(errors)}\n${(await page.locator("body").innerText()).slice(-6000)}`);});
    assert.equal(await page.locator(".desktop-message.user").count(), 1);
    assert.equal(await page.locator(".desktop-message.assistant").count(), 1);
    assert.equal(await page.locator('.desktop-message.thought').count(),0,'thoughts should not expand into the conversation body');
    const firstProcess=page.getByRole('region',{name:'Agent 处理过程'}).first();
    assert.equal(await firstProcess.getByRole('button').getAttribute('aria-expanded'),'false');
    await firstProcess.getByRole('button').click();
    await firstProcess.locator('.desktop-activity-item.thought summary').click();
    assert.equal(await firstProcess.locator('.desktop-process-thought').innerText(),'演示进度摘要：正在准备回复。');
    await firstProcess.getByRole('button').click();
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.getByRole('textbox',{name:'发送任务'}).fill('/activity');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    const liveProcess=page.locator('.desktop-activity[data-live="true"]');
    await liveProcess.getByText('演示：整理执行结果',{exact:true}).waitFor();
    assert.equal(await page.locator('.desktop-turn').last().locator('.desktop-message.assistant').count(),0,'intermediate commentary belongs inside the turn process');
    assert.equal(await page.locator('.desktop-turn').last().locator('.desktop-activity').count(),1);
    await page.waitForFunction(()=>[...document.querySelectorAll('.desktop-activity[data-live="true"] .thinking-shimmer')].some(element=>getComputedStyle(element).animationName==='thinking-sweep'));

    assert.ok(await liveProcess.locator('.thinking-shimmer').first().evaluate(async element=>{const before=getComputedStyle(element).backgroundPosition;await new Promise(resolve=>setTimeout(resolve,160));return getComputedStyle(element).backgroundPosition!==before;}),'the light sweep must actually move');
    assert.ok(await liveProcess.locator('.desktop-activity-preview-row').count()<=3);
    assert.equal(await liveProcess.locator('.desktop-activity-preview').innerText().then(text=>text.includes('演示：梳理任务范围')),false,'old activity rolls out of bounded preview');
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-chat-activity-light.png')});
    await page.getByRole('combobox',{name:'主题',exact:true}).selectOption('dark');
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-chat-activity-dark.png')});
    await page.setViewportSize({width:960,height:640});
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.ok(await liveProcess.locator('.thinking-shimmer').evaluateAll(elements=>elements.every(element=>getComputedStyle(element).animationName==='none' && getComputedStyle(element).color!=='rgba(0, 0, 0, 0)')));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'minimum desktop activity must not overflow');
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-chat-activity-minimum.png')});
    await page.locator('.desktop-timeline').evaluate(element=>{element.scrollTop=0;element.dispatchEvent(new Event('scroll'));});
    await page.waitForFunction(()=>document.querySelectorAll('.desktop-activity[data-live="true"] .thinking-shimmer').length===0);
    await page.getByRole('button',{name:'回到最新消息',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.desktop-activity[data-live="true"] .thinking-shimmer').length>0);

    await page.setViewportSize({width:1360,height:900});
    await page.getByRole('combobox',{name:'主题',exact:true}).selectOption('light');

    await liveProcess.getByRole('button').click();
    assert.equal(await liveProcess.getByRole('button').getAttribute('aria-expanded'),'true');
    assert.equal(await liveProcess.locator('details[open]').count(),0,'nested groups remain collapsed until requested');
    assert.deepEqual(await liveProcess.locator('.desktop-activity-history').evaluate(body=>[...body.children].map(node=>node.classList.contains('desktop-process-note')?'note':node.classList.contains('thought')?'thought':'tools')),['note','thought','tools']);
    await liveProcess.getByRole('button').click();
    await page.getByText('演示处理已完成。以上思考摘要与工具事件用于验证实时活动视图，没有读取文件或执行命令。',{exact:true}).waitFor();
    await page.getByText('本轮执行结束',{exact:true}).waitFor();
    assert.deepEqual(await page.locator('.desktop-turn').last().evaluate(turn=>[...turn.querySelectorAll('.desktop-message.assistant,.desktop-activity')].map(node=>node.classList.contains('desktop-activity')?'activity':'message')),['activity','message'],'the final reply stays outside the single process disclosure');
    const latestProcess=page.getByRole('region',{name:'Agent 处理过程'}).last();
    assert.equal(await latestProcess.getByRole('button').getAttribute('aria-expanded'),'false');
    await latestProcess.getByRole('button').click();
    assert.equal(await page.locator('.desktop-activity[data-live="false"] .thinking-shimmer').count(),0);
    await latestProcess.locator('.desktop-tool-group > summary').click();
    const firstTool=latestProcess.locator('.desktop-activity-item.tool').first();
    await firstTool.locator(':scope > summary').click();
    await firstTool.getByText('输入',{exact:true}).waitFor();
    assert.ok((await firstTool.innerText()).includes('模拟步骤完成'));
    await latestProcess.getByRole('button').click();
    await page.screenshot({
      animations: "disabled",
      path: join(tmpdir(), "vibeone-desktop-light.png"),
    });
    await page.getByRole("textbox", { name: "发送任务" }).fill("/approve");
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.getByRole("button", { name: "允许一次", exact: true }).waitFor();
    await page.screenshot({
      animations: "disabled",
      path: join(tmpdir(), "vibeone-desktop-approval.png"),
    });
    await page.getByRole("button", { name: "允许一次", exact: true }).click();
    await page
      .getByText("你已允许一次，演示审批链路完成。", { exact: true })
      .waitFor();
    await page.getByRole("textbox", { name: "发送任务" }).fill("/input");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page
      .getByRole("textbox", { name: "补充输入 JSON" })
      .fill(JSON.stringify({ name: "desktop-input" }));
    await page.getByRole("button", { name: "提交回答", exact: true }).click();
    await page
      .getByText("已收到项目名称：desktop-input", { exact: true })
      .waitFor();
    await page.getByRole("textbox", { name: "发送任务" }).fill("/wait");
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.waitForFunction(() =>
      document.querySelector(".desktop-status")?.textContent.includes("运行中"),
    );
    assert.equal(
      await page.locator(".desktop-live-status").count(),
      1,
      "Agent running without output must have visible progress feedback",
    );
    await page
      .getByText("尚未收到可展示的思考摘要；收到后会自动显示。", {
        exact: true,
      })
      .waitFor();
    await page.screenshot({
      animations: "disabled",
      path: join(tmpdir(), "vibeone-desktop-waiting.png"),
    });
    await page.getByRole("button", { name: "停止执行", exact: true }).click();
    await page.getByText("本轮已停止", { exact: true }).waitFor();
    assert.equal(await page.locator(".desktop-live-status").count(), 0);
    await page.getByRole("button", { name: "重命名", exact: true }).click();
    await page
      .getByRole("textbox", { name: "会话标题" })
      .fill("已保存的桌面会话");
    await page.getByRole("button", { name: "保存标题", exact: true }).click();
    await page
      .getByRole("heading", { name: "已保存的桌面会话", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "归档", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('textarea[aria-label="发送任务"]')?.disabled,
    );
    await page
      .getByRole("button", { name: "会话 · 查看归档", exact: true })
      .click();
    await page
      .locator(".desktop-session")
      .filter({ hasText: "已保存的桌面会话" })
      .waitFor();
    await page.getByRole("button", { name: "取消归档", exact: true }).click();
    await page.waitForFunction(
      () =>
        !document.querySelector('textarea[aria-label="发送任务"]')?.disabled,
    );
    await page
      .getByRole("button", { name: "已归档 · 查看会话", exact: true })
      .click();

    await page
      .getByRole("combobox", { name: "主题", exact: true })
      .selectOption("dark");
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.screenshot({
      animations: "disabled",
      path: join(tmpdir(), "vibeone-desktop-dark.png"),
    });
    await context.setOffline(true);
    // Browser offline emulation does not reliably tear down existing loopback sockets.
    await page.evaluate(() =>
      window.__testSockets
        .filter((socket) => socket.url.endsWith("/v1/events"))
        .forEach((socket) => socket.close()),
    );
    await page.getByText("连接已断开", { exact: true }).waitFor();
    await context.setOffline(false);
    await page.getByText("工作主机 · 本机已连接", { exact: true }).waitFor();
    await page.getByText("本轮已停止", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await page.setViewportSize({ width: 960, height: 640 });
    await page.screenshot({
      animations: "disabled",
      path: join(tmpdir(), "vibeone-desktop-minimum.png"),
    });
    await page.getByRole("textbox", { name: "发送任务" }).fill("/long");
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.waitForFunction(() => {
      const element = document.querySelector(".desktop-timeline");
      return element.scrollHeight > element.clientHeight + 300;
    });
    await page.locator(".desktop-timeline").evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll"));
    });
    await page
      .getByRole("button", { name: "回到最新消息", exact: true })
      .waitFor();
    const length = await page
      .locator(".desktop-message.assistant")
      .last()
      .innerText();
    await page.waitForFunction(
      (length) =>
        document.querySelectorAll(".desktop-message.assistant")[
          document.querySelectorAll(".desktop-message.assistant").length - 1
        ].innerText.length >
        length + 30,
      length.length,
    );
    assert.equal(
      await page
        .locator(".desktop-timeline")
        .evaluate((element) => element.scrollTop),
      0,
    );
    await page.screenshot({
      animations: "disabled",
      path: join(tmpdir(), "vibeone-desktop-reading.png"),
    });
    await page
      .getByRole("button", { name: "回到最新消息", exact: true })
      .click();
    await page.waitForFunction(() => {
      const element = document.querySelector(".desktop-timeline");
      return (
        element.scrollHeight - element.scrollTop - element.clientHeight < 56
      );
    });
    await page.getByText("本轮执行结束", { exact: true }).waitFor();

    await page.setViewportSize({width:1360,height:900});
    await page.getByRole('textbox',{name:'发送任务'}).fill('/format');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    const formatted=page.locator('.desktop-message.assistant').last();
    await formatted.locator('pre code').filter({hasText:'second'}).waitFor();
    await page.getByText('本轮执行结束',{exact:true}).waitFor();
    const layout=await formatted.locator('.desktop-message-text').evaluate(element=>{
      const list=element.querySelector('ol'), paragraph=element.querySelector('p'), firstItem=list.querySelector('li'), firstParagraph=firstItem.querySelector('p');
      return {whiteSpace:getComputedStyle(element).whiteSpace,gap:list.getBoundingClientRect().top-paragraph.getBoundingClientRect().bottom,itemGap:firstParagraph.getBoundingClientRect().top-firstItem.getBoundingClientRect().top,code:element.querySelector('pre code').textContent};
    });
    assert.ok(await formatted.locator('.desktop-message-text > p br').count()>=1);
    assert.equal(layout.whiteSpace,'normal');assert.ok(layout.gap<24);assert.ok(layout.itemGap<10);assert.ok(layout.code.includes('  first\n    second'));
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-markdown-spacing.png')});
    await page.getByRole('textbox',{name:'发送任务'}).fill('/rich-tools');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await page.getByText('工具视图演示已完成。没有搜索网页或执行命令。',{exact:true}).waitFor();
    await page.getByText('本轮执行结束',{exact:true}).waitFor();
    const rich=page.locator('.desktop-turn').last().getByRole('region',{name:'Agent 处理过程'});
    await rich.getByRole('button').click();
    await rich.locator('.desktop-tool-group').first().locator(':scope > summary').click();
    const richTools=rich.locator('.desktop-activity-item.tool');
    await richTools.nth(0).locator(':scope > summary').click();
    await richTools.nth(0).getByText('测试查询一',{exact:true}).waitFor();
    assert.equal(await richTools.nth(0).locator('.desktop-tool-raw').getAttribute('open'),null);
    assert.equal(await richTools.nth(0).locator('pre:visible').count(),0);
    assert.equal(await richTools.nth(0).locator('.desktop-tool-raw pre').count(),0);
    await richTools.nth(0).locator('.desktop-tool-raw > summary').click();
    assert.ok((await richTools.nth(0).locator('.desktop-tool-raw pre').innerText()).includes('transport-only'));
    await richTools.nth(0).locator('.desktop-tool-raw > summary').click();

    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-tool-search-rendered.png')});
    await richTools.nth(1).locator(':scope > summary').click();
    assert.equal(await richTools.nth(1).getByRole('link').getAttribute('href'),'https://example.com/docs');
    await rich.locator('.desktop-tool-group').last().locator(':scope > summary').click();
    await richTools.nth(2).locator(':scope > summary').click();
    await richTools.nth(2).getByText('退出码',{exact:true}).waitFor();
    await richTools.nth(2).getByText('hello',{exact:true}).waitFor();

    await page.getByRole("button", { name: "连接与设置", exact: true }).click();
    await page
      .getByRole("button", { name: "选择内置示例插件", exact: true })
      .click();
    await page.getByRole("button", { name: "检查插件", exact: true }).click();
    await page.getByLabel(`允许访问 ${basename(directory)}`, {exact:true}).check();
    await page.getByLabel("信任此本地插件及上述权限").check();
    await page
      .getByRole("button", { name: "安装 / 更新并启用", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "插件工作区面板", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "通过 Worker 读取目录", exact: true })
      .click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("pre")].some((node) =>
        node.textContent.includes('"entries"'),
      ),
    );
    assert.equal(
      await page.evaluate(async () => {
        const [react, dom, client] = await Promise.all([
          import("react"),
          import("react-dom"),
          import("react-dom/client"),
        ]);
        return (
          react.createElement === window.__vibeoneReact.createElement &&
          dom.createPortal === window.__vibeoneReactDOM.createPortal &&
          client.createRoot === window.__vibeoneReactDOMClient.createRoot
        );
      }),
      true,
    );

    await page.getByRole('button',{name:'重启工作主机',exact:true}).click();
    await page.getByText('正在重启工作主机',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'重新连接',exact:true}).isDisabled(),true);
    assert.equal((await page.locator('body').innerText()).includes('Load failed'),false);
    await page.getByText('工作主机 · 本机已连接',{exact:true}).waitFor();

    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  },
);
