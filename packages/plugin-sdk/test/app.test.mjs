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
