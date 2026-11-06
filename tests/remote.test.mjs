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
    const privateProfileCommand={name:'Owner profile receipt',provider:'demo',key:'owner-profile-receipt'};
    await call('/profiles',privateProfileCommand);
    const workspace = await call("/workspaces", { path: directory });
    const hidden = join(directory, "hidden");
    await mkdir(hidden);
    await call("/workspaces", { path: hidden });
    const visible = await call("/sessions", {
      key: 'visible-creation',
      workspace: workspace.path,
      provider: "demo",
    });
    const invisible = await call("/sessions", {
      key: 'hidden-creation',
      workspace: hidden,
      provider: "demo",
    });
    await call(`/sessions/${visible.id}/cancel`,{key:'visible-stop-receipt'});
    await call(`/sessions/${invisible.id}/cancel`,{key:'hidden-stop-receipt'});
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
    const unknownApi=await request('/v1/not-a-route');
    assert.equal(unknownApi.status,401);
    assert.equal(unknownApi.body.code,'UNAUTHENTICATED','API paths must not fall through to HTML');

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
    const deniedApi=await request('/v1/not-a-route',undefined,cookie);
    assert.equal(deniedApi.status,403);assert.equal(deniedApi.body.code,'FORBIDDEN');

    assert.deepEqual(snapshot.body.operations,[]);
    assert.equal((await request("/v1/operations",undefined,cookie)).status,403);
    assert.equal((await request("/v1/operations/unknown",undefined,cookie)).status,403);
    assert.equal((await request("/v1/plugins/unknown/operations",{key:"blocked"},cookie)).status,403);
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
    assert.equal((await request(`/v1/sessions/${visible.id}/history`, undefined, cookie)).status,200);
    assert.equal((await request(`/v1/sessions/${invisible.id}/history`, undefined, cookie)).status,403);
    assert.equal((await request(`/v1/sessions/${visible.id}/history`)).status,401);
    assert.equal((await request('/v1/sessions',{provider:'demo',workspace:workspace.path,key:'visible-creation'},cookie)).status,403,'a known creation receipt cannot grant viewer execution rights');
    assert.equal((await request("/v1/devices", undefined, cookie)).status, 403);
    assert.equal((await request("/v1/providers/demo/probe", {}, cookie)).status, 403);
    assert.equal((await request("/v1/profiles", undefined, cookie)).status, 403);
    assert.equal((await request('/v1/profiles',privateProfileCommand,cookie)).status,403,'known configuration receipts remain owner-only');
    assert.equal((await request(`/v1/sessions/${visible.id}/cancel`,{key:'visible-stop-receipt'},cookie)).status,403,'stop receipts do not grant viewer execution rights');
    assert.equal((await request('/v1/plugin-lifecycle/operations',{key:'remote-denied',action:'inspect',input:{path:directory}},cookie)).status,403);
    assert.equal((await request(`/v1/sessions/${visible.id}/attachments`,{name:'forbidden.txt',mimeType:'text/plain',data:'dGV4dA=='},cookie)).status,403);
    assert.equal((await request(`/v1/sessions/${visible.id}/context/resume`,{},cookie)).status,403);
    assert.equal((await request(`/v1/sessions/${invisible.id}/context/resume`,{},cookie)).status,403);
    const events = await request("/v1/event-log?after=0", undefined, cookie);
    assert.ok(
      events.body.events.every((event) => event.sessionId === visible.id),
    );
    const sync = await request('/v1/sync', undefined, cookie);
    assert.equal(sync.status,200);
    assert.deepEqual(sync.body.snapshot.sessions.map(session=>session.id),[visible.id]);
    await call(`/sessions/${visible.id}/metadata`,{title:'visible sync title'});
    await call(`/sessions/${invisible.id}/metadata`,{title:'secret sync title'});
    const delta = await request(`/v1/sync?epoch=${sync.body.epoch}&after=${sync.body.cursor}`,undefined,cookie);
    assert.equal(delta.status,200);
    assert.deepEqual(delta.body.visibleSessionIds,[visible.id]);
    assert.equal(delta.body.events.length,1);
    assert.equal(delta.body.events[0].session.id,visible.id);
    assert.equal(JSON.stringify(delta.body).includes('secret sync title'),false);
    await call(`/devices/${claim.body.id}/revoke`, {});
    assert.equal(
      (await request("/v1/snapshot", undefined, cookie)).status,
      401,
    );
    assert.equal((await request('/v1/sync', undefined, cookie)).status,401);
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
    assert.equal(await page.evaluate(async body=>(await fetch('/v1/profiles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,privateProfileCommand),403,'operator devices cannot replay Owner configuration commands');
    assert.equal(await page.evaluate(async id=>(await fetch(`/v1/sessions/${id}/cancel`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'hidden-stop-receipt'})})).status,invisible.id),403,'operator stop receipts remain scoped to authorized workspaces');
    const replays=await page.evaluate(async({directory,hidden})=>{
      const replay=async(workspace,key)=>{const response=await fetch('/v1/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'demo',workspace,key})});return {status:response.status,body:await response.json()};};
      return [await replay(directory,'visible-creation'),await replay(hidden,'hidden-creation')];
    },{directory:workspace.path,hidden});
    assert.equal(replays[0].status,200);assert.equal(replays[0].body.id,visible.id);
    assert.equal(replays[1].status,403);assert.equal(replays[1].body.id,undefined,'a durable receipt must not disclose a forbidden session');
    await page.getByRole('combobox',{name:'主题',exact:true}).selectOption('dark');
    await page.locator(".desktop-session").first().click();
    await page.getByRole('textbox',{name:'发送任务'}).fill('/fi');
    await page.getByRole('option',{name:/files/}).waitFor();
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-composer-mobile.png')});
    assert.equal(await page.locator('.composer-picker').evaluate(element=>{const r=element.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0;}),true);
    await page.getByRole('textbox',{name:'发送任务'}).press('Escape');
    await page.getByRole('textbox',{name:'发送任务'}).fill('@');
    const folderReference=page.getByRole('button',{name:/引用当前工作区文件夹/});
    await folderReference.waitFor();
    assert.ok((await folderReference.boundingBox()).height>=44);
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-folder-reference-mobile.png')});
    await folderReference.click();
    await page.getByRole('button',{name:'移除引用 ./',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'发送消息',exact:true}).isEnabled(),true,'a context-only draft can be sent');
    await page.getByRole('button',{name:'移除引用 ./',exact:true}).click();
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.getByRole('textbox',{name:'发送任务'}).fill('/activity');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    const liveActivity=page.locator('.desktop-activity[data-live="true"]');
    await liveActivity.getByText('演示：整理执行结果',{exact:true}).waitFor();
    assert.ok(await liveActivity.locator('.desktop-activity-preview-row').count()<=3);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-chat-activity-mobile.png')});
    await page.getByText('本轮执行结束',{exact:true}).waitFor();

    await page.getByRole('textbox',{name:'发送任务'}).fill('/input-choices');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    const inputPanel=page.getByRole('region',{name:'需要补充信息',exact:true});
    await inputPanel.getByRole('radio',{name:/绿色/}).check();
    await inputPanel.getByRole('checkbox',{name:/启用提醒/}).check();
    await inputPanel.getByRole('radio',{name:/绿色/}).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-structured-input-mobile.png')});
    assert.ok(await inputPanel.getByRole('button',{name:'提交回答',exact:true}).evaluate(node=>node.getBoundingClientRect().height>=44));
    await inputPanel.getByRole('button',{name:'提交回答',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-structured-input-mobile-actions.png')});
    await inputPanel.getByRole('button',{name:'提交回答',exact:true}).click();
    await page.getByText('已收到结构化回答：{"color":"green","count":2,"notify":true}',{exact:true}).waitFor();

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
    await wait(visible.id,session=>session.status==='idle'&&session.runs.at(-1)?.status==='completed');
    await page.getByRole("textbox", { name: "发送任务" }).fill("/wait");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const waitingRun=await wait(visible.id,session=>session.status==='running'&&session.runs.at(-1)?.text==='/wait');
    const stopRequest=page.waitForRequest(request=>new URL(request.url()).pathname.endsWith('/cancel'));
    await page.getByRole("button", { name: "停止执行", exact: true }).click();
    const stopBody=(await stopRequest).postDataJSON();assert.equal(typeof stopBody.key,'string');assert.equal(stopBody.runId,waitingRun.runs.at(-1).id);
    await page.getByText("本轮已停止", { exact: true }).waitFor();
    const stoppedRun=await wait(visible.id,session=>session.stopReason==='cancelled'&&session.runs.at(-1)?.id===waitingRun.runs.at(-1).id&&session.runs.at(-1)?.status==='cancelled');
    assert.equal(stoppedRun.queuePaused,true);
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
    await settingsNav.getByRole('button',{name:'通知',exact:true}).click();
    await page.getByText('系统权限',{exact:true}).waitFor();
    await page.getByRole('button',{name:'刷新通知权限',exact:true}).click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:join(tmpdir(),'vibeone-notifications-mobile.png')});
    await page.getByRole('button',{name:'返回工作台',exact:true}).click();
    await page.getByRole("button", { name: "会话列表", exact: true }).click();
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    await page
      .getByLabel("工作区", { exact: true })
      .selectOption(workspace.path);
    await page.getByRole("button", { name: "创建会话", exact: true }).click();
    const phoneImage=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
    await page.locator('.desktop-attachment-picker input[type=file]').setInputFiles({name:'phone.png',mimeType:'image/png',buffer:phoneImage});
    await page.locator('.desktop-attachment-picker').getByRole('img',{name:'phone.png',exact:true}).waitFor();
    await page.screenshot({path:join(tmpdir(),'vibeone-mobile-attachment.png')});
    await page.getByRole("textbox", { name: "发送任务" }).fill("手机新建会话");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.getByText("本轮执行结束", { exact: true }).waitFor({timeout:8000}).catch(async error=>{
      await page.screenshot({path:join(tmpdir(),'vibeone-remote-send-failure.png')});
      const snapshot=await call('/snapshot');
      throw Error(`${error.message}\n${(await page.locator('body').innerText()).slice(-5000)}\n${JSON.stringify(snapshot.sessions.map(session=>({title:session.title,status:session.status,error:session.error,queue:session.queue?.length})))}`);
    });
    const mobileHistory=await call('/sessions',{provider:'demo',workspace:directory});
    await call(`/sessions/${mobileHistory.id}/metadata`,{title:'手机历史分页'});
    await call(`/sessions/${mobileHistory.id}/messages`,{text:'/history-test'});
    await wait(mobileHistory.id,session=>session.runs.some(run=>run.status==='completed'));
    await page.reload();
    const historyRow=page.locator('.desktop-session').filter({hasText:'手机历史分页'});
    await historyRow.getByText('就绪',{exact:true}).waitFor();
    await historyRow.click();
    await page.getByRole('button',{name:'加载更早记录',exact:true}).click();
    await page.locator('.desktop-message.user .desktop-message-text').getByText('/history-test',{exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:join(tmpdir(),'vibeone-history-mobile.png')});
    await call(`/devices/${operator.id}/revoke`, {});
    await page.getByRole("button", { name: "请求配对", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await call("/remote", { enabled: false });
  },
);
