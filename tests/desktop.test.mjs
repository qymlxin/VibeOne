import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
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
    await mkdir(join(directory,'.agents','skills','composer-review'),{recursive:true});
    await writeFile(join(directory,'.agents','skills','composer-review','SKILL.md'),'# Composer review\nUse the project skill fixture for review.');
    const git=(...args)=>execFileSync('git',['-C',directory,...args],{stdio:'ignore'});
    git('init');
    await writeFile(join(directory,'tracked.txt'),'before\nkept\n');
    git('add','tracked.txt');git('-c','user.name=Test','-c','user.email=test@example.com','commit','-m','fixture');
    await writeFile(join(directory,'tracked.txt'),'staged\nkept\n');git('add','tracked.txt');
    await writeFile(join(directory,'tracked.txt'),'unstaged\nkept\n');
    let child = spawn(
      resolve("target/debug/vibeone-host"),
      ["serve", "--data-dir", directory],
      { stdio: "ignore" },
    );
    let exited = once(child, "exit");
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
    // Seed a malformed legacy catalog row only while this disposable Host is stopped.
    await fetch(`${connection.url}/v1/host/stop`,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`}});
    await exited;
    execFileSync('python3',['-c',
      'import sqlite3,json,sys; db=sqlite3.connect(sys.argv[1]); db.execute("INSERT INTO catalog(kind,id,value) VALUES(?,?,?)",("profile","corrupt-fixture",json.dumps({"id":"corrupt-fixture","name":"Invalid","provider":"demo","revision":1,"args":[42]}))); db.commit(); db.close()',
      join(directory,'vibeone.sqlite3')]);
    await rm(join(directory,'host.json'),{force:true});
    child=spawn(resolve('target/debug/vibeone-host'),['serve','--data-dir',directory],{stdio:'ignore'});
    exited=once(child,'exit');
    connection=null;
    for(let attempt=0;attempt<200;attempt++){
      try{connection=JSON.parse(await readFile(join(directory,'host.json'),'utf8'));if((await fetch(`${connection.url}/v1/snapshot`,{headers:{Authorization:`Bearer ${connection.token}`}})).ok)break;}catch{}
      await sleep(30);
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
        window.__notificationPermission='granted';window.__notifications=[];
        window.WebSocket = class extends NativeWebSocket {
          constructor(...args) {
            super(...args);
            window.__testSockets.push(this);
          }
        };
        window.__TAURI_INTERNALS__ = {
          invoke: async (command,args) => {
            if(command==='notification_permission'){if(window.__notificationQueryFail)throw Error('权限查询测试失败');return {status:window.__notificationPermission,source:'native-bridge-test'};}
            if(command==='request_notification_permission'){window.__notificationPermission=window.__notificationRequestDenied?'denied':'granted';return {status:window.__notificationPermission,source:'native-bridge-test'};}
            if(command==='plugin:notification|notify'){window.__notifications.push(args.options);return;}
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
    const syncEvidence={reset:false,delta:false,offline:false};
    page.on('response',response=>{
      if(!new URL(response.url()).pathname.endsWith('/v1/sync')||!response.ok())return;
      void response.json().then(frame=>{
        if(frame.reset)syncEvidence.reset=true;
        else {
          syncEvidence.delta=true;
          if(frame.events?.some(event=>event.session?.runs?.some(run=>run.text?.includes('/history-test second offline run'))))syncEvidence.offline=true;
        }
      }).catch(()=>{});
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let lifecycleReceipts=0,legacyLifecycleCalls=0;
    page.on('response',response=>{if(new URL(response.url()).pathname==='/v1/plugin-lifecycle/operations'&&response.status()===202)lifecycleReceipts++;});
    page.on('request',request=>{if(/^\/v1\/plugins\/(inspect|prepare|commit|discard)$/.test(new URL(request.url()).pathname)||/^\/v1\/plugins\/[^/]+\/disable$/.test(new URL(request.url()).pathname))legacyLifecycleCalls++;});
    await page.goto(frontend);
    await page.getByText("工作主机 · 本机已连接", { exact: true }).waitFor();
    // Optional workspace must work through the actual form, without a native picker.
    const creationKeys=[];
    const lostCreation=async route=>{
      creationKeys.push(route.request().postDataJSON().key);
      const response=await route.fetch();
      if(creationKeys.length===1)await route.abort('failed');else await route.fulfill({response});
    };
    await page.route('**/v1/sessions',lostCreation);
    await page.getByRole('button',{name:'创建会话',exact:true}).click();
    await page.getByRole('button',{name:'关闭提示',exact:true}).waitFor();
    const uncertain=await (await fetch(`${connection.url}/v1/snapshot`,{headers:{Authorization:`Bearer ${connection.token}`}})).json();
    assert.equal(uncertain.sessions.length,1,'the lost response has already committed one session');
    await page.getByRole('button',{name:'创建会话',exact:true}).click();
    await page.getByRole('textbox',{name:'发送任务'}).waitFor();
    assert.equal(creationKeys.length,2);assert.equal(typeof creationKeys[0],'string');assert.equal(creationKeys[0],creationKeys[1]);
    await page.unroute('**/v1/sessions',lostCreation);
    const managed=await (await fetch(`${connection.url}/v1/snapshot`,{headers:{Authorization:`Bearer ${connection.token}`}})).json();
    assert.equal(managed.sessions.length,1,'retry after a lost creation response must not duplicate the session');
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
    await composer.fill('看看@preview');
    await page.getByRole('option',{name:/preview.txt/}).waitFor();
    await composer.press('Tab');
    assert.equal(await composer.inputValue(),'看看');
    await page.getByRole('button',{name:'移除引用 preview.txt'}).click();
    await composer.fill('请用/terminal');
    await page.getByRole('option',{name:/terminal/}).waitFor();
    await composer.press('Escape');
    await composer.fill('@composer-review');
    await page.getByRole('option',{name:/composer-review/}).waitFor();
    await page.screenshot({path:join(tmpdir(),'vibeone-composer-at-skills.png')});
    await composer.press('Tab');
    assert.equal(await composer.inputValue(),'使用技能「composer-review」处理以下任务：');
    await page.getByRole('button',{name:'移除引用 .agents/skills/composer-review/SKILL.md'}).click();
    assert.equal(await page.locator('.desktop-message.user').count(),0,'choosing a reference never submits a task');
    await composer.fill('/composer-review');
    await page.getByRole('option',{name:/composer-review/}).waitFor();
    await page.screenshot({path:join(tmpdir(),'vibeone-composer-skills.png')});
    await composer.press('Enter');
    assert.equal(await composer.inputValue(),'使用技能「composer-review」处理以下任务：');
    await page.getByRole('button',{name:'移除引用 .agents/skills/composer-review/SKILL.md'}).click();
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
    // Hold animation frames to reproduce typing before a delayed caret restoration.
    await page.evaluate(()=>{window.__savedComposerRaf=window.requestAnimationFrame;window.__composerFrames=[];window.requestAnimationFrame=callback=>{window.__composerFrames.push(callback);return 0;};});
    await page.getByRole('button',{name:'引用文件',exact:true}).click();
    await writeFile(join(directory,'new-reference.txt'),'new file after opening picker');
    await composer.fill('@new-reference');
    await page.evaluate(()=>{window.requestAnimationFrame=window.__savedComposerRaf;for(const callback of window.__composerFrames)callback(performance.now());delete window.__savedComposerRaf;delete window.__composerFrames;});
    assert.equal(await composer.inputValue(),'@new-reference');
    assert.equal(await composer.evaluate(node=>node.selectionStart),'@new-reference'.length,'delayed focus must not move the caret into newer input');
    await page.getByRole('button',{name:'刷新引用目录',exact:true}).click();
    await page.getByRole('option',{name:/new-reference.txt/}).waitFor();
    await composer.fill('@folder');
    await page.getByRole('option',{name:/folder name/}).click();
    await page.getByRole('option',{name:/child.txt/}).waitFor();
    await page.getByRole('button',{name:/引用folder name\/文件夹/}).click();
    await page.getByRole('button',{name:'移除引用 folder name/'}).waitFor();
    await composer.fill('@folder');
    await page.getByRole('option',{name:/folder name/}).click();
    await page.getByRole('option',{name:/child.txt/}).waitFor();
    await page.getByRole('button',{name:/上级目录/}).click();
    await page.getByRole('option',{name:/folder name/}).waitFor();
    // Reopen a dismissed trigger at the caret, and replace the whole token.
    await composer.fill('@preview.txt 后文');
    await composer.evaluate(node=>node.setSelectionRange(4,4));
    await composer.click({position:{x:8,y:8}});
    await composer.evaluate(node=>node.setSelectionRange(4,4));
    await composer.press('Escape');
    assert.equal(await page.getByRole('listbox',{name:'文件建议'}).count(),0);
    await page.getByRole('button',{name:'选择指令',exact:true}).focus();
    await composer.focus();
    await page.getByRole('option',{name:/preview.txt/}).waitFor();
    await composer.press('Tab');
    assert.equal(await composer.inputValue(),' 后文');
    await page.getByRole('button',{name:'移除引用 preview.txt'}).click();
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
    let failDirectory=true;
    const directoryRoute=async route=>{
      const url=new URL(route.request().url());
      if(failDirectory&&url.searchParams.get('path')==='folder name'){
        failDirectory=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'目录暂时不可读，请重试',code:'HOST_UNAVAILABLE',status:503})});
      }else await route.continue();
    };
    await page.route('**/tree?**',directoryRoute);
    await explorer.getByRole('button',{name:'folder name',exact:true}).click();
    await explorer.getByRole('button',{name:'重试读取 folder name',exact:true}).waitFor();
    assert.equal(await explorer.getByText('正在读取目录…',{exact:true}).count(),0);
    await explorer.getByRole('button',{name:'重试读取 folder name',exact:true}).click();
    await page.unroute('**/tree?**',directoryRoute);

    await explorer.getByRole('button',{name:'child.txt',exact:true}).click();
    await explorer.locator('.explorer-code code').getByText('nested text',{exact:true}).waitFor();
    assert.equal(await explorer.locator('.explorer-line-number').first().innerText(),'1');
    await explorer.getByRole('textbox',{name:'筛选文件'}).fill('child');
    assert.equal(await explorer.getByRole('button',{name:'preview.txt',exact:true}).count(),0);
    await explorer.getByRole('textbox',{name:'筛选文件'}).fill('');
    const directoryAddress=explorer.getByRole('textbox',{name:'浏览目录',exact:true});
    await directoryAddress.fill('folder name');
    assert.equal(await explorer.getByRole('button',{name:'preview.txt',exact:true}).count(),1,'editing an address must not replace the current directory');
    await explorer.getByRole('button',{name:'打开目录',exact:true}).click();
    await explorer.getByRole('navigation',{name:'当前目录'}).getByRole('button',{name:'folder name',exact:true}).waitFor();
    assert.equal(await explorer.getByRole('button',{name:'preview.txt',exact:true}).count(),0);
    await explorer.getByRole('button',{name:'child.txt',exact:true}).waitFor();
    await directoryAddress.fill('missing-directory');
    await explorer.getByRole('button',{name:'打开目录',exact:true}).click();
    await explorer.getByRole('alert').waitFor();
    assert.equal(await directoryAddress.inputValue(),'missing-directory','failed navigation retains the editable address');
    await explorer.getByRole('button',{name:'child.txt',exact:true}).waitFor();
    await page.screenshot({path:join(tmpdir(),'vibeone-file-navigation-error.png')});
    await explorer.getByRole('navigation',{name:'当前目录'}).getByRole('button',{name:'工作区',exact:true}).click();
    await explorer.getByRole('button',{name:'preview.txt',exact:true}).waitFor();
    assert.equal(await directoryAddress.inputValue(),'.');
    await explorer.getByRole('button',{name:'preview.txt',exact:true}).click();
    await explorer.locator('.explorer-code code').getByText('workspace preview text',{exact:true}).waitFor();
    const artifactBodies=[];let artifactEndpoint;
    const lostArtifact=async route=>{if(route.request().method()!=='POST'){await route.continue();return;}artifactBodies.push(route.request().postDataJSON());artifactEndpoint=new URL(route.request().url()).pathname;const response=await route.fetch();if(artifactBodies.length===1){await writeFile(join(directory,'preview.txt'),'changed after capture');await route.abort('failed');}else await route.fulfill({response});};
    await page.route('**/v1/sessions/*/artifacts',lostArtifact);
    await explorer.getByRole('button',{name:'保存为文本产物',exact:true}).click();
    await explorer.getByRole('button',{name:'重试保存产物',exact:true}).waitFor();
    await explorer.getByRole('button',{name:'tracked.txt',exact:true}).click();
    await explorer.locator('.explorer-capture-failure').getByText(/保存 preview.txt 未确认/).waitFor();
    await explorer.getByRole('button',{name:'保存为文本产物',exact:true}).waitFor();
    assert.equal(await explorer.getByRole('button',{name:'保存为文本产物',exact:true}).isDisabled(),true,'a new file cannot replace an unconfirmed capture identity');
    await page.screenshot({path:join(tmpdir(),'vibeone-artifact-retry-light.png')});
    await page.emulateMedia({colorScheme:'dark'});await page.waitForTimeout(150);await page.screenshot({path:join(tmpdir(),'vibeone-artifact-retry-dark.png')});await page.emulateMedia({colorScheme:'light'});
    await page.getByRole('button',{name:'产物',exact:true}).click();
    const artifactPanel=page.getByRole('complementary',{name:'工作区预览'});await artifactPanel.locator('summary').filter({hasText:'preview.txt'}).click();await artifactPanel.getByText('workspace preview text',{exact:true}).waitFor();
    await page.getByRole('button',{name:'文件',exact:true}).click();await explorer.getByRole('button',{name:'重试保存产物',exact:true}).waitFor();
    await explorer.getByRole('button',{name:'重试保存产物',exact:true}).click();
    await explorer.getByText('已保存文本产物：preview.txt',{exact:true}).waitFor();
    assert.equal(artifactBodies.length,2);assert.equal(typeof artifactBodies[0].key,'string');assert.deepEqual(artifactBodies[0],artifactBodies[1]);assert.equal(artifactBodies[1].path,'preview.txt');
    await page.unroute('**/v1/sessions/*/artifacts',lostArtifact);
    const actualArtifacts=await (await fetch(connection.url+artifactEndpoint,{headers:{Authorization:`Bearer ${connection.token}`}})).json();
    assert.equal(actualArtifacts.length,1);assert.equal(actualArtifacts[0].content.text,'workspace preview text\n');
    await writeFile(join(directory,'preview.txt'),'workspace preview text\n');
    await explorer.getByRole('button',{name:'preview.txt',exact:true}).waitFor();
    await explorer.getByRole('button',{name:'收起文件列表'}).click();
    assert.equal(await explorer.getByRole('complementary',{name:'文件列表'}).count(),0);
    await explorer.locator(':scope > header').getByRole('button',{name:'显示文件列表',exact:true}).click();
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
    await composer.fill('@composer-review');
    await page.getByRole('option',{name:/composer-review/}).click();
    await composer.fill('桌面集成测试 /thought');
    await composer.press('Enter');
    await page.getByText("本轮执行结束", { exact: true }).waitFor({timeout:8000}).catch(async error=>{throw new Error(`${error.message}\nReact errors: ${JSON.stringify(errors)}\n${(await page.locator("body").innerText()).slice(-6000)}`);});
    assert.equal(await page.getByRole('button',{name:'移除引用 preview.txt'}).count(),0);
    assert.equal(await page.getByRole('button',{name:'移除附件 pixel.png'}).count(),0);
    assert.equal(await page.getByRole('listbox',{name:'指令建议'}).count(),0,'successful send closes stale command suggestions');
    // Image thumbnails load when their card enters the viewport; longer context
    // can move the user's attachment above the followed answer.
    await page.locator('.desktop-message.user .desktop-attachment-card').scrollIntoViewIfNeeded();
    await page.locator('.desktop-message.user').getByRole('img',{name:'pixel.png',exact:true}).waitFor();
    const fileDownload=page.waitForEvent('download');
    await page.locator('.desktop-message.user').getByRole('button',{name:'下载附件',exact:true}).click();
    const downloaded=await fileDownload;
    assert.equal(downloaded.suggestedFilename(),'pixel.png');
    assert.deepEqual(await readFile(await downloaded.path()),imageBytes);
    assert.match(await page.locator('.desktop-message.user').first().innerText(),/workspace preview text/);
    assert.match(await page.locator('.desktop-message.user').first().innerText(),/工作区文件夹 folder name\//);
    assert.match(await page.locator('.desktop-message.user').first().innerText(),/child.txt/);
    assert.equal(await page.getByRole('button',{name:'移除引用 folder name/'}).count(),0);
    assert.match(await page.locator('.desktop-message.user').first().innerText(),/Use the project skill fixture for review/);
    assert.equal(await page.getByRole('button',{name:'移除引用 .agents/skills/composer-review/SKILL.md'}).count(),0);
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
    const queueKeys=[];
    const lostQueue=async route=>{queueKeys.push(route.request().postDataJSON().key);const response=await route.fetch();if(queueKeys.length%2===1)await route.abort('failed');else await route.fulfill({response});};
    await page.route('**/v1/sessions/*/queue',lostQueue);
    await queue.getByRole('button',{name:'暂停队列',exact:true}).click();
    await queue.getByRole('button',{name:'重试队列操作',exact:true}).click();
    await queue.getByText('排队消息已暂停；正在执行的任务继续，恢复后再开始下一轮。',{exact:true}).waitFor();
    await queue.getByRole('button',{name:'继续队列',exact:true}).click();
    await queue.getByRole('button',{name:'重试队列操作',exact:true}).click();
    await queue.getByRole('button',{name:'暂停队列',exact:true}).click();
    await queue.getByRole('button',{name:'重试队列操作',exact:true}).click();
    await queue.getByRole('button',{name:'撤回',exact:true}).click();
    await queue.getByRole('button',{name:'重试队列操作',exact:true}).waitFor();
    await queue.getByText('连接失败，队列操作结果尚未确认。',{exact:true}).waitFor();
    await page.screenshot({path:join(tmpdir(),'vibeone-queue-retry-desktop.png')});
    await queue.getByRole('button',{name:'重试队列操作',exact:true}).click();
    await queue.waitFor({state:'hidden'});
    assert.equal(queueKeys.length,8);for(let index=0;index<8;index+=2){assert.equal(typeof queueKeys[index],'string');assert.equal(queueKeys[index],queueKeys[index+1]);if(index)assert.notEqual(queueKeys[index],queueKeys[index-2]);}
    await page.unroute('**/v1/sessions/*/queue',lostQueue);
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
      .getByRole("textbox", { name: /项目名称/ })
      .fill("desktop-input");
    await page.getByRole("button", { name: "提交回答", exact: true }).click();
    await page
      .getByText("已收到项目名称：desktop-input", { exact: true })
      .waitFor();
    await composer.fill('/input-choices');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    const inputPanel=page.getByRole('region',{name:'需要补充信息',exact:true});
    await page.locator('.desktop-status').getByText('等待补充信息',{exact:true}).waitFor();
    await page.getByText('等待你处理下方请求后继续。',{exact:true}).waitFor();
    assert.equal(await inputPanel.getByRole('radio',{name:/蓝色/}).isChecked(),false);
    await inputPanel.getByRole('radio',{name:/蓝色/}).check();
    await inputPanel.getByRole('radio',{name:/蓝色/}).press('ArrowDown');
    assert.equal(await inputPanel.getByRole('radio',{name:/绿色/}).isChecked(),true);
    await inputPanel.getByRole('radio',{name:/绿色/}).press('ArrowUp');
    await inputPanel.getByRole('spinbutton',{name:/数量/}).fill('3');
    await inputPanel.getByRole('checkbox',{name:/启用提醒/}).check();
    await inputPanel.getByRole('checkbox',{name:'code',exact:true}).check();
    await inputPanel.getByRole('button',{name:'使用JSON输入',exact:true}).click();
    assert.deepEqual(JSON.parse(await inputPanel.getByRole('textbox',{name:'补充输入 JSON'}).inputValue()),{color:'blue',count:3,notify:true,tags:['code']});
    await inputPanel.getByRole('button',{name:'返回表单',exact:true}).click();
    await page.route('**/v1/sessions/*/inputs/*',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'测试：稍后再提交'})}));
    await inputPanel.getByRole('button',{name:'提交回答',exact:true}).click();
    await inputPanel.getByRole('alert').getByText('测试：稍后再提交',{exact:true}).waitFor();
    assert.equal(await inputPanel.getByRole('radio',{name:/蓝色/}).isChecked(),true);
    await page.unroute('**/v1/sessions/*/inputs/*');
    await inputPanel.getByRole('radio',{name:/蓝色/}).scrollIntoViewIfNeeded();
    await page.screenshot({path:join(tmpdir(),'vibeone-structured-input-light.png')});
    await page.getByRole('combobox',{name:'主题',exact:true}).selectOption('dark');
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    await page.screenshot({path:join(tmpdir(),'vibeone-structured-input-dark.png')});
    await page.getByRole('combobox',{name:'主题',exact:true}).selectOption('light');
    await inputPanel.getByRole('button',{name:'提交回答',exact:true}).click();
    await page.getByText('已收到结构化回答：{"color":"blue","count":3,"notify":true,"tags":["code"]}',{exact:true}).waitFor();
    await composer.fill('/input-json');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await inputPanel.getByRole('textbox',{name:'补充输入 JSON'}).fill('{invalid');
    await inputPanel.getByRole('button',{name:'提交回答',exact:true}).click();
    await inputPanel.getByRole('alert').getByText('JSON格式有误，请检查后再提交',{exact:true}).waitFor();
    await inputPanel.getByRole('textbox',{name:'补充输入 JSON'}).fill('{"config":{"enabled":true}}');
    await inputPanel.getByRole('button',{name:'提交回答',exact:true}).click();
    await page.getByText('已收到结构化回答：{"config":{"enabled":true}}',{exact:true}).waitFor();

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
    const stopRequest=page.waitForRequest(request=>new URL(request.url()).pathname.endsWith('/cancel'));
    await page.getByRole("button", { name: "停止执行", exact: true }).click();
    const stopBody=(await stopRequest).postDataJSON();assert.equal(typeof stopBody.key,'string');assert.equal(typeof stopBody.runId,'string');
    await page.getByText("本轮已停止", { exact: true }).waitFor();
    assert.equal(await page.locator(".desktop-live-status").count(), 0);
    const metadataBodies=[];const seenMetadata=new Set();
    const lostMetadata=async route=>{if(route.request().method()!=='POST'){await route.continue();return;}const body=route.request().postDataJSON();metadataBodies.push(body);const response=await route.fetch();if(!seenMetadata.has(body.key)){seenMetadata.add(body.key);await route.abort('failed');}else await route.fulfill({response});};
    await page.route('**/v1/sessions/*/metadata',lostMetadata);
    await page.getByRole("button", { name: "重命名", exact: true }).click();
    await page
      .getByRole("textbox", { name: "会话标题" })
      .fill("已保存的桌面会话");
    await page.getByRole("button", { name: "保存标题", exact: true }).click();
    await page.getByRole('button',{name:'重试会话修改',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'保存标题',exact:true}).isDisabled(),true);
    await page.screenshot({path:join(tmpdir(),'vibeone-metadata-retry-light.png')});
    await page.getByRole('button',{name:'重试会话修改',exact:true}).click();
    await page
      .getByRole("heading", { name: "已保存的桌面会话", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "归档", exact: true }).click();
    await page.getByRole('button',{name:'重试会话修改',exact:true}).click();
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
    await page.getByRole('button',{name:'重试会话修改',exact:true}).click();
    await page.getByRole('button',{name:'重命名',exact:true}).waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.querySelector('.desktop-metadata-failure'));
    assert.equal(metadataBodies.length,6);for(let i=0;i<6;i+=2){assert.equal(typeof metadataBodies[i].key,'string');assert.deepEqual(metadataBodies[i],metadataBodies[i+1]);}
    await page.unroute('**/v1/sessions/*/metadata',lostMetadata);
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
    // The live Host evicts its bounded projection; the UI must still recover the first input.
    const historyHeaders={Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'};
    const historySession=await (await fetch(`${connection.url}/v1/sessions`,{method:'POST',headers:historyHeaders,body:JSON.stringify({provider:'demo',workspace:directory})})).json();
    await fetch(`${connection.url}/v1/sessions/${historySession.id}/metadata`,{method:'POST',headers:historyHeaders,body:JSON.stringify({title:'长历史回归'})});
    await fetch(`${connection.url}/v1/sessions/${historySession.id}/messages`,{method:'POST',headers:historyHeaders,body:JSON.stringify({text:'/history-test'})});
    await page.waitForFunction(async({connection,id})=>{const snapshot=await (await fetch(`${connection.url}/v1/snapshot`,{headers:{Authorization:`Bearer ${connection.token}`}})).json();return snapshot.sessions.find(session=>session.id===id)?.runs.some(run=>run.status==='completed');},{connection,id:historySession.id});
    const historyRow=page.locator('.desktop-session').filter({hasText:'长历史回归'});
    await historyRow.getByText('就绪',{exact:true}).waitFor();
    await historyRow.click();
    await page.getByText('长历史演示完成。',{exact:true}).waitFor({timeout:15000});
    await page.getByRole('button',{name:'加载更早记录',exact:true}).waitFor();
    await page.getByRole('button',{name:/查看过程/}).click();
    await page.locator('.desktop-timeline').evaluate(node=>{node.scrollTop=0;});
    const visibleNote=page.locator('.desktop-process-note').first();
    const noteText=await visibleNote.innerText();
    const answer=page.locator('.desktop-process-note').filter({hasText:noteText}).first();
    const answerOffset=await answer.evaluate(node=>node.getBoundingClientRect().top);
    await page.getByRole('button',{name:'加载更早记录',exact:true}).click();
    await page.locator('.desktop-message.user .desktop-message-text').getByText('/history-test',{exact:true}).waitFor();
    assert.ok(Math.abs((await answer.evaluate(node=>node.getBoundingClientRect().top))-answerOffset)<3,'prepending history must preserve the visible record offset');
    await page.getByRole('button',{name:'加载更早记录',exact:true}).waitFor({state:'detached'});
    await page.getByText('原始前文 + 后续增量',{exact:true}).waitFor();
    await page.locator('.desktop-timeline').evaluate(node=>{node.scrollTop=0;});
    await page.screenshot({path:join(tmpdir(),'vibeone-history-loaded.png')});
    await context.setOffline(true);
    await page.evaluate(()=>window.__testSockets.at(-1)?.close());
    await fetch(`${connection.url}/v1/sessions/${historySession.id}/messages`,{method:'POST',headers:historyHeaders,body:JSON.stringify({text:'/history-test second offline run'})});
    for(let attempt=0;attempt<200;attempt++){
      const snapshot=await (await fetch(`${connection.url}/v1/snapshot`,{headers:historyHeaders})).json();
      if(snapshot.sessions.find(session=>session.id===historySession.id)?.runs.some(run=>run.text==='/history-test second offline run'&&run.status==='completed'))break;
      await sleep(30);
    }
    await context.setOffline(false);
    await page.getByText('工作主机 · 本机已连接',{exact:true}).waitFor();
    await page.locator('.desktop-message.user .desktop-message-text').getByText('/history-test second offline run',{exact:true}).waitFor();
    await page.locator('.desktop-message.user .desktop-message-text').getByText('/history-test',{exact:true}).waitFor();
    assert.equal(await page.getByRole('navigation',{name:'对话导航'}).getByRole('button').count(),2,'reconnect fills the offline gap and retains already loaded turns');
    await composer.fill('history continues');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await page.locator('.desktop-message.assistant').getByText(/已通过 ACP v2 收到：history continues/).waitFor();
    await composer.fill('/history-test /no-user-echo');
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    const unconfirmed=page.locator('.desktop-message.user').filter({hasText:'/history-test /no-user-echo'});
    await unconfirmed.waitFor();
    await unconfirmed.getByText('已受理 · 等待 Agent 接受',{exact:true}).waitFor({state:'detached'});
    await page.reload();
    await page.getByText('工作主机 · 本机已连接',{exact:true}).waitFor();
    await page.getByRole("button", { name: "连接与设置", exact: true }).click();
    const settingsNav=page.getByRole('navigation',{name:'设置分类'});
    await settingsNav.getByRole('button',{name:'常规',exact:true}).waitFor();
    assert.equal(await settingsNav.getByRole('button').count(),8);
    await page.getByRole('textbox',{name:'搜索设置'}).fill('配对');
    assert.equal(await settingsNav.getByRole('button').count(),1);
    await page.getByRole('textbox',{name:'搜索设置'}).fill('');
    await settingsNav.getByRole('button',{name:'工作区',exact:true}).click();
    await page.getByRole('textbox',{name:'工作区目录',exact:true}).fill('relative/path');
    await page.getByRole('button',{name:'导入工作区',exact:true}).click();
    await page.getByRole('alert').getByText('请输入工作区的绝对路径。',{exact:true}).waitFor();
    await page.getByRole('textbox',{name:'工作区目录',exact:true}).fill(join(directory,'folder name'));
    await page.getByRole('button',{name:'导入工作区',exact:true}).click();
    await page.getByText('已导入工作区：folder name',{exact:true}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'工作区目录',exact:true}).inputValue(),'');
    await page.getByRole('textbox',{name:'工作区目录',exact:true}).fill(join(directory,'folder name'));
    const duplicateImport=page.waitForResponse(response=>response.url().endsWith('/v1/workspaces')&&response.request().method()==='POST');
    await page.getByRole('button',{name:'导入工作区',exact:true}).click();
    assert.equal((await duplicateImport).ok(),true);
    const importedSnapshot=await (await fetch(`${connection.url}/v1/snapshot`,{headers:historyHeaders})).json();
    assert.equal(importedSnapshot.workspaces.filter(workspace=>workspace.path.endsWith('/folder name')).length,1);
    await page.getByRole('button',{name:'选择目录',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'工作区目录',exact:true}).inputValue(),directory);
    await settingsNav.getByRole('button',{name:'Agent',exact:true}).click();
    await settingsNav.getByRole('button',{name:'外观',exact:true}).click();
    await page.getByRole('button',{name:'亮色',exact:true}).click();
    await settingsNav.getByRole('button',{name:'Agent',exact:true}).click();
    const profileIssues=page.getByRole('region',{name:'需要检查的配置',exact:true});
    await profileIssues.getByText('corrupt-fixture',{exact:true}).waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    await page.screenshot({path:join(tmpdir(),'vibeone-profile-issues-light.png')});
    await settingsNav.getByRole('button',{name:'外观',exact:true}).click();
    await page.getByRole('button',{name:'暗色',exact:true}).click();
    await settingsNav.getByRole('button',{name:'Agent',exact:true}).click();
    await profileIssues.getByText('corrupt-fixture',{exact:true}).waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    await page.screenshot({path:join(tmpdir(),'vibeone-profile-issues-dark.png')});
    const issueKeys=[];
    const lostIssue=async route=>{issueKeys.push(route.request().postDataJSON().key);const response=await route.fetch();if(issueKeys.length===1)await route.abort('failed');else await route.fulfill({response});};
    await page.route('**/v1/profiles',lostIssue);
    await page.getByRole('button',{name:'移除异常配置 corrupt-fixture',exact:true}).click();
    await profileIssues.getByRole('button',{name:'重试移除异常配置',exact:true}).waitFor();
    await page.screenshot({path:join(tmpdir(),'vibeone-profile-remove-retry.png')});
    await profileIssues.getByRole('button',{name:'重试移除异常配置',exact:true}).click();
    await profileIssues.getByText('异常配置已移除，已有会话保持不变。',{exact:true}).waitFor();
    assert.equal(issueKeys.length,2);assert.equal(typeof issueKeys[0],'string');assert.equal(issueKeys[0],issueKeys[1]);
    await page.unroute('**/v1/profiles',lostIssue);
    assert.equal(await page.getByRole('button',{name:'移除异常配置 corrupt-fixture',exact:true}).count(),0);
    await page.getByRole('button',{name:'新建 Agent 配置',exact:true}).click();
    await page.getByRole('button',{name:'检查环境',exact:true}).click();
    await page.getByText('ACP v2 握手通过',{exact:true}).waitFor();
    await page.getByText('演示入口无需登录',{exact:true}).waitFor();
    await page.screenshot({path:join(tmpdir(),'vibeone-provider-probe.png')});
    await settingsNav.getByRole('button',{name:'外观',exact:true}).click();
    await page.getByRole('button',{name:'亮色',exact:true}).click();
    await settingsNav.getByRole('button',{name:'Agent',exact:true}).click();
    await page.getByRole('button',{name:'新建 Agent 配置',exact:true}).click();
    await page.getByRole('button',{name:'检查环境',exact:true}).click();
    await page.getByText('ACP v2 握手通过',{exact:true}).waitFor();
    await page.screenshot({path:join(tmpdir(),'vibeone-provider-probe-light.png')});
    await settingsNav.getByRole('button',{name:'外观',exact:true}).click();
    await page.getByRole('button',{name:'暗色',exact:true}).click();
    await settingsNav.getByRole('button',{name:'Agent',exact:true}).click();
    await page.getByRole('button',{name:'新建 Agent 配置',exact:true}).click();
    await page.getByRole('textbox',{name:'配置名称',exact:true}).fill('桌面审阅配置');
    await page.getByRole('textbox',{name:'启动参数 JSON',exact:true}).fill('{bad');
    assert.equal(await page.getByRole('button',{name:'检查环境',exact:true}).isDisabled(),true);
    assert.equal(await page.getByText('ACP v2 握手通过',{exact:true}).count(),0,'editing launch arguments clears earlier probe results');
    await page.getByRole('button',{name:'保存配置',exact:true}).click();
    await page.getByText('启动参数不是有效 JSON。',{exact:true}).waitFor();
    await page.getByRole('textbox',{name:'自定义 ACP 启动程序',exact:true}).fill('/tmp/test-only-adapter');
    await page.getByRole('button',{name:'恢复默认入口',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'自定义 ACP 启动程序',exact:true}).inputValue(),'');
    assert.equal(await page.getByRole('textbox',{name:'启动参数 JSON',exact:true}).inputValue(),'');
    await page.getByRole('textbox',{name:'启动参数 JSON',exact:true}).fill('');
    const profileKeys=[];
    const lostProfile=async route=>{profileKeys.push(route.request().postDataJSON().key);const response=await route.fetch();if(profileKeys.length===1)await route.abort('failed');else await route.fulfill({response});};
    await page.route('**/v1/profiles',lostProfile);
    await page.getByRole('button',{name:'保存配置',exact:true}).click();
    await page.locator('.desktop-settings-object-detail [role="alert"]').waitFor();
    const savedProfiles=async()=>{const response=await fetch(`${connection.url}/v1/profiles`,{headers:historyHeaders});return (await response.json()).profiles.filter(item=>item.name==='桌面审阅配置');};
    assert.equal((await savedProfiles()).length,1);
    await page.getByRole('button',{name:'保存配置',exact:true}).click();
    await page.locator('.desktop-settings-object-list').getByRole('button').filter({hasText:'桌面审阅配置'}).waitFor();
    await page.getByText('配置已保存。已有会话继续使用原修订，新建会话可使用新配置。',{exact:true}).waitFor();
    assert.equal(profileKeys.length,2);assert.equal(typeof profileKeys[0],'string');assert.equal(profileKeys[0],profileKeys[1]);assert.equal((await savedProfiles()).length,1);
    await page.unroute('**/v1/profiles',lostProfile);
    profileKeys.length=0;
    await page.route('**/v1/profiles',lostProfile);
    await page.getByRole('button',{name:'保存修订',exact:true}).click();
    await page.locator('.desktop-settings-object-detail [role="alert"]').waitFor();
    assert.equal((await savedProfiles())[0].revision,2);
    await page.getByRole('button',{name:'保存修订',exact:true}).click();
    await page.getByText('配置已保存。已有会话继续使用原修订，新建会话可使用新配置。',{exact:true}).waitFor();
    assert.equal(profileKeys.length,2);assert.equal(profileKeys[0],profileKeys[1]);assert.equal((await savedProfiles())[0].revision,2);
    await page.unroute('**/v1/profiles',lostProfile);
    await page.evaluate(()=>{window.__notificationPermission='default';});
    await settingsNav.getByRole('button',{name:'远程连接',exact:true}).click();
    const remoteIp=page.getByRole('textbox',{name:'远程入口 IP',exact:true});
    const remotePort=page.getByRole('spinbutton',{name:'远程入口端口',exact:true});
    await page.waitForFunction(()=>!document.querySelector('[aria-label="远程入口 IP"]')?.disabled);
    await remoteIp.fill('127.0.0.1');await remotePort.fill('0');
    await page.waitForResponse(response=>new URL(response.url()).pathname==='/v1/devices'&&response.ok());
    assert.equal(await remoteIp.inputValue(),'127.0.0.1','status polling preserves unsaved IP');
    assert.equal(await remotePort.inputValue(),'0');
    await page.getByRole('button',{name:'开启 HTTPS 手机入口',exact:true}).click();
    await page.getByRole('button',{name:'关闭手机入口',exact:true}).waitFor();
    assert.equal(await remotePort.inputValue(),'0','automatic port remains configuration intent');
    const remoteDeviceState=await (await fetch(`${connection.url}/v1/devices`,{headers:historyHeaders})).json();
    const pairCode=await post('/pairing/code',{});
    const trustedCa=await readFile(join(directory,'VibeOne-Root-CA.crt'));
    const deviceClaim=await new Promise((resolve,reject)=>{
      const request=https.request(remoteDeviceState.url+'/v1/pairing/claim',{ca:trustedCa,agent:false,method:'POST',headers:{Origin:remoteDeviceState.url,'Content-Type':'application/json'},signal:AbortSignal.timeout(4000)},response=>{
        let body='';response.on('data',chunk=>body+=chunk);response.on('error',reject);response.on('end',()=>{try{assert.equal(response.statusCode,200);resolve(JSON.parse(body));}catch(error){reject(error);}});
      });request.on('error',reject);request.end(JSON.stringify({code:pairCode.code,name:'desktop-device-fixture',secret:'fixture-pair-secret-'.repeat(3)}));
    });
    const deviceWorkspace=await post('/workspaces',{path:directory});
    await post(`/devices/${deviceClaim.id}/approve`,{role:'viewer',workspaces:[deviceWorkspace.id]});

    await settingsNav.getByRole('button',{name:'常规',exact:true}).click();
    await settingsNav.getByRole('button',{name:'远程连接',exact:true}).click();
    await page.getByRole('button',{name:'关闭手机入口',exact:true}).waitFor();
    assert.equal(await remoteIp.inputValue(),'127.0.0.1');
    assert.equal(await remotePort.inputValue(),'0');
    await page.getByRole('img',{name:'手机入口二维码',exact:true}).waitFor();
    await page.screenshot({path:join(tmpdir(),'vibeone-remote-preferences-dark.png')});
    const deviceCard=page.getByRole('article',{name:'设备 desktop-device-fixture',exact:true});
    await deviceCard.waitFor();
    assert.ok((await deviceCard.innerText()).includes('已授权'));
    assert.ok((await deviceCard.innerText()).includes('仅查看'));
    await deviceCard.getByText(`授权工作区：${deviceWorkspace.name}`,{exact:true}).waitFor();
    await deviceCard.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(tmpdir(),'vibeone-device-scope-dark.png')});
    await deviceCard.getByRole('button',{name:'撤销设备',exact:true}).click();
    await deviceCard.filter({hasText:'已撤销'}).waitFor();
    assert.equal(await deviceCard.getByRole('button',{name:'撤销设备',exact:true}).isDisabled(),true);

    await page.getByRole('button',{name:'关闭手机入口',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[aria-label="远程入口 IP"]')?.disabled);
    await settingsNav.getByRole('button',{name:'常规',exact:true}).click();
    await settingsNav.getByRole('button',{name:'远程连接',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[aria-label="远程入口 IP"]')?.disabled);
    assert.equal(await remoteIp.inputValue(),'127.0.0.1');
    assert.equal(await remotePort.inputValue(),'0');
    await remotePort.fill('54321');
    await page.waitForResponse(response=>new URL(response.url()).pathname==='/v1/devices'&&response.ok());
    assert.equal(await remotePort.inputValue(),'54321','status polling preserves unsaved port');
    await settingsNav.getByRole('button',{name:'通知',exact:true}).click();
    await page.getByText('尚未请求',{exact:true}).waitFor();
    await page.evaluate(()=>{window.__notificationQueryFail=true;});
    await page.getByRole('button',{name:'刷新通知权限',exact:true}).click();
    await page.getByRole('alert').getByText('权限查询测试失败',{exact:true}).waitFor();
    await page.evaluate(()=>{window.__notificationQueryFail=false;window.__notificationRequestDenied=true;});
    await page.getByRole('switch',{name:'桌面通知',exact:true}).click();
    await page.getByRole('alert').getByText('系统通知权限未开启，请在系统设置中允许 VibeOne 通知',{exact:true}).waitFor();
    assert.equal(await page.getByRole('switch',{name:'桌面通知',exact:true}).getAttribute('aria-checked'),'false');
    await page.evaluate(()=>{window.__notificationRequestDenied=false;});
    await page.getByRole('switch',{name:'桌面通知',exact:true}).click();
    await page.getByText('已授权',{exact:true}).waitFor();
    assert.equal(await page.getByRole('switch',{name:'桌面通知',exact:true}).getAttribute('aria-checked'),'true');
    await page.evaluate(()=>{window.__notificationPermission='denied';});
    await page.getByRole('button',{name:'刷新通知权限',exact:true}).click();
    await page.getByText('未授权，请检查系统设置',{exact:true}).waitFor();
    await page.getByText('提醒开关已开启，但当前没有可用的通知授权。',{exact:true}).waitFor();
    await page.screenshot({path:join(tmpdir(),'vibeone-notifications-desktop.png')});
    await page.getByRole('switch',{name:'桌面通知',exact:true}).click();
    assert.equal(await page.getByRole('switch',{name:'桌面通知',exact:true}).getAttribute('aria-checked'),'false');
    await page.evaluate(()=>{window.__notificationPermission='granted';window.__notifications=[];localStorage.setItem('vibeone-notifications','enabled');});
    await page.reload();
    await page.getByText('工作主机 · 本机已连接',{exact:true}).waitFor();
    await page.locator('.desktop-session').filter({hasText:'长历史回归'}).waitFor();
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>window.__notifications.length),0,'first snapshot must establish a baseline without replaying old finished Runs');
    await page.evaluate(()=>{window.__notificationPermission='granted';});
    const notificationSession=await (await fetch(`${connection.url}/v1/sessions`,{method:'POST',headers:historyHeaders,body:JSON.stringify({provider:'demo',workspace:directory})})).json();
    await fetch(`${connection.url}/v1/sessions/${notificationSession.id}/messages`,{method:'POST',headers:historyHeaders,body:JSON.stringify({text:'notification new Run'})});
    await page.waitForFunction(()=>window.__notifications.some(notification=>notification.title==='VibeOne · 执行结束'));
    await page.getByRole('button',{name:'连接与设置',exact:true}).click();
    await settingsNav.getByRole('button',{name:'通知',exact:true}).click();
    await page.getByRole('switch',{name:'桌面通知',exact:true}).click();
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
    await settingsNav.getByRole('button',{name:'常规',exact:true}).click();
    await settingsNav.getByRole('button',{name:'插件',exact:true}).click();
    const operations=page.locator('details[aria-label="最近后台操作"]');
    await operations.locator(':scope > summary').click();
    const scanOperation=operations.locator('.desktop-settings-row').filter({hasText:'workspace.scan'});
    await scanOperation.getByText('已完成',{exact:true}).waitFor();
    await scanOperation.getByRole('button',{name:/查看操作结果/}).click();
    assert.ok(lifecycleReceipts>=3,'inspect, prepare and commit must receive durable receipts');
    assert.equal(legacyLifecycleCalls,0,'the formal UI must use lifecycle operations on a capable Host');
    await page.locator('.desktop-diagnostic').filter({hasText:'"entries"'}).last().waitFor();
    await operations.screenshot({path:join(tmpdir(),'vibeone-plugin-operations-dark.png')});
    await settingsNav.getByRole('button',{name:'外观',exact:true}).click();
    await page.getByRole('button',{name:'亮色',exact:true}).click();
    await settingsNav.getByRole('button',{name:'插件',exact:true}).click();
    await operations.locator(':scope > summary').click();
    await operations.screenshot({path:join(tmpdir(),'vibeone-plugin-operations-light.png')});
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
    // Exercise the actual reading-rail component with more marks than fit on screen.
    await page.waitForFunction(()=>Boolean(window.__vibeoneReactDOMClient));
    await page.evaluate(async()=>{
      const React=window.__vibeoneReact,{createRoot}=window.__vibeoneReactDOMClient,{ConversationNav}=await import('/src/ConversationNav.jsx');
      const mount=document.createElement('div');mount.dataset.historyNavFixture='true';Object.assign(mount.style,{position:'fixed',inset:'40px',zIndex:1000,background:'var(--surface)'});document.body.append(mount);
      const root=createRoot(mount);window.__navFixture={root,mount};
      function Fixture(){const timeline=React.useRef(null);const turns=Array.from({length:200},(_,index)=>({id:`nav-${index}`,user:{text:`历史第 ${index+1} 轮`},answer:{text:`回答 ${index+1}`}}));return React.createElement('div',{className:'desktop-timeline-shell',style:{height:'100%',position:'relative'}},React.createElement('div',{ref:timeline,className:'desktop-timeline',style:{height:'100%',overflow:'auto',boxSizing:'border-box'}},turns.map(turn=>React.createElement('div',{key:turn.id,'data-turn-id':turn.id,style:{height:100}},turn.user.text))),React.createElement(ConversationNav,{turns,timeline,onNavigate:()=>{}}));}
      root.render(React.createElement(Fixture));
    });
    const rail=page.locator('[data-history-nav-fixture]').getByRole('navigation',{name:'对话导航'});
    await rail.getByRole('button').first().focus();
    await rail.getByRole('button').first().press('End');
    await rail.getByRole('button').last().click();
    await page.waitForFunction(()=>document.querySelector('[data-history-nav-fixture] .desktop-conversation-marks button:last-child')?.getAttribute('aria-current')==='location');
    assert.equal(await rail.getByRole('button').count(),200);
    assert.ok(await page.locator('[data-history-nav-fixture] .desktop-conversation-marks').evaluate(node=>node.scrollTop>0));
    await page.evaluate(()=>{window.__navFixture.root.unmount();window.__navFixture.mount.remove();delete window.__navFixture;});
    // Exercise the real form component's rapid submission and local-only states.
    await page.evaluate(async()=>{
      const React=window.__vibeoneReact,{createRoot}=window.__vibeoneReactDOMClient,{InputRequest}=await import('/src/InputRequest.jsx');
      const mount=document.createElement('div');mount.dataset.inputFixture='true';Object.assign(mount.style,{position:'fixed',inset:'12px',padding:'12px',overflow:'auto',zIndex:1000,background:'var(--surface)',color:'var(--ink)'});document.body.append(mount);
      const root=createRoot(mount),calls=[],releases=[];
      const workbench={call:async(path,body)=>{calls.push({path,body});return new Promise(resolve=>releases.push(resolve));}};
      window.__inputFixture={root,mount,calls,releases,render:(request,online=true,status='idle')=>root.render(React.createElement(InputRequest,{key:request.id,request,session:{id:'fixture',status},workbench,online,act:operation=>operation()}))};
      window.__inputFixture.render({id:'rapid',mode:'form',message:'测试长内容、可选字段与提交状态。'.repeat(12),requestedSchema:{type:'object',properties:{list:{type:'array',title:'批量选项',items:{type:'string',enum:Array.from({length:8},(_,index)=>`option${index}`)}},flag:{type:'boolean',title:'可选开关'},secret:{type:'string',title:'私密回答',_meta:{codex:{isSecret:true}}}}}});
    });
    const fixture=page.locator('[data-input-fixture]');
    await fixture.getByRole('listbox',{name:/批量选项/}).selectOption(['0','7']);
    await fixture.getByRole('combobox',{name:/可选开关/}).selectOption('false');
    assert.equal(await fixture.locator('input[type=password]').count(),1);
    assert.equal(await fixture.locator('input[type=password]').getAttribute('autocomplete'),'off');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await fixture.evaluate(node=>node.scrollWidth<=node.clientWidth),true);
    await fixture.getByRole('button',{name:'提交回答',exact:true}).evaluate(button=>{for(let index=0;index<10;index++)button.click();});
    await page.waitForFunction(()=>window.__inputFixture.calls.length===1);
    assert.deepEqual(await page.evaluate(()=>window.__inputFixture.calls[0].body.content),{flag:false,list:['option0','option7']});
    assert.equal(await fixture.getByRole('button',{name:'正在提交…',exact:true}).isDisabled(),true);
    await page.evaluate(()=>window.__inputFixture.releases[0]({accepted:true}));
    await fixture.getByText('已交给主机',{exact:true}).waitFor();
    assert.equal(await fixture.getByRole('button',{name:'提交回答',exact:true}).isDisabled(),true);
    await page.evaluate(()=>window.__inputFixture.render({id:'offline',mode:'form',message:'离线测试',requestedSchema:{type:'object',properties:{}}},false));
    await fixture.getByText('当前无法提交，请检查连接或设备操作权限。',{exact:true}).waitFor();
    assert.equal(await fixture.getByRole('button',{name:'取消',exact:true}).isDisabled(),true);
    await page.evaluate(()=>window.__inputFixture.render({id:'stopping',mode:'form',message:'停止中的请求',requestedSchema:{type:'object',properties:{}}},true,'cancelling'));
    await fixture.getByText('正在停止，无法提交回答。',{exact:true}).waitFor();
    assert.equal(await fixture.getByRole('button',{name:'提交回答',exact:true}).isDisabled(),true);
    await page.evaluate(()=>window.__inputFixture.render({id:'expired',mode:'form',message:'过期测试',expiresAt:Date.now()+100,requestedSchema:{type:'object',properties:{}}}));
    await fixture.getByText('已过期',{exact:true}).waitFor();
    assert.equal(await fixture.getByRole('button',{name:'提交回答',exact:true}).isDisabled(),true);
    await page.evaluate(()=>{window.__inputFixture.root.unmount();window.__inputFixture.mount.remove();delete window.__inputFixture;});
    await page.setViewportSize({width:1360,height:900});
    assert.deepEqual(syncEvidence,{reset:true,delta:true,offline:true},'the actual browser must use cursor deltas, including the disconnected Run');
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  },
);
