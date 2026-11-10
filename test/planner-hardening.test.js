'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createToolRegistry } = require('../agent/toolRegistry');
const { createPermissionManager } = require('../agent/permissions');
const { createAgentBrain, boundedPrompt } = require('../agent/brain');

function register(registry, name, handler, schema = { type:'object', properties:{}, additionalProperties:false }, permissions=['user']) {
  registry.register({ name, description:`Tool ${name} does a useful task.`, parameters:schema, permissions, handler });
}

test('AI discovery selects tools first and only selected schemas are sent to the planner', async () => {
  const registry=createToolRegistry(); let alpha=0, calls=[];
  register(registry,'alpha_tool',async()=>{alpha++;return 'alpha'});
  register(registry,'beta_tool',async()=> 'beta');
  const brain=createAgentBrain({registry,askModel:async(prompt,opts)=>{
    calls.push(prompt);
    if(calls.length===1) return JSON.stringify({action:'discover',tools:['alpha_tool'],confidence:0.99});
    if(calls.length===2) return JSON.stringify({action:'plan',steps:[{tool:'alpha_tool',arguments:{}}],confidence:0.99});
    return 'Completed alpha.';
  }});
  const result=await brain.handle({message:'Please do the alpha task',actor:'user'});
  assert.equal(alpha,1); assert.equal(result.reply,'Completed alpha.');
  assert.match(calls[0],/alpha_tool/); assert.doesNotMatch(calls[0],/"parameters"/);
  assert.match(calls[1],/alpha_tool/); assert.doesNotMatch(calls[1],/beta_tool/);
});

test('AI can execute a validated multi-step plan in order', async () => {
  const registry=createToolRegistry(); const order=[];
  register(registry,'first_step',async()=>{order.push('first');return 1});
  register(registry,'second_step',async()=>{order.push('second');return 2});
  let n=0;
  const brain=createAgentBrain({registry,askModel:async()=>++n===1?JSON.stringify({action:'plan',steps:[{tool:'first_step',arguments:{}},{tool:'second_step',arguments:{}}],confidence:0.99}):'Both steps completed.'});
  const result=await brain.handle({message:'Do both tasks',actor:'user'});
  assert.deepEqual(order,['first','second']); assert.equal(result.outcomes.length,2);
});

test('invalid later step is rejected before any side effect', async () => {
  const registry=createToolRegistry(); let ran=0; register(registry,'safe_action',async()=>{ran++;return true});
  const bad=JSON.stringify({action:'plan',steps:[{tool:'safe_action',arguments:{}},{tool:'missing_tool',arguments:{}}],confidence:0.99});
  const brain=createAgentBrain({registry,askModel:async()=>bad});
  await assert.rejects(()=>brain.handle({message:'run these',actor:'user'}),/invalid after one correction|not discovered|not registered/i);
  assert.equal(ran,0);
});

test('invalid arguments are corrected once before any execution', async () => {
  const registry=createToolRegistry(); let ran=0;
  register(registry,'needs_value',async({value})=>{ran++;return value},{type:'object',properties:{value:{type:'string',minLength:1}},required:['value'],additionalProperties:false});
  let n=0;
  const brain=createAgentBrain({registry,askModel:async()=>{n++; if(n===1) return JSON.stringify({action:'tool',tool:'needs_value',arguments:{},confidence:0.99}); if(n===2) return JSON.stringify({action:'tool',tool:'needs_value',arguments:{value:'ok'},confidence:0.99}); return 'Done.';}});
  const result=await brain.handle({message:'use it',actor:'user'});
  assert.equal(ran,1); assert.equal(result.reply,'Done.');
});

test('invalid plan after the one correction attempt never executes', async () => {
  const registry=createToolRegistry(); let ran=0;
  register(registry,'needs_value',async()=>{ran++;return true},{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false});
  const invalid=JSON.stringify({action:'tool',tool:'needs_value',arguments:{},confidence:0.99});
  const brain=createAgentBrain({registry,askModel:async()=>invalid});
  await assert.rejects(()=>brain.handle({message:'use it',actor:'user'}),/one correction attempt/i);
  assert.equal(ran,0);
});

test('low confidence plans do not execute', async () => {
  const registry=createToolRegistry(); let ran=0; register(registry,'low_confidence_tool',async()=>{ran++;return true});
  const brain=createAgentBrain({registry,askModel:async()=>JSON.stringify({action:'tool',tool:'low_confidence_tool',arguments:{},confidence:0.4,response:'Please clarify.'})});
  const result=await brain.handle({message:'maybe do it',actor:'user'});
  assert.equal(ran,0); assert.equal(result.reply,'Please clarify.');
});

test('ordinary answer does not trigger registry execution', async () => {
  const registry=createToolRegistry(); let ran=0; register(registry,'unused_tool',async()=>{ran++;return true});
  const brain=createAgentBrain({registry,askModel:async()=>JSON.stringify({action:'answer',response:'Here is the answer.'})});
  const result=await brain.handle({message:'What is 2 + 2?',actor:'user'});
  assert.equal(result.reply,'Here is the answer.'); assert.equal(ran,0);
});

test('catalog hides system-admin tools from ordinary users', () => {
  const permissions=createPermissionManager({ownerNumber:'1111111111',adminNumbers:['2222222222']});
  const registry=createToolRegistry({permissions});
  register(registry,'public_tool',async()=>true);
  register(registry,'admin_tool',async()=>true,undefined,['admin','owner']);
  assert.deepEqual(registry.catalog({actor:'3333333333@s.whatsapp.net'}).map(x=>x.name),['public_tool']);
  assert.ok(registry.catalog({actor:'2222222222@s.whatsapp.net'}).some(x=>x.name==='admin_tool'));
});

test('catalog entries remain compact and omit full schemas', () => {
  const registry=createToolRegistry();
  register(registry,'compact_tool',async()=>true,{type:'object',properties:{veryLarge:{type:'string',description:'x'.repeat(2000)}},additionalProperties:false});
  const catalog=registry.catalog();
  assert.ok(catalog[0].description.length<=150);
  assert.equal(Object.hasOwn(catalog[0],'parameters'),false);
});

test('bounded prompt stays within the configured 32k maximum budget', () => {
  const old=process.env.JARVIS_AGENT_PROMPT_MAX_CHARS;
  process.env.JARVIS_AGENT_PROMPT_MAX_CHARS='35000';
  try {
    const prompt=boundedPrompt({catalog:'catalog',history:'h'.repeat(50000),message:'user request'});
    assert.ok(prompt.length<=32000); assert.match(prompt,/CURRENT USER REQUEST/);
  } finally { if(old===undefined) delete process.env.JARVIS_AGENT_PROMPT_MAX_CHARS; else process.env.JARVIS_AGENT_PROMPT_MAX_CHARS=old; }
});

test('bounded prompt preserves the tail of an oversized current user request', () => {
  const old=process.env.JARVIS_AGENT_PROMPT_MAX_CHARS;
  process.env.JARVIS_AGENT_PROMPT_MAX_CHARS='35000';
  try {
    const prompt=boundedPrompt({message:'x'.repeat(50000)+'FINAL-REQUEST-DETAIL'});
    assert.ok(prompt.length<=32000); assert.ok(prompt.includes('FINAL-REQUEST-DETAIL'));
  } finally { if(old===undefined) delete process.env.JARVIS_AGENT_PROMPT_MAX_CHARS; else process.env.JARVIS_AGENT_PROMPT_MAX_CHARS=old; }
});

test('bounded prompt trims old conversation before the current request', () => {
  const prompt=boundedPrompt({history:'OLD-CONTEXT-'.repeat(2000),message:'CURRENT-NEEDLE'});
  assert.ok(prompt.length<=40000); assert.ok(prompt.includes('CURRENT-NEEDLE'));
});

test('parser accepts fenced and embedded JSON but rejects arrays', () => {
  const { parsePlan }=require('../agent/brain');
  assert.equal(parsePlan('```json\n{"action":"answer","response":"ok"}\n```').action,'answer');
  assert.equal(parsePlan('Model says: {"action":"answer","response":"ok"} end').action,'answer');
  assert.throws(()=>parsePlan('[1,2,3]'),/invalid structured/i);
});

test('multi-step plans are capped at five actions', async () => {
  const registry=createToolRegistry(); register(registry,'step_tool',async()=>true);
  const steps=Array.from({length:6},()=>({tool:'step_tool',arguments:{}}));
  const brain=createAgentBrain({registry,askModel:async()=>JSON.stringify({action:'plan',steps,confidence:0.99})});
  await assert.rejects(()=>brain.handle({message:'too many steps',actor:'user'}),/one correction attempt/i);
});

test('approval-pending result stops the rest of a multi-step plan', async () => {
  const registry=createToolRegistry({approvals:{request:async()=>({approvalRequired:true,approvalId:'pending-1'})}});
  let second=0;
  registry.register({name:'approved_step',description:'Requires approval',parameters:{type:'object',properties:{},additionalProperties:false},permissions:['user'],requiresApproval:true,handler:async()=>true});
  register(registry,'later_step',async()=>{second++;return true});
  let n=0;
  const brain=createAgentBrain({registry,askModel:async()=>++n===1?JSON.stringify({action:'plan',steps:[{tool:'approved_step',arguments:{}},{tool:'later_step',arguments:{}}],confidence:0.99}):'Approval is pending.'});
  await brain.handle({message:'do both',actor:'user'});
  assert.equal(second,0);
});


test('nested array/object arguments are validated recursively', async () => {
  const registry=createToolRegistry();
  registry.register({name:'nested_schema_tool',description:'nested',permissions:['user'],parameters:{type:'object',properties:{files:{type:'array',items:{type:'object',properties:{path:{type:'string',maxLength:20},content:{type:'string',maxLength:100}},required:['path','content'],additionalProperties:false}}},required:['files'],additionalProperties:false},handler:async()=>true});
  await assert.rejects(()=>registry.execute('nested_schema_tool',{files:[{path:'index.html',content:'ok',extra:'blocked'}]},{actor:'user'}),/Unexpected argument/);
  await assert.rejects(()=>registry.execute('nested_schema_tool',{files:[{path:'x'.repeat(21),content:'ok'}]},{actor:'user'}),/too long/);
});

test('duplicate tool steps are rejected before any side effect', async () => {
  const registry=createToolRegistry(); let ran=0; register(registry,'one_action',async()=>{ran++;return true});
  const duplicate=JSON.stringify({action:'plan',steps:[{tool:'one_action',arguments:{}},{tool:'one_action',arguments:{}}],confidence:0.99});
  const brain=createAgentBrain({registry,askModel:async()=>duplicate});
  await assert.rejects(()=>brain.handle({message:'do this twice',actor:'user'}),/duplicate command execution/i);
  assert.equal(ran,0);
});

test('HTTP 413 prompt compaction keeps the leading policy and latest request with one bounded retry payload', () => {
  const { compactPromptAfter413 } = require('../agent/promptBudget');
  const input = 'SYSTEM'.padEnd(6000, 's') + 'H'.repeat(20000) + 'LATEST REQUEST';
  const compacted = compactPromptAfter413(input);
  assert.ok(compacted.length < input.length);
  assert.ok(compacted.startsWith('SYSTEM'));
  assert.ok(compacted.endsWith('LATEST REQUEST'));
  assert.match(compacted, /compacted after HTTP 413/);
  assert.equal(compactPromptAfter413('short prompt'), null);
});
