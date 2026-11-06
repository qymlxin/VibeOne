import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import {tmpdir} from "node:os";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { host } from "./helpers/host.mjs";

test(
  "trusted TLS, pairing confirmation, workspace roles, live mobile controls and revocation",
  { timeout: 45000 },
  async (t) => {
    const { directory, call, wait, connection } = await host(t);
    const workspace = await call("/workspaces", { path: directory });
    const hidden = join(directory, "hidden");
    await mkdir(hidden);
    await call("/workspaces", { path: hidden });
    const visible = await call("/sessions", {
      workspace: directory,
      provider: "demo",
    });
    const invisible = await call("/sessions", {
      workspace: hidden,
      provider: "demo",
    });
    const remote = await call("/remote", {
      enabled: true,
      ip: "127.0.0.1",
      port: 0,
    });
    const ca = await readFile(join(directory, "VibeOne-Root-CA.crt"));
    const request = (path, body, cookie, token) =>
      new Promise((resolve, reject) => {
        const req = https.request(
          `${remote.url}${path}`,
          {
            ca,
            method: body === undefined ? "GET" : "POST",
            headers: {
              Origin: remote.url,
              ...(cookie ? { Cookie: cookie } : {}),
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(body === undefined
                ? {}
                : { "Content-Type": "application/json" }),
            },
          },
          (res) => {
            let text = "";
            res.on("data", (chunk) => (text += chunk));
            res.on("end", () =>
              resolve({
                status: res.statusCode,
                headers: res.headers,
                body: res.headers["content-type"]?.includes("json")
                  ? JSON.parse(text)
                  : text,
              }),
            );
          },
        );
        req.on("error", reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
      });
    assert.equal((await request("/")).status, 200);
    assert.equal((await request("/v1/snapshot")).status, 401);
    assert.equal(
      (await request("/v1/snapshot", undefined, null, connection.token)).status,
      401,
      "desktop owner credential is never accepted on the LAN listener",
    );
    const code = await call("/pairing/code", {});
    const secret = randomUUID() + randomUUID();
    const claim = await request("/v1/pairing/claim", {
      code: code.code,
      name: "viewer",
      secret,
    });
    assert.equal(claim.status, 200);
    assert.equal(
      (await request("/v1/pairing/poll", { id: claim.body.id, secret })).body
        .status,
      "pending",
    );
    await call(`/devices/${claim.body.id}/approve`, {
      role: "viewer",
      workspaces: [workspace.id],
    });
    const poll = await request("/v1/pairing/poll", {
      id: claim.body.id,
      secret,
    });
    const cookie = poll.headers["set-cookie"][0].split(";")[0];
    assert.ok(poll.headers["set-cookie"][0].includes("HttpOnly"));
    assert.ok(poll.headers["set-cookie"][0].includes("Secure"));
    const snapshot = await request("/v1/snapshot", undefined, cookie);
    assert.equal(snapshot.status, 200);
    assert.deepEqual(
      snapshot.body.sessions.map((s) => s.id),
      [visible.id],
    );
    assert.equal(
      (
        await request(
          `/v1/sessions/${visible.id}/messages`,
          { text: "forbidden" },
          cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (await request(`/v1/sessions/${invisible.id}/tree`, undefined, cookie))
        .status,
      403,
    );
    assert.equal((await request("/v1/devices", undefined, cookie)).status, 403);
    const events = await request("/v1/event-log?after=0", undefined, cookie);
    assert.ok(
      events.body.events.every((event) => event.sessionId === visible.id),
    );
    await call(`/devices/${claim.body.id}/revoke`, {});
    assert.equal(
      (await request("/v1/snapshot", undefined, cookie)).status,
      401,
    );
    // Browser context exercises actual Secure cookies and WSS, with OS trust setup left for physical-device acceptance.
    const browser = await chromium.launch({
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
        (process.platform === "darwin"
          ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
          : undefined),
    });
    t.after(() => browser.close());
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const operatorCode = await call("/pairing/code", {});
    await page.goto(remote.url);
    await page.getByLabel("设备名称").fill("test phone");
    await page.getByLabel("电脑上的配对码").fill(operatorCode.code);
    await page.getByRole("button", { name: "请求配对", exact: true }).click();
    let operator;
    for (let i = 0; i < 100; i++) {
      operator = (await call("/devices")).claims.find(
        (claim) => claim.name === "test phone",
      );
      if (operator) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.ok(operator);
    await call(`/devices/${operator.id}/approve`, {
      role: "operator",
      workspaces: [workspace.id],
    });
    await page.getByText("本机 · 已连接", { exact: true }).waitFor();
    await page.getByRole('combobox',{name:'主题',exact:true}).selectOption('dark');
    await page.locator(".desktop-session").first().click();
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.getByRole('textbox',{name:'发送任务'}).fill('/activity');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    const liveActivity=page.locator('.desktop-activity[data-live="true"]');
    await liveActivity.getByText('演示：整理执行结果',{exact:true}).waitFor();
    assert.ok(await liveActivity.locator('.desktop-activity-preview-row').count()<=3);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-chat-activity-mobile.png')});
    await page.getByText('本轮执行结束',{exact:true}).waitFor();

    await page.getByRole('textbox',{name:'发送任务'}).fill('/rich-tools');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await page.getByText('工具视图演示已完成。没有搜索网页或执行命令。',{exact:true}).waitFor();
    await page.getByText('本轮执行结束',{exact:true}).waitFor();
    const mobileTool=page.locator('.desktop-turn').last().getByRole('region',{name:'Agent 处理过程'});
    await mobileTool.getByRole('button').click();
    await mobileTool.locator('.desktop-tool-group').first().locator(':scope > summary').click();
    await mobileTool.locator('.desktop-activity-item.tool').first().locator(':scope > summary').click();
    await mobileTool.getByText('测试查询一',{exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-tool-details-mobile.png')});
    const nav=page.getByRole('navigation',{name:'对话导航'});
    await nav.getByRole('button').last().focus();
    await nav.getByRole('tooltip').waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-navigation-mobile.png')});
    await nav.getByRole('button').first().click();
    await page.waitForFunction(()=>document.querySelector('.desktop-conversation-marks button')?.getAttribute('aria-current')==='location');
    await page.getByRole('button',{name:'回到最新消息',exact:true}).click();

    await page.getByRole("textbox", { name: "发送任务" }).fill("/approve");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.getByRole("button", { name: "允许一次", exact: true }).click();
    await page
      .getByText("你已允许一次，演示审批链路完成。", { exact: true })
      .waitFor();
    await page.getByRole("textbox", { name: "发送任务" }).fill("/wait");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.getByRole("button", { name: "停止执行", exact: true }).click();
    await page.getByText("本轮已停止", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.getByRole('button',{name:'文件',exact:true}).click();
    await page.getByRole('complementary',{name:'工作区预览'}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-live-tools-mobile.png')});
    await page.getByRole('button',{name:'收起右侧面板',exact:true}).click();
    await page.getByRole('button',{name:'会话列表',exact:true}).click();
    await page.getByRole('button',{name:'连接与设置',exact:true}).click();
    const settingsNav=page.getByRole('navigation',{name:'设置分类'});
    await settingsNav.getByRole('button',{name:'常规',exact:true}).waitFor();
    assert.equal(await settingsNav.getByRole('button').count(),3,'remote devices cannot manage host profiles/plugins/devices');
    await settingsNav.getByRole('button',{name:'外观',exact:true}).click();
    await page.getByRole('button',{name:'亮色',exact:true}).click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-live-settings-mobile.png')});
    await page.getByRole('button',{name:'返回工作台',exact:true}).click();
    await page.getByRole("button", { name: "会话列表", exact: true }).click();
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    await page
      .getByLabel("工作区", { exact: true })
      .selectOption(workspace.path);
    await page.getByRole("button", { name: "创建会话", exact: true }).click();
    await page.getByRole("textbox", { name: "发送任务" }).fill("手机新建会话");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.getByText("本轮执行结束", { exact: true }).waitFor();
    await call(`/devices/${operator.id}/revoke`, {});
    await page.getByRole("button", { name: "请求配对", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await call("/remote", { enabled: false });
  },
);
