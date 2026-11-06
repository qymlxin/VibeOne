// Persistent upstream session fixture; data and trace paths are test-owned.
import {createInterface} from 'node:readline';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const [database,trace]=process.argv.slice(2);
const load=()=>{try{return JSON.parse(readFileSync(database,'utf8'));}catch{return {};}};
const save=value=>writeFileSync(database,JSON.stringify(value));
const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
const update=(id,update)=>send({method:'session/update',params:{sessionId:id,update}});
const state=(id,state,stopReason)=>update(id,{sessionUpdate:'state_update',state,...(stopReason?{stopReason}:{})});
const config=value=>[{configId:'mode',name:'模式',type:'select',currentValue:value??'safe',options:[{value:'safe',name:'只读'},{value:'normal',name:'普通'}]}];
for await(const line of createInterface({input:process.stdin})){
 const {id,method,params={}}=JSON.parse(line);
 appendFileSync(trace,JSON.stringify({method,sessionId:params.sessionId,replayFrom:params.replayFrom??null,text:params.prompt?.map(block=>block.text??'').join('')})+'\n');
 const db=load();
 if(method==='initialize'){send({id,result:{protocolVersion:2,info:{name:'persistent-resume-fixture',version:'1.0.0'},capabilities:{session:{prompt:{embeddedContext:{}}}}}});continue;}
 if(method==='session/new'){
  const sessionId=randomUUID();db[sessionId]={cwd:params.cwd,marker:'none',mode:'safe'};save(db);
  state(sessionId,'idle');send({id,result:{sessionId,configOptions:config()}});continue;
 }
 const session=db[params.sessionId];
 if(!session){send({id,error:{code:-32002,message:'Native session missing'}});continue;}
 if(method==='session/resume'){
  if(params.cwd!==session.cwd){send({id,error:{code:-32602,message:'workspace mismatch'}});continue;}
  // Even a broken replaying peer must not duplicate locally archived history.
  update(params.sessionId,{sessionUpdate:'agent_message',messageId:'bad-replay',content:[{type:'text',text:'FORBIDDEN_SETUP_REPLAY'}]});
  if(session.resumeBehavior!=='missing_state')state(params.sessionId,session.resumeBehavior==='busy'?'running':'idle');
  send({id,result:{configOptions:config(session.mode)}});continue;
 }
 if(method==='session/set_config_option'){
  session.mode=params.value;save(db);send({id,result:{configOptions:config(session.mode)}});continue;
 }
 if(method==='session/prompt'){
  const text=params.prompt.map(block=>block.text??'').join('');
  if(text.startsWith('remember:'))session.marker=text.slice('remember:'.length);
  save(db);const messageId=randomUUID();update(params.sessionId,{sessionUpdate:'user_message',messageId,content:params.prompt});
  state(params.sessionId,'running');send({id,result:{messageId}});
  if(text==='/wait')continue;
  update(params.sessionId,{sessionUpdate:'agent_message',messageId:randomUUID(),content:[{type:'text',text:`memory:${session.marker};mode:${session.mode}`} ]});
  state(params.sessionId,'idle','end_turn');continue;
 }
 if(method==='session/close'||method==='session/cancel'){send({id,result:{}});continue;}
 send({id,error:{code:-32601,message:'Unsupported fixture method'}});
}
