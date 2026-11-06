const primitive=value=>['string','number','boolean'].includes(typeof value)&&!(typeof value==='number'&&!Number.isFinite(value));
function choices(schema){
  if(primitive(schema.const))return [{value:schema.const,label:schema.title??String(schema.const)}];
  if(Array.isArray(schema.enum)&&schema.enum.length&&schema.enum.every(primitive))return schema.enum.map((value,index)=>({value,label:schema.enumNames?.[index]??String(value)}));
  if(Array.isArray(schema.oneOf)&&schema.oneOf.length&&schema.oneOf.every(item=>primitive(item.const)))return schema.oneOf.map(item=>({value:item.const,label:item.title??String(item.const),description:item.description}));
  return null;
}
export function inputFields(schema){
  if(schema?.type!=='object'||!schema.properties||typeof schema.properties!=='object'||Array.isArray(schema.properties)||['$ref','allOf','anyOf','oneOf','if','dependentSchemas','dependentRequired','patternProperties'].some(key=>key in schema))return null;
  const entries=Object.entries(schema.properties);
  if(entries.length>32)return null;
  const fields=[];
  for(const [key,value] of entries){
    if(!value||typeof value!=='object'||['$ref','allOf','anyOf','if','not'].some(key=>key in value))return null;
    const options=choices(value),multiple=value.type==='array',itemOptions=multiple?choices(value.items??{}):null;
    if(value.oneOf&&!options)return null;
    if(!options&&!['string','number','integer','boolean'].includes(value.type)&&!itemOptions)return null;
    if(multiple&&!itemOptions)return null;
    fields.push({key,schema:value,type:value.type??typeof options[0].value,options:options??itemOptions,multiple,required:schema.required?.includes(key)??false,title:value.title||key,secret:value._meta?.codex?.isSecret===true||value.format==='password'});
  }
  return fields;
}
export function initialInputValues(fields){
  return Object.fromEntries(fields.map(field=>[field.key,field.schema.default??(field.multiple?[]:field.options?undefined:field.type==='boolean'?(field.required?false:undefined):'')]));
}
export function inputContent(fields,values,validate=true){
  const entries=[];
  for(const field of fields){
    let value=values[field.key];
    const numeric=['number','integer'].includes(field.type);
    const blankNumber=numeric&&typeof value==='string'&&!value.trim();
    const empty=value===undefined||(value===''&&!field.options)||blankNumber||(Array.isArray(value)&&!value.length);
    if(empty&&!field.required)continue;
    if(validate&&field.required&&(value===undefined||blankNumber))throw Error(`请填写${field.title}`);
    if(numeric&&!blankNumber){
      if(validate&&!['number','string'].includes(typeof value))throw Error(`${field.title}需要数字`);
      const number=Number(value);
      if(validate&&(!Number.isFinite(number)||(field.type==='integer'&&!Number.isInteger(number))))throw Error(`${field.title}需要${field.type==='integer'?'整数':'数字'}`);
      if(Number.isFinite(number))value=number;
    }
    if(validate&&field.options){
      const selected=field.multiple?value:[value];
      if(!Array.isArray(selected)||selected.some(item=>!field.options.some(option=>Object.is(item,option.value))))throw Error(`请选择${field.title}提供的选项`);
    }
    if(validate&&field.type==='string'&&typeof value!=='string')throw Error(`${field.title}需要文本`);
    if(validate&&field.type==='boolean'&&typeof value!=='boolean')throw Error(`${field.title}需要布尔值`);
    entries.push([field.key,value]);
  }
  return Object.fromEntries(entries);
}
export function valuesFromInput(fields,content){
  if(!content||typeof content!=='object'||Array.isArray(content))throw Error('补充输入必须是JSON对象');
  if(Object.keys(content).some(key=>!fields.some(field=>field.key===key)))throw Error('JSON包含表单未覆盖的字段，请继续使用JSON输入');
  for(const field of fields){
    const value=content[field.key];
    if(value===undefined)continue;
    if(field.multiple?(!Array.isArray(value)||value.some(item=>!primitive(item))):!primitive(value))throw Error(`${field.title}的内容请在JSON模式中编辑`);
  }
  const values={...initialInputValues(fields),...content};
  inputContent(fields,values);
  return values;
}

export function initialInputJson(schema){
  return JSON.stringify(schema?.default??Object.fromEntries(Object.entries(schema?.properties??{}).filter(([,field])=>field?.default!==undefined).map(([key,field])=>[key,field.default])),null,2);
}
