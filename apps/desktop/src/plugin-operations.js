const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function invokePluginOperation(transport,plugin,body,{key=crypto.randomUUID(),pause=sleep}={}) {
 let receipt;
 try {receipt=await transport.submit(plugin,{...body,key});}
 catch(cause){if(cause.status>=400&&cause.status<500)throw cause;throw Object.assign(Error('提交结果尚未确认，请查看最近后台操作，避免重复执行。'),{cause,operationKey:key});}
 if(!receipt?.operationId)throw Error('主机没有返回操作回执，请刷新后查看最近后台操作。');
 for(;;){
  let record;
  try {record=await transport.read(receipt.operationId);}
  catch(cause){throw Object.assign(Error('操作已受理，连接恢复后可在最近后台操作中查看结果。'),{cause,operationId:receipt.operationId});}
  if(record.state==='succeeded'){await transport.refresh();return record.result;}
  if(['failed','interrupted'].includes(record.state)){
   await transport.refresh();
   throw Object.assign(Error(record.error?.message??'插件操作未完成'),{code:record.error?.code,operationId:receipt.operationId});
  }
  if(!['accepted','running'].includes(record.state))throw Object.assign(Error('无法识别操作状态，请在最近后台操作中核对。'),{operationId:receipt.operationId});
  await pause(250);
 }
}

const operationStates={accepted:'已受理',running:'执行中',succeeded:'已完成',failed:'失败',interrupted:'已中断'};
export function operationPresentation(operation){
 const date=typeof operation.createdAt==='number'?new Date(operation.createdAt):null;
 return {title:operation.title||operation.handler||'未知操作',plugin:operation.pluginName||operation.pluginId||'未知插件',time:date&&!Number.isNaN(date.getTime())?date.toLocaleString():'时间未知',state:operation.error?.code==='OPERATION_RECORD_INVALID'?'记录异常':Object.hasOwn(operationStates,operation.state)?operationStates[operation.state]:'未知状态'};
}
