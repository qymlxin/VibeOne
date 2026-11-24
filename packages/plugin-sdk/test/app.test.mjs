import test from 'node:test';
import assert from 'node:assert/strict';
import {AppRuntime,defineApp} from '../dist/app.js';
const services={workbench:{snapshot:()=>null,subscribe:()=>()=>{}},invokeWorker:async()=>null};
test('failed App candidates dispose resources and preserve published generations',async()=>{
  const runtime=new AppRuntime();let disposed=0;
  const declarations=[{id:'panel',kind:'app.panel'}];
  const first=await runtime.prepare({pluginId:'demo',generation:1,version:'1'},defineApp(ctx=>{ctx.panels.register('panel',()=>null);ctx.scope.add(()=>{disposed++;});}),services,declarations);
  runtime.publish(first);
  await assert.rejects(runtime.prepare({pluginId:'demo',generation:2,version:'2'},defineApp(ctx=>{ctx.scope.add(()=>{disposed++;});ctx.panels.register('undeclared',()=>null);}),services,declarations));
  assert.equal(runtime.snapshot()[0],first);assert.equal(disposed,1);
  const next=await runtime.prepare({pluginId:'demo',generation:3,version:'3'},defineApp(ctx=>{ctx.panels.register('panel',()=>null);}),services,declarations);
  runtime.publish(next);await first.scope.dispose();
  assert.equal(disposed,2);assert.equal(runtime.snapshot()[0],next);
  await assert.rejects(async()=>runtime.publish(first));
  await runtime.unload('demo');assert.equal(runtime.snapshot().length,0);
});

test('asynchronous App hook errors are reported without rejecting the host event',async()=>{
  const failures=[];const runtime=new AppRuntime(error=>failures.push(String(error)));
  const app=await runtime.prepare({pluginId:'async',generation:1,version:'1'},defineApp(ctx=>{ctx.hooks.on('changed',async()=>{throw Error('async hook failed');});}),services,[]);
  runtime.publish(app);runtime.emit('changed',null);await Promise.resolve();await Promise.resolve();
  assert.equal(failures.length,1);assert.ok(failures[0].includes('async hook failed'));await runtime.unload('async');
});

test('generalized ui, composer services and panel theme/params props pass through',async()=>{
  const inserted=[];const opened=[];const noticed=[];
  const runtime=new AppRuntime();
  const extendedServices={
    ...services,
    ui:{
      notify:(message,tone)=>noticed.push({message,tone}),
      openPanel:(panelId,params)=>opened.push({panelId,params}),
      getTheme:()=>'dark',
    },
    composer:{
      insertText:(text)=>inserted.push(text),
    },
  };
  const app=await runtime.prepare(
    {pluginId:'generalized',generation:1,version:'1'},
    defineApp(ctx=>{
      ctx.services.ui?.notify?.('已连接','success');
      ctx.services.composer?.insertText('hello');
      ctx.services.ui?.openPanel?.('ext-panel',{path:'src/app.ts'});
      ctx.panels.register('ext-panel',props=>({
        theme:props.theme,
        panelId:props.panelId,
        params:props.params,
        computedTheme:ctx.services.ui?.getTheme?.(),
      }));
    }),
    extendedServices,
    [{id:'ext-panel',kind:'app.panel'}],
  );
  runtime.publish(app);
  const Panel=app.panels.get('ext-panel');
  assert.deepEqual(Panel({panelId:'ext-panel',theme:'dark',params:{path:'src/app.ts'}}),{
    theme:'dark',
    panelId:'ext-panel',
    params:{path:'src/app.ts'},
    computedTheme:'dark',
  });
  assert.deepEqual(noticed,[{message:'已连接',tone:'success'}]);
  assert.deepEqual(inserted,['hello']);
  assert.deepEqual(opened,[{panelId:'ext-panel',params:{path:'src/app.ts'}}]);
  await runtime.unload('generalized');
});
