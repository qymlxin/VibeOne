import test from 'node:test';
import assert from 'node:assert/strict';
import {inputFields,initialInputValues,inputContent,valuesFromInput,initialInputJson} from '../apps/desktop/src/input-form.js';
const schema={type:'object',properties:{color:{type:'string',title:'颜色',oneOf:[{const:'blue',title:'蓝色',description:'深色主题'},{const:'',title:'不指定'}]},count:{type:'integer'},notes:{type:'string'},include:{type:'boolean'},confirmed:{type:'boolean'},tags:{type:'array',items:{type:'string',enum:['a','b']}},secret:{type:'string',_meta:{codex:{isSecret:true}}}},required:['color','count','confirmed']};
test('Codex oneOf choices preserve exact values and do not preselect an answer',()=>{
 const fields=inputFields(schema),values=initialInputValues(fields);
 assert.equal(fields[0].options[0].label,'蓝色');assert.equal(fields.at(-1).secret,true);
 const booleanChoices=inputFields({type:'object',properties:{answer:{type:'boolean',enum:[true,false]}},required:['answer']});
 assert.equal(initialInputValues(booleanChoices).answer,undefined);
 assert.deepEqual(inputContent(booleanChoices,{answer:false}),{answer:false});
 assert.equal(values.color,undefined);assert.equal(values.include,undefined);assert.equal(values.confirmed,false);
 assert.throws(()=>inputContent(fields,values),/颜色/);
 assert.deepEqual(inputContent(fields,{...values,color:'blue',count:'3'}),{color:'blue',count:3,confirmed:false});
 assert.deepEqual(inputContent(fields,{...values,color:'',count:'0'}),{color:'',count:0,confirmed:false});
});
test('numeric, boolean and multiple choices retain types and reject invalid data',()=>{
 const fields=inputFields(schema),values={...initialInputValues(fields),color:'blue',count:'2',include:false,tags:['a','b']};
 assert.deepEqual(inputContent(fields,values),{color:'blue',count:2,include:false,confirmed:false,tags:['a','b']});
 assert.throws(()=>inputContent(fields,{...values,count:'2.5'}),/整数/);
 assert.throws(()=>inputContent(fields,{...values,count:'Infinity'}),/数字|整数/);
 assert.throws(()=>inputContent(fields,{...values,count:'  '}),/填写/);
 assert.throws(()=>inputContent(fields,{...values,count:false}),/数字/);
 assert.throws(()=>inputContent(fields,{...values,notes:false}),/文本/);
 assert.throws(()=>inputContent(fields,{...values,color:'invented'}),/选项/);
 assert.throws(()=>inputContent(fields,{...values,tags:['invented']}),/选项/);
});
test('required property presence does not invent a nonempty constraint on strings or arrays',()=>{
 const fields=inputFields({type:'object',properties:{text:{type:'string'},tags:{type:'array',items:{enum:['x']}}},required:['text','tags']});
 assert.deepEqual(inputContent(fields,initialInputValues(fields)),{text:'',tags:[]});
});
test('complex schemas retain the JSON path and explicit defaults',()=>{
 for(const properties of [{nested:{type:'object'}},{mixed:{anyOf:[{type:'string'},{type:'number'}]}},{list:{type:'array',items:{type:'object'}}}])assert.equal(inputFields({type:'object',properties}),null);
 assert.equal(inputFields({type:'object',properties:{},dependentRequired:{x:['y']}}),null);
 assert.deepEqual(JSON.parse(initialInputJson({properties:{nested:{type:'object',default:{a:1}}}})),{nested:{a:1}});
 const content={color:'blue',count:2,confirmed:false},fields=inputFields(schema);
 assert.deepEqual(inputContent(fields,valuesFromInput(fields,content)),content);
 assert.throws(()=>valuesFromInput(fields,{...content,extra:1}),/未覆盖/);
 assert.throws(()=>valuesFromInput(fields,[]),/JSON对象/);
});
test('request field names remain data including prototype-shaped keys',()=>{
 const source=JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string","default":"value"},"constructor":{"type":"string","default":"field"}}}');
 const content=inputContent(inputFields(source),initialInputValues(inputFields(source)));
 assert.equal(Object.hasOwn(content,'__proto__'),true);assert.equal(content.__proto__,'value');assert.equal(content.constructor,'field');
 assert.equal({}.polluted,undefined);
});
