 'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createToolRegistry}=require('../agent/toolRegistry');
const {createPermissionManager}=require('../agent/permissions');
const {createAgentBrain}=require('../agent/brain');
const {runSandboxed}=require('../agent/shellAgent');
test('registry validates arguments and executes authorized tools',async()=>{
 const permissions=createPermissionManager({ownerNumber:'1234567890'});
 const registry=createToolRegistry({permissions});
 registry.register({name:'echo_test',description:'test',parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},permissions:['user'],handler:async({value})=>value});
 const result=await registry.execute('echo_test',{value:'ok'},{actor:'2222222222@s.whatsapp.net'});
 assert.equal(result.result,'ok');
 await assert.rejects(()=>registry.execute('echo_test',{unexpected:1},{actor:'2222222222'}),/Unexpected argument/);
});
test('owner-only tools reject ordinary users',async()=>{
 const permissions=createPermissionManager({ownerNumber:'1234567890'});
 const registry=createToolRegistry({permissions});
 registry.register({name:'owner_tool',description:'owner only',parameters:{type:'object',properties:{},additionalProperties:false},permissions:['owner'],handler:async()=>true});
 await assert.rejects(()=>registry.execute('owner_tool',{}, {actor:'2222222222@s.whatsapp.net'}),/Permission denied/);
});
test('agent brain invokes only a registered tool',async()=>{
 const registry=createToolRegistry();
 registry.register({name:'echo_tool',description:'echo',parameters:{type:'object',properties:{},additionalProperties:false},handler:async()=>({ok:true})});
 let n=0; const formats=[];
 const brain=createAgentBrain({registry,askModel:async (prompt, options={})=>{formats.push(options.responseFormat); return ++n===1?JSON.stringify({action:'tool',tool:'echo_tool',arguments:{},confidence:0.96}):'Tool ran successfully';}});
 const result=await brain.handle({message:'do it',actor:'x'});
 assert.equal(result.reply,'Tool ran successfully');
 assert.equal(result.tool,'echo_tool');
 assert.deepEqual(formats,['json','text']);
});
test('shell runner rejects shell operators before Docker invocation',async()=>{
 await assert.rejects(()=>runSandboxed('ls; echo unsafe'),/Shell operators/);
});
const { PlatformAuth } = require('../agent/platformAuth');
test('platform auth refuses unknown providers and missing credentials',async()=>{
 const auth=new PlatformAuth();
 await assert.rejects(()=>auth.verify('unknown-platform'),/No verified connector/);
 await assert.rejects(()=>auth.verify('github'),/Configure GITHUB_TOKEN/);
});
test('platform auth rejects generic adapters that are not HTTPS',()=>{
 const old=process.env.JARVIS_PLATFORM_ADAPTERS;
 process.env.JARVIS_PLATFORM_ADAPTERS=JSON.stringify([{name:'bad',tokenEnv:'TOKEN',verifyUrl:'http://invalid.test/me'}]);
 try { assert.throws(()=>new PlatformAuth(),/HTTPS verifyUrl/); } finally { if(old===undefined) delete process.env.JARVIS_PLATFORM_ADAPTERS; else process.env.JARVIS_PLATFORM_ADAPTERS=old; }
});
const { ApprovalManager } = require('../agent/approvals');
const { DynamicCommandBuilder } = require('../agent/dynamicCommandBuilder');
const fs = require('fs');
const os = require('os');
const path = require('path');
test('approval manager requires owner and executes approved action once', async () => {
 const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(),'jarvis-approval-'));
 const approvals = new ApprovalManager({ directory: dir });
 await approvals.load();
 const pending = await approvals.request({ tool:'danger_tool', args:{x:1}, context:{actor:'admin'} });
 await assert.rejects(() => approvals.decide(pending.approvalId,{actor:'admin',isOwner:false,approve:true,execute:async()=>true}),/Approval requires the JARVIS owner\/system admin/);
 let count=0;
 const result = await approvals.decide(pending.approvalId,{actor:'owner',isOwner:true,approve:true,execute:async item=>{count++;return item.args.x;}});
 assert.equal(result.result,1);
 assert.equal(count,1);
 await assert.rejects(() => approvals.decide(pending.approvalId,{actor:'owner',isOwner:true,approve:true,execute:async()=>true}),/not found or expired/);
 await fs.promises.rm(dir,{recursive:true,force:true});
});
test('registry queues approval-gated tools and only runs them after approval', async () => {
 const approvals = { request: async item => ({approvalRequired:true,tool:item.tool}) };
 const registry = createToolRegistry({ approvals });
 let ran=false;
 registry.register({name:'sensitive_tool',description:'sensitive',parameters:{type:'object',properties:{},additionalProperties:false},permissions:['public'],requiresApproval:true,handler:async()=>{ran=true;return 'done';}});
 const pending=await registry.execute('sensitive_tool',{},{});
 assert.equal(pending.result.approvalRequired,true);
 assert.equal(ran,false);
 const result=await registry.execute('sensitive_tool',{}, {approved:true});
 assert.equal(result.result,'done');
 assert.equal(ran,true);
});
test('dynamic command builder rejects undeclared template placeholders', () => {
 const builder = new DynamicCommandBuilder({registry:createToolRegistry()});
 assert.throws(()=>builder.validate({name:'say_hi',description:'hi',parameters:{type:'object',properties:{},additionalProperties:false},implementation:{operation:'template',template:'Hello {{name}}'}}),/not declared in parameters/);
});
test('sandbox rejects normalized paths that escape the workspace', async () => {
 await assert.rejects(() => runSandboxed('ls', {cwd:'/workspace/../../etc'}), /Working directory must be inside \/workspace/);
});

test('agent brain refuses low-confidence tool execution', async()=>{
 const registry=createToolRegistry(); let ran=false;
 registry.register({name:'safe_tool',description:'safe',parameters:{type:'object',properties:{},additionalProperties:false},handler:async()=>{ran=true;return true;}});
 const brain=createAgentBrain({registry,askModel:async()=>JSON.stringify({action:'tool',tool:'safe_tool',arguments:{},confidence:0.4,response:'Please clarify.'})});
 const result=await brain.handle({message:'maybe do this',actor:'x'});
 assert.equal(result.reply,'Please clarify.'); assert.equal(ran,false);
});

const { detectWatchdogViolation } = require('../agent/watchdog');
test('watchdog whole-word matching does not flag ordinary code/model text', () => {
 assert.deepEqual(detectWatchdogViolation('I am writing code for the model'), {isBadWord:false,isLink:false});
 assert.equal(detectWatchdogViolation('ode').isBadWord,true);
 assert.equal(detectWatchdogViolation('that was stupid').isBadWord,true);
});
test('watchdog detects real links without treating a bare .com mention as a URL', () => {
 assert.equal(detectWatchdogViolation('Visit https://example.com/page').isLink,true);
 assert.equal(detectWatchdogViolation('example.com').isLink,true);
 assert.equal(detectWatchdogViolation('the string .com appears here').isLink,false);
});
test('requesting WhatsApp group admins can approve only approvals from that same group', async () => {
 const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(),'jarvis-group-approval-'));
 const approvals = new ApprovalManager({ directory: dir });
 await approvals.load();
 const pending = await approvals.request({ tool:'group_tool', args:{}, context:{actor:'member@s.whatsapp.net',chatId:'123@g.us',isGroup:true} });
 await assert.rejects(() => approvals.decide(pending.approvalId,{actor:'admin@s.whatsapp.net',isGroupAdmin:true,chatId:'999@g.us',approve:true,execute:async()=>true}),/administrator of the WhatsApp group/);
 const result = await approvals.decide(pending.approvalId,{actor:'admin@s.whatsapp.net',isGroupAdmin:true,chatId:'123@g.us',approve:true,execute:async()=>({done:true})});
 assert.equal(result.status,'executed');
 await fs.promises.rm(dir,{recursive:true,force:true});
});

test('command inventor registers safe templates as callable tools', async () => {
 const registry=createToolRegistry();
 const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'jarvis-command-'));
 const builder=new DynamicCommandBuilder({directory:dir,registry});
 const spec={name:'welcome_member',description:'Welcome member',parameters:{type:'object',properties:{name:{type:'string'},group:{type:'string'}},required:[],additionalProperties:false},implementation:{operation:'template',template:'Welcome {{name}} to {{group}}!'}};
 await builder.create(spec,{approved:true});
 const tool=registry.tools.get('welcome_member');
 assert.equal(tool.dynamicCommand,true);
 const result=await registry.execute('welcome_member',{name:'Ada',group:'Flexi'},{actor:'123@s.whatsapp.net',isAdmin:true});
 assert.equal(result.result.text,'Welcome Ada to Flexi!');
 await fs.promises.rm(dir,{recursive:true,force:true});
});

test('system admins are authorized for admin-scoped tools alongside the owner', async () => {
 const permissions=createPermissionManager({ownerNumber:'1111111111',adminNumbers:['2222222222']});
 const registry=createToolRegistry({permissions});
 registry.register({name:'admin_read_tool',description:'admin read',parameters:{type:'object',properties:{},additionalProperties:false},permissions:['admin','owner'],handler:async()=>({ok:true})});
 assert.equal((await registry.execute('admin_read_tool',{}, {actor:'2222222222@s.whatsapp.net'})).result.ok,true);
 assert.equal((await registry.execute('admin_read_tool',{}, {actor:'1111111111@s.whatsapp.net'})).result.ok,true);
 await assert.rejects(()=>registry.execute('admin_read_tool',{}, {actor:'3333333333@s.whatsapp.net'}),/Permission denied/);
});

test('agent brain does not send a duplicate AI reply after a WhatsApp command handler replies', async () => {
 const registry=createToolRegistry();
 registry.register({name:'wa_command',description:'dispatch',parameters:{type:'object',properties:{},additionalProperties:false},handler:async()=>({whatsappCommandDispatched:true,command:'!status'})});
 let calls=0;
 const brain=createAgentBrain({registry,askModel:async()=>{calls++;return JSON.stringify({action:'tool',tool:'wa_command',arguments:{},confidence:0.99});}});
 const result=await brain.handle({message:'check status',actor:'user'});
 assert.equal(result.commandDispatched,true);
 assert.equal(result.reply,'');
 assert.equal(calls,1);
});

test('system admins can approve approval-gated actions', async () => {
 const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'jarvis-system-admin-'));
 const approvals=new ApprovalManager({directory:dir});
 await approvals.load();
 const pending=await approvals.request({tool:'sensitive_tool',args:{},context:{actor:'member',chatId:'private-chat',isGroup:false}});
 const result=await approvals.decide(pending.approvalId,{actor:'admin',isSystemAdmin:true,approve:true,execute:async()=>({completed:true})});
 assert.equal(result.status,'executed');
 await fs.promises.rm(dir,{recursive:true,force:true});
});

test('WhatsApp group-admin status does not grant global JARVIS system-admin permissions', async () => {
 const permissions=createPermissionManager({ownerNumber:'1111111111',adminNumbers:['2222222222']});
 const registry=createToolRegistry({permissions});
 registry.register({name:'github_admin_action',description:'system admin action',parameters:{type:'object',properties:{},additionalProperties:false},permissions:['admin','owner'],handler:async()=>true});
 await assert.rejects(()=>registry.execute('github_admin_action',{}, {actor:'3333333333@s.whatsapp.net',isAdmin:true}),/Permission denied/);
 assert.equal((await registry.execute('github_admin_action',{}, {actor:'2222222222@s.whatsapp.net'})).result,true);
});
