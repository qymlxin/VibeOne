// ACP v2 fixture. No model, file operations or shell execution; never presented as a real coding tool.
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const input = createInterface({ input: process.stdin });
const sessions = new Map();
const pending = new Map();
let sequence = 0;
const configOptions=value=>[{configId:'mode',name:'演示模式',type:'select',currentValue:value??'safe',options:[{value:'safe',name:'安全模式'},{value:'normal',name:'普通模式'}]}];
const send = value => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
const update = (sessionId, value) => send({ method: 'session/update', params: { sessionId, update: value } });
const state = (id, state, stopReason) => update(id, { sessionUpdate: 'state_update', state, ...(stopReason ? { stopReason } : {}) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run(sessionId, prompt, userId, epoch, blocks=[]) {
  const session = sessions.get(sessionId);
  const active = () => session?.epoch === epoch;
  let response = `已通过 ACP v2 收到：${prompt}\n\n这是本地演示 Agent，不调用模型或读写项目文件。你可以发送 /approve 体验审批，发送 /wait 后点击停止体验取消。`;
  for(const block of blocks){
    const encoded=block.type==='image'?block.data:block.type==='resource'?block.resource?.blob:null;
    if(encoded){const bytes=Buffer.from(encoded,'base64');response+=`\n附件回执 ${block.type} ${bytes.length} ${createHash('sha256').update(bytes).digest('hex')}`;}
  }
  if (prompt.includes('/preview')) response='预览演示：[工作区文件](preview.txt)\n\n[网页预览](https://example.com/docs)。';
  if (prompt.includes('/long')) response = '这是一段用于验证流式消息滚动位置的演示内容。\n'.repeat(90);
  try {
    if (prompt.includes('/pause-test')) {await sleep(700);if(!active())return;}
    if (prompt.includes('/thought')) {
      const messageId = `thought:${userId}`;
      const text = '演示进度摘要：正在准备回复。';
      update(sessionId, { sessionUpdate: 'agent_thought_chunk', messageId, content: { type: 'text', text } });
      await sleep(150);
      if (!active()) return;
      update(sessionId, { sessionUpdate: 'agent_thought', messageId, content: [{ type: 'text', text }] });
    }
    if(prompt.includes('/history-test')){
      const first=`history-first:${userId}`;
      update(sessionId,{sessionUpdate:'agent_message',messageId:first,content:[{type:'text',text:'原始前文'}]});
      for(let index=0;index<180;index++)update(sessionId,{sessionUpdate:'agent_message',messageId:`history:${userId}:${index}`,content:[{type:'text',text:`历史片段 ${index}`}]});
      for(let index=0;index<140;index++){
        update(sessionId,{sessionUpdate:'tool_call_update',toolCallId:`history-tool:${userId}:${index}`,kind:'read',title:`历史工具 ${index}`,status:'completed',locations:[{path:`/demo/file-${index}.txt`}]});
        if(index===0)update(sessionId,{sessionUpdate:'tool_call_content_chunk',toolCallId:`history-tool:${userId}:0`,content:{type:'content',content:{type:'text',text:'初始输出'}}});
      }
      update(sessionId,{sessionUpdate:'agent_message_chunk',messageId:first,content:{type:'text',text:' + 后续增量'}});
      update(sessionId,{sessionUpdate:'tool_call_content_chunk',toolCallId:`history-tool:${userId}:0`,content:{type:'content',content:{type:'text',text:' + 增量输出'}}});
      response='长历史演示完成。';
    }
    if (prompt.includes('/format')) response='这是一段说明。\n保留段内换行。\n\n1. **第一项**\n\n   第一项说明。\n\n2. **第二项**\n\n   第二项说明。\n\n```text\n  first\n    second\n```';
    if (prompt.includes('/read-tools')) {
      for (const [index,path] of ['/demo/src/main.rs','/demo/src/app.tsx'].entries()) {
        update(sessionId,{sessionUpdate:'tool_call_update',toolCallId:`read:${userId}:${index}`,kind:'read',title:`Read file '${path}'`,locations:[{path}],status:'completed'});
      }
      response='文件读取视图演示完成。没有实际读取文件。';
    }
    if (prompt.includes('/rich-tools')) {
      const calls=[
        {title:'演示：搜索资料',rawInput:{type:'webSearch',id:'transport-only',query:'summary...',action:{type:'search',queries:['测试查询一','测试查询二']}}},
        {title:'演示：打开网页',rawInput:{type:'webSearch',action:{type:'openPage',url:'https://example.com/docs'}}},
        {title:'演示：运行命令',rawInput:{command:"printf 'hello'",cwd:'/demo'},rawOutput:{exit_code:0},content:[{type:'content',content:{type:'text',text:'hello'}}]},
      ];
      calls.forEach((call,index)=>update(sessionId,{sessionUpdate:'tool_call_update',toolCallId:`rich:${userId}:${index}`,status:'completed',...call}));
      response='工具视图演示已完成。没有搜索网页或执行命令。';
    }
    if (prompt.includes('/activity')) {
      update(sessionId,{sessionUpdate:'agent_message',messageId:`commentary:${userId}`,content:[{type:'text',text:'演示：我先梳理任务，再检查处理步骤。'}]});
      const stages=['梳理任务范围','检查目录结构','核对变更影响','整理执行结果'];
      for (let index=0;index<stages.length;index++) {
        if (!active()) return;
        update(sessionId,{sessionUpdate:'agent_thought_chunk',messageId:`activity:${userId}`,content:{type:'text',text:`演示思考摘要：${stages[index]}。\n`}});
        const toolCallId=`activity-tool:${userId}:${index}`;
        update(sessionId,{sessionUpdate:'tool_call_update',toolCallId,title:`演示：${stages[index]}`,status:'in_progress',rawInput:{demo:true,step:index+1}});
        await sleep(700);if(!active())return;
        update(sessionId,{sessionUpdate:'tool_call_update',toolCallId,status:'completed',rawOutput:{demo:true,result:'模拟步骤完成，没有执行实际工具'}});
      }
      await sleep(6000);if(!active())return;
      response='演示处理已完成。以上思考摘要与工具事件用于验证实时活动视图，没有读取文件或执行命令。';
    }
    if (prompt.includes('/wait')) {
      if(process.argv.includes('--stubborn')) {
        const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
        update(sessionId,{sessionUpdate:'agent_message',messageId:`pid:${userId}`,content:[{type:'text',text:`stubborn-child-pid:${child.pid}`}]});
      }
      while (active()) await sleep(50);
      return;
    }
    if (prompt.includes('/input')) {
      state(sessionId,'requires_action');
      const id=`input:${++sequence}`;
      const answer=new Promise(resolve=>pending.set(id,{sessionId,resolve}));
      send({id,method:'elicitation/create',params:{mode:'form',sessionId,message:'请输入演示项目名称',requestedSchema:{type:'object',properties:{name:{type:'string',minLength:2,title:'项目名称'}},required:['name']}}});
      const result=await answer;if(!active())return;state(sessionId,'running');
      response=result?.action==='accept' ? `已收到项目名称：${result.content.name}` : '已取消补充输入。';
    }
    if (prompt.includes('/approve')) {
      state(sessionId, 'requires_action');
      const id = `permission:${++sequence}`;
      const decision = new Promise(resolve => pending.set(id, { sessionId, resolve }));
      send({ id, method: 'session/request_permission', params: {
        sessionId, title: '允许演示 Agent 继续返回结果？', description: '此演示不会运行命令或修改文件。',
        options: [{ optionId: 'allow', name: '允许一次', kind: 'allow_once' }, { optionId: 'reject', name: '拒绝一次', kind: 'reject_once' }],
      } });
      const result = await decision;
      if (!active()) return;
      state(sessionId, 'running');
      response = result?.outcome?.optionId === 'allow' ? '你已允许一次，演示审批链路完成。' : '你已拒绝，Agent 尊重了本次决定。';
    }
    const messageId = `agent:${userId}`;
    for (const text of response.match(/.{1,12}/gs) ?? []) {
      await sleep(30);
      if (!active()) return;
      update(sessionId, { sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text } });
    }
    update(sessionId, { sessionUpdate: 'agent_message', messageId, content: [{ type: 'text', text: response }] });
    state(sessionId, 'idle', 'end_turn');
  } catch (error) {
    process.stderr.write(`${error}\n`);
    state(sessionId, 'idle', 'error');
  }
}

for await (const line of input) {
  const message = JSON.parse(line);
  if (!message.method) {
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); request.resolve(message.result); }
    continue;
  }
  const { id, method, params = {} } = message;
  if (method === 'initialize') {
    if (process.argv.includes('--malformed')) { process.stdout.write('invalid json\n'); process.exit(1); }
    const initialized={protocolVersion:process.argv.includes('--v1')?1:2,info:{name:'vibeone-demo-agent',version:'0.1.0'},capabilities:{session:{...(process.argv.includes('--no-media')?{}:{prompt:{image:{},embeddedContext:{}}})}}};
    send({id,result:initialized});
  } else if (method === 'session/new') {
    const open=()=>{
      const sessionId=`demo:${++sequence}`;
      sessions.set(sessionId,{cwd:params.cwd,epoch:0});state(sessionId,'idle');
      send({id,result:{sessionId,configOptions:configOptions()}});
    };
    if(process.argv.includes('--input-before-session')){
      const inputId=`session-input:${++sequence}`;
      pending.set(inputId,{sessionId:null,resolve:answer=>{if(answer?.action==='accept')open();else send({id,error:{code:-32800,message:'Session input cancelled'}});}});
      send({id:inputId,method:'elicitation/create',params:{mode:'form',requestId:id,message:'创建会话前的演示输入',requestedSchema:{type:'object',properties:{name:{type:'string',minLength:2}},required:['name']}}});
    }else open();
  } else if (method === 'session/set_config_option') {
    if(params.configId!=='mode'||params.type!=='id'||!['safe','normal'].includes(params.value)){send({id,error:{code:-32602,message:'Invalid option'}});continue;}
    update(params.sessionId,{sessionUpdate:'config_option_update',configOptions:configOptions(params.value)});
    send({id,result:{configOptions:configOptions(params.value)}});
  } else if (method === 'session/list') {
    send({ id, result: { sessions: [...sessions].map(([sessionId, value]) => ({ sessionId, cwd: value.cwd })) } });
  } else if (method === 'session/resume') {
    if (sessions.has(params.sessionId)) { state(params.sessionId, 'idle'); send({ id, result: {} }); }
    else send({ id, error: { code: -32002, message: 'Session not found' } });
  } else if (method === 'session/prompt') {
    if (process.argv.includes('--crash')) process.exit(23);
    const session = sessions.get(params.sessionId);
    if (!session) { send({ id, error: { code: -32002, message: 'Session not found' } }); continue; }
    const userId = `user:${++sequence}`;
    const epoch = ++session.epoch;
    const prompt=params.prompt.map(block => block.text ?? '').join('');
    if(!prompt.includes('/no-user-echo'))update(params.sessionId, { sessionUpdate: 'user_message', messageId: userId, content: params.prompt });
    state(params.sessionId, 'running'); // Intentionally before acceptance.
    send({ id, result: { messageId: userId } });
    void run(params.sessionId, prompt, userId, epoch, params.prompt);
  } else if (method === 'session/cancel' || method === 'session/close') {
    if(process.argv.includes('--stubborn'))continue;
    const session = sessions.get(params.sessionId);
    if (session) session.epoch++;
    for (const [pendingId, request] of pending) {
      if (request.sessionId === params.sessionId) { pending.delete(pendingId); request.resolve(null); }
    }
    state(params.sessionId, 'idle', 'cancelled');
    if (method === 'session/close') { sessions.delete(params.sessionId); send({ id, result: {} }); }
  } else if (id !== undefined) send({ id, error: { code: -32601, message: 'Method not implemented by fixture' } });
}
process.exit(0);
