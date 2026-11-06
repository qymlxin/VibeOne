import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";

test(
  "desktop React view controls the live Host: messages, approvals, stop, themes and reconnect",
  { timeout: 90_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "vibeone-desktop-test-"));
    await writeFile(join(directory,'preview.txt'),'workspace preview text\n');
    await mkdir(join(directory,'folder name'));
    await writeFile(join(directory,'folder name','child.txt'),'nested text');
    const git=(...args)=>execFileSync('git',['-C',directory,...args],{stdio:'ignore'});
    git('init');
    await writeFile(join(directory,'tracked.txt'),'before\nkept\n');
    git('add','tracked.txt');git('-c','user.name=Test','-c','user.email=test@example.com','commit','-m','fixture');
    await writeFile(join(directory,'tracked.txt'),'staged\nkept\n');git('add','tracked.txt');
    await writeFile(join(directory,'tracked.txt'),'unstaged\nkept\n');
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
      await page.screenshot({path:join(tmpdir(),"vibeone-desktop-final-state.png")}).catch(()=>{});
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
    assert.ok(managed.features.includes('queuePause'));
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
    await page.getByRole('button',{name:'按项目',exact:true}).click();
    assert.ok(await page.locator('.desktop-project-group').count()>=2);
    await page.screenshot({path:join(tmpdir(),'vibeone-session-projects.png')});
    const firstGroup=page.locator('.desktop-project-group').first();
    await firstGroup.locator('.desktop-project-heading').click();
    assert.equal(await firstGroup.locator('.desktop-session').count(),0);
    await page.getByRole('button',{name:'最近',exact:true}).click();
    await page.getByRole('button',{name:'收起会话栏',exact:true}).click();
    assert.equal(await page.locator('.desktop-sidebar').isVisible(),false);
    await page.keyboard.press('Control+k');
    await page.waitForFunction(()=>document.querySelector('[aria-label="搜索会话"]')===document.activeElement);
    await page.getByRole('textbox',{name:'搜索会话',exact:true}).fill('no-matching-session');
    await page.getByText('没有匹配的会话',{exact:true}).waitFor();
    await page.getByRole('textbox',{name:'搜索会话',exact:true}).fill('');
    await page.getByRole('button',{name:'添加项目',exact:true}).click();
    await page.getByRole('heading',{name:'工作区',exact:true,level:1}).waitFor();
    await page.getByRole('button',{name:'返回工作台',exact:true}).click();
    const composer=page.getByRole('textbox',{name:'发送任务'});
    await composer.fill('/fi');
    await page.getByRole('option',{name:/files/}).waitFor();
    await composer.press('Enter');
    await page.getByRole('heading',{name:'工作区文件',exact:true}).waitFor();
    assert.equal(await composer.inputValue(),'');
    await composer.fill('/terminal');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await page.locator('.desktop-right-panel-header strong').getByText('终端',{exact:true}).waitFor();
    assert.equal(await composer.inputValue(),'');
    assert.equal(await page.locator('.desktop-message.user').count(),0);
    await composer.fill('/files');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await page.getByRole('heading',{name:'工作区文件',exact:true}).waitFor();
    await page.getByRole('button',{name:'引用文件',exact:true}).click();
    await writeFile(join(directory,'new-reference.txt'),'new file after opening picker');
    await composer.fill('@new-reference');
    await page.getByRole('button',{name:'刷新引用目录',exact:true}).click();
    await page.getByRole('option',{name:/new-reference.txt/}).waitFor();
    await composer.fill('@folder');
    await page.getByRole('option',{name:/folder name/}).click();
    await page.getByRole('option',{name:/child.txt/}).waitFor();
    await page.getByRole('button',{name:/上级目录/}).click();
    await page.getByRole('option',{name:/folder name/}).waitFor();
    await composer.fill('@preview');
    await page.getByRole('option',{name:/preview.txt/}).waitFor();
    await page.screenshot({path:join(tmpdir(),'vibeone-composer-light.png')});
    await page.emulateMedia({colorScheme:'dark'});
    await page.waitForTimeout(150);
    await page.screenshot({path:join(tmpdir(),'vibeone-composer-dark.png')});
    await page.emulateMedia({colorScheme:'light'});
    await page.waitForTimeout(150);
    await composer.press('Tab');
    await page.getByRole('button',{name:'移除引用 preview.txt'}).waitFor();

    const explorer=page.getByRole('region',{name:'文件浏览器',exact:true});
    await explorer.getByRole('button',{name:'folder name',exact:true}).click();
    await explorer.getByRole('button',{name:'child.txt',exact:true}).click();
    await explorer.locator('.explorer-code code').getByText('nested text',{exact:true}).waitFor();
    assert.equal(await explorer.locator('.explorer-line-number').first().innerText(),'1');
    await explorer.getByRole('textbox',{name:'筛选文件'}).fill('child');
    assert.equal(await explorer.getByRole('button',{name:'preview.txt',exact:true}).count(),0);
    await explorer.getByRole('button',{name:'收起文件列表'}).click();
    assert.equal(await explorer.getByRole('complementary',{name:'文件列表'}).count(),0);
    await explorer.getByRole('button',{name:'显示文件列表',exact:true}).click();
    await page.getByRole('button',{name:'变更',exact:true}).click();
    const changes=page.getByRole('region',{name:'变更浏览器',exact:true});
    await changes.getByRole('textbox',{name:'筛选文件'}).fill('tracked.txt');
    await changes.getByRole('button',{name:/tracked.txt/}).click();
    await changes.locator('.explorer-code-line.added code').getByText('+unstaged',{exact:true}).waitFor();
    await changes.getByRole('button',{name:'已暂存差异',exact:true}).click();
    await changes.locator('.explorer-code-line.added code').getByText('+staged',{exact:true}).waitFor();
    await page.screenshot({path:join(tmpdir(),'vibeone-explorer-diff.png')});
    const imageBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
    await page.evaluate(bytes=>{const clipboard=new DataTransfer();clipboard.items.add(new File([new Uint8Array(bytes)],'pixel.png',{type:'image/png'}));document.querySelector('[aria-label="发送任务"]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}));},[...imageBytes]);
    await page.locator('.desktop-attachment-picker').getByRole('img',{name:'pixel.png',exact:true}).waitFor();
    await page.evaluate(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['drop fixture'],'dropped.txt',{type:'text/plain'}));document.querySelector('.desktop-composer').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));});
    await page.getByRole('button',{name:'移除附件 dropped.txt',exact:true}).click();
    await page.screenshot({path:join(tmpdir(),'vibeone-attachment-draft.png')});
    await composer.fill('桌面集成测试 /thought');
    await composer.press('Enter');
    await page.getByText("本轮执行结束", { exact: true }).waitFor({timeout:8000}).catch(async error=>{throw new Error(`${error.message}\nReact errors: ${JSON.stringify(errors)}\n${(await page.locator("body").innerText()).slice(-6000)}`);});
    assert.equal(await page.getByRole('button',{name:'移除引用 preview.txt'}).count(),0);
    assert.equal(await page.getByRole('button',{name:'移除附件 pixel.png'}).count(),0);
    await page.locator('.desktop-message.user').getByRole('img',{name:'pixel.png',exact:true}).waitFor();
    const fileDownload=page.waitForEvent('download');
    await page.locator('.desktop-message.user').getByRole('button',{name:'下载附件',exact:true}).click();
    const downloaded=await fileDownload;
    assert.equal(downloaded.suggestedFilename(),'pixel.png');
    assert.deepEqual(await readFile(await downloaded.path()),imageBytes);
    assert.match(await page.locator('.desktop-message.user').first().innerText(),/workspace preview text/);
    assert.equal(await page.locator(".desktop-message.user").count(), 1);
    assert.equal(await page.locator(".desktop-message.assistant").count(), 1);
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedAnswer=text;}}}));
    await page.getByRole('button',{name:'复制回答',exact:true}).first().click();
    const copySnapshot=await (await fetch(`${connection.url}/v1/snapshot`,{headers:{Authorization:`Bearer ${connection.token}`}})).json();
    const copiedSource=copySnapshot.sessions.flatMap(session=>session.messages).find(message=>message.role==='assistant'&&message.text.includes('桌面集成测试 /thought'));
    assert.equal(await page.evaluate(()=>window.__copiedAnswer),copiedSource.text);
    await page.locator('.desktop-answer-actions [role=status]').first().getByText('已复制',{exact:true}).waitFor();
    const config=page.locator('.desktop-agent-config.compact');
    await config.locator(':scope > summary').click();
    await page.getByRole('combobox',{name:'输入区配置：演示模式',exact:true}).selectOption('normal');
    await config.getByRole('status').getByText('已应用演示模式',{exact:true}).waitFor();
    await page.screenshot({path:join(tmpdir(),'vibeone-agent-config-composer.png')});
    assert.equal(await page.getByRole('combobox',{name:'输入区配置：演示模式',exact:true}).inputValue(),'normal');
    await page.route('**/v1/sessions/*/configure',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Agent 拒绝测试配置'})}));
    await page.getByRole('combobox',{name:'输入区配置：演示模式',exact:true}).selectOption('safe');
    await config.getByRole('alert').getByText('Agent 拒绝测试配置',{exact:true}).waitFor();
    assert.equal(await page.getByRole('combobox',{name:'输入区配置：演示模式',exact:true}).inputValue(),'normal');
    await page.unroute('**/v1/sessions/*/configure');
    await page.getByRole('combobox',{name:'输入区配置：演示模式',exact:true}).selectOption('safe');
    await page.waitForFunction(()=>document.querySelector('[aria-label="输入区配置：演示模式"]')?.value==='safe'&&!document.querySelector('[aria-label="输入区配置：演示模式"]')?.disabled);
    await config.locator(':scope > summary').click();
    assert.equal(await page.locator('.desktop-message.thought').count(),0,'thoughts should not expand into the conversation body');
    const firstProcess=page.getByRole('region',{name:'Agent 处理过程'}).first();
    assert.equal(await firstProcess.getByRole('button').getAttribute('aria-expanded'),'false');
    await firstProcess.getByRole('button').click();
    await firstProcess.locator('.desktop-activity-item.thought summary').click();
    assert.equal(await firstProcess.locator('.desktop-process-thought').innerText(),'演示进度摘要：正在准备回复。');
    await firstProcess.getByRole('button').click();
    await page.locator('.desktop-attachment-picker input[type=file]').setInputFiles({name:'image-only.png',mimeType:'image/png',buffer:imageBytes});
    await page.locator('.desktop-attachment-picker').getByRole('img',{name:'image-only.png',exact:true}).waitFor();
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await page.locator('.desktop-message.user').getByRole('img',{name:'image-only.png',exact:true}).waitFor();
    await page.waitForFunction(()=>!document.querySelector('.desktop-activity[data-live="true"]')&&[...document.querySelectorAll('.desktop-turn')].at(-1)?.querySelector('.desktop-message.assistant .desktop-message-text')?.textContent.includes('附件回执 image'));
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.getByRole('textbox',{name:'发送任务'}).fill('/activity');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await page.getByRole('textbox',{name:'发送任务'}).fill('排队控制测试消息');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    const queue=page.locator('.desktop-queue');
    await queue.getByRole('button',{name:'暂停队列',exact:true}).click();
    await queue.getByText('排队消息已暂停；正在执行的任务继续，恢复后再开始下一轮。',{exact:true}).waitFor();
    await queue.getByRole('button',{name:'继续队列',exact:true}).click();
    await queue.getByRole('button',{name:'暂停队列',exact:true}).click();
    await queue.getByRole('button',{name:'撤回',exact:true}).click();
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
    const post=async(path,body)=>{const response=await fetch(`${connection.url}/v1${path}`,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.ok,true);return response.json();};
    const noMediaProfile=await post('/profiles',{name:'no media UI',provider:'demo',args:[join(directory,'demo-agent.mjs'),'--no-media']});
    const unsupportedSession=await post('/sessions',{provider:'demo',workspace:directory,profileId:noMediaProfile.id});
    await post(`/sessions/${unsupportedSession.id}/metadata`,{title:'附件能力验证'});
    await page.getByRole('button',{name:/^附件能力验证 本地演示/}).click();
    await page.locator('.desktop-attachment-picker input[type=file]').setInputFiles({name:'unsupported.png',mimeType:'image/png',buffer:imageBytes});
    await page.locator('.desktop-attachment-picker').getByRole('img',{name:'unsupported.png',exact:true}).waitFor();
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await page.getByRole('button',{name:'恢复失败任务到输入框（不会自动发送）',exact:true}).click();
    await page.getByRole('button',{name:'移除附件 unsupported.png',exact:true}).click();
    await page.getByRole('textbox',{name:'发送任务'}).fill('修复后继续');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.desktop-activity[data-live="true"]')&&[...document.querySelectorAll('.desktop-turn')].at(-1)?.querySelector('.desktop-message.assistant .desktop-message-text')?.textContent.includes('修复后继续'));
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

    await page.getByRole('textbox',{name:'发送任务'}).fill('/read-tools');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await page.getByText('文件读取视图演示完成。没有实际读取文件。',{exact:true}).waitFor();
    const reads=page.locator('.desktop-turn').last();
    await reads.locator('.desktop-activity-toggle').click();
    await reads.getByText('已读取文件',{exact:true}).click();
    await reads.getByText('已读取 main.rs',{exact:true}).click();
    await reads.locator('.desktop-tool-files code').getByText('/demo/src/main.rs',{exact:true}).waitFor();
    assert.equal(await reads.locator('.desktop-tool-raw[open]').count(),0);
    const navigation=page.getByRole('navigation',{name:'对话导航'});
    assert.equal(await navigation.getByRole('button').count(),await page.locator('.desktop-turn[data-turn-id]').count());
    await navigation.getByRole('button').last().focus();
    await navigation.getByRole('tooltip').waitFor();
    await page.getByRole('combobox',{name:'主题',exact:true}).selectOption('light');
    await navigation.getByRole('button').first().focus();
    await navigation.getByRole('button').first().press('End');
    assert.equal(await navigation.getByRole('button').last().evaluate(button=>button===document.activeElement),true);
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-navigation-events-light.png')});
    await page.getByRole('combobox',{name:'主题',exact:true}).selectOption('dark');
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-navigation-events-dark.png')});
    await navigation.getByRole('button').first().click();
    await page.waitForFunction(()=>document.querySelector('.desktop-conversation-marks button')?.getAttribute('aria-current')==='location');
    assert.ok(await page.locator('.desktop-timeline').evaluate(root=>root.scrollTop<60));
    await page.getByRole('button',{name:'回到最新消息',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.desktop-conversation-marks button:last-child')?.getAttribute('aria-current')==='location');

    await page.getByRole('button',{name:'设置会话头像：已保存的桌面会话',exact:true}).click();
    await page.getByRole('button',{name:'头像颜色 #8055CF',exact:true}).click();
    await page.getByRole('button',{name:'六边形',exact:true}).click();
    await page.getByRole('button',{name:'关闭头像设置',exact:true}).click();
    await page.route('https://example.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8"><h1>隔离网页预览测试</h1>'}));
    await page.getByRole('textbox',{name:'发送任务'}).fill('/preview');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await page.getByRole('link',{name:'工作区文件',exact:true}).waitFor();
    await page.getByRole('link',{name:'工作区文件',exact:true}).click();
    await page.locator('.desktop-file-preview pre').getByText('workspace preview text',{exact:true}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'发送任务'}).isVisible(),true,'opening files retains the conversation and composer');
    const paneWidth=await page.locator('.desktop-right-panel').evaluate(node=>node.clientWidth);
    await page.getByRole('button',{name:'扩大预览',exact:true}).click();
    assert.ok(await page.locator('.desktop-right-panel').evaluate(node=>node.clientWidth)>paneWidth);
    await page.getByRole('button',{name:'恢复面板宽度',exact:true}).click();
    await page.getByRole('separator',{name:'调整右侧预览宽度'}).press('ArrowLeft');
    assert.ok(await page.locator('.desktop-right-panel').evaluate(node=>node.clientWidth)>paneWidth);
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-live-workbench-files.png')});
    await page.getByRole('link',{name:'网页预览',exact:true}).click();
    assert.equal(await page.locator('iframe[title="网页预览"]').getAttribute('sandbox'),'allow-scripts allow-forms');
    await page.frameLocator('iframe[title="网页预览"]').getByRole('heading',{name:'隔离网页预览测试'}).waitFor({timeout:5000}).catch(async error=>{await page.screenshot({path:join(tmpdir(),'vibeone-browser-failure.png')});throw Error(`${error.message}\nframes: ${page.frames().map(frame=>frame.url()).join(',')}\nsrc: ${await page.locator('iframe').getAttribute('src')}\n${await page.locator('.desktop-browser').innerText()}`);});

    await page.getByRole('textbox',{name:'预览网址',exact:true}).fill('https://example.com/other');
    await page.getByRole('button',{name:'打开网址预览',exact:true}).click();
    await page.getByRole('button',{name:'返回上一网页',exact:true}).click();
    assert.equal(await page.locator('iframe[title="网页预览"]').getAttribute('src'),'https://example.com/docs');
    await page.getByRole('button',{name:'前进到下一网页',exact:true}).click();
    assert.equal(await page.locator('iframe[title="网页预览"]').getAttribute('src'),'https://example.com/other');
    await page.getByRole('button',{name:'收起右侧面板',exact:true}).click();
    await page.getByRole('button',{name:'终端',exact:true}).click();
    await page.getByRole('heading',{name:'Agent 终端输出（只读）',exact:true}).waitFor();
    const terminal=page.locator('.desktop-terminal');
    await terminal.locator(':scope > details').last().locator(':scope > summary').click();
    await terminal.getByRole('button',{name:'定位到对应对话',exact:true}).last().click();
    await page.locator('.desktop-turn:focus').waitFor();
    await page.getByRole('button',{name:'收起右侧面板',exact:true}).click();
    await page.getByRole("button", { name: "连接与设置", exact: true }).click();
    const settingsNav=page.getByRole('navigation',{name:'设置分类'});
    await settingsNav.getByRole('button',{name:'常规',exact:true}).waitFor();
    assert.equal(await settingsNav.getByRole('button').count(),8);
    await page.getByRole('textbox',{name:'搜索设置'}).fill('配对');
    assert.equal(await settingsNav.getByRole('button').count(),1);
    await page.getByRole('textbox',{name:'搜索设置'}).fill('');
    await settingsNav.getByRole('button',{name:'Agent',exact:true}).click();
    await page.getByRole('button',{name:'新建 Agent 配置',exact:true}).click();
    await page.getByRole('textbox',{name:'配置名称',exact:true}).fill('桌面审阅配置');
    await page.getByRole('textbox',{name:'启动参数 JSON',exact:true}).fill('{bad');
    await page.getByRole('button',{name:'保存配置',exact:true}).click();
    await page.getByText('启动参数不是有效 JSON。',{exact:true}).waitFor();
    await page.getByRole('textbox',{name:'自定义 ACP 启动程序',exact:true}).fill('/tmp/test-only-adapter');
    await page.getByRole('button',{name:'恢复默认入口',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'自定义 ACP 启动程序',exact:true}).inputValue(),'');
    assert.equal(await page.getByRole('textbox',{name:'启动参数 JSON',exact:true}).inputValue(),'');
    await page.getByRole('textbox',{name:'启动参数 JSON',exact:true}).fill('');
    await page.getByRole('button',{name:'保存配置',exact:true}).click();
    await page.locator('.desktop-settings-object-list').getByRole('button').filter({hasText:'桌面审阅配置'}).waitFor();
    await settingsNav.getByRole('button',{name:'外观',exact:true}).click();
    await page.getByLabel('背景颜色',{exact:true}).fill('#151515');
    await page.getByRole('button',{name:'亮色',exact:true}).click();
    await page.getByLabel('背景颜色',{exact:true}).fill('#f4f1eb');
    await page.getByRole('button',{name:'暗色',exact:true}).click();
    assert.equal(await page.getByLabel('背景颜色',{exact:true}).inputValue(),'#151515');
    await page.getByRole('button',{name:'恢复默认配色',exact:true}).click();
    await page.screenshot({animations:'disabled',path:join(tmpdir(),'vibeone-live-settings-appearance.png')});
    await settingsNav.getByRole('button',{name:'插件',exact:true}).click();
    await page.getByText('安装 / 更新本地插件',{exact:true}).click();

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

    await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'数据与诊断',exact:true}).click();
    await page.getByRole('button',{name:'重启工作主机',exact:true}).click();
    await page.getByText('正在重启工作主机',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'重新连接',exact:true}).isDisabled(),true);
    assert.equal((await page.locator('body').innerText()).includes('Load failed'),false);
    await page.getByText('工作主机 · 本机已连接',{exact:true}).waitFor();

    await page.reload();
    await page.getByText('工作主机 · 本机已连接',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('vibeone-appearance-v1')).light.background),'#f4f1eb');
    assert.ok(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('vibeone-avatar:')).some(key=>JSON.parse(localStorage.getItem(key)).shape==='hexagon')));
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  },
);
