import {configChoices} from './agent-config.js';
export const isModelOption=option=>option.type==='select'&&(option.category==='model'||option.configId==='model');
export function savedModelOption(sessions,provider,profileId){
 return [...(sessions??[])].filter(session=>session.provider===provider&&(session.profile?.id??null)===(profileId??null))
  .sort((a,b)=>(b.lastActivityAt??0)-(a.lastActivityAt??0)).flatMap(session=>session.agentState?.configOptions??[]).find(option=>isModelOption(option)&&configChoices(option).length);
}
export function modelOptions(option){return configChoices(option??{}).map(item=>({value:item.value,label:item.name??item.value,description:item.group??item.description}));}
