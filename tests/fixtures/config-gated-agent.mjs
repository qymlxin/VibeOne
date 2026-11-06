// Test-owned release/trace files make HTTP disconnect deterministic after ACP receipt.
import {createInterface} from 'node:readline';
import {appendFile,access} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
const [trace,release]=process.argv.slice(2);
const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
const config=value=>[{configId:'mode',name:'Mode',type:'select',currentValue:value,options:[{value:'safe',name:'Safe'},{value:'normal',name:'Normal'}]}];
const update=update=>send({method:'session/update',params:{sessionId:'gated',update}});
for await(const line of createInterface({input:process.stdin})){
 const {id,method,params={}}=JSON.parse(line);
 if(method==='initialize')send({id,result:{protocolVersion:2,info:{name:'config-gated-fixture',version:'1'},capabilities:{session:{prompt:{}}}}});
 else if(method==='session/new'){update({sessionUpdate:'state_update',state:'idle'});send({id,result:{sessionId:'gated',configOptions:config('safe')}});}
 else if(method==='session/prompt'){
  update({sessionUpdate:'state_update',state:'running'});send({id,result:{messageId:'user'}});
  update({sessionUpdate:'agent_message',messageId:'reply',content:[{type:'text',text:'ready'}]});
  update({sessionUpdate:'state_update',state:'idle',stopReason:'end_turn'});
 }else if(method==='session/set_config_option'){
  await appendFile(trace,JSON.stringify(params)+'\n');
  const deadline=Date.now()+6000;let released=false;
  while(Date.now()<deadline){try{await access(release);released=true;break;}catch{}await sleep(20);}
  send(released?{id,result:{configOptions:config(params.value)}}:{id,error:{code:-32603,message:'fixture gate expired'}});
 }else send({id,result:{}});
}
