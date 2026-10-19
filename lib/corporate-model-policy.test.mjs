import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createJiti } from 'jiti';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
const jiti=createJiti(import.meta.url,{alias:{'@':process.cwd()}});
await jiti.import('./corporate-model-runtime.ts');
const {personalModelsAllowed,personalModelPath}=await jiti.import('./corporate-model-policy.ts');
test('same SDK runtime filters lists, selection, auth and already-open execution after policy changes',async()=> {
 const root=mkdtempSync(`${tmpdir()}/corp-runtime-`), path=`${root}/snapshot.json`;
 const previous=process.env.PI_WEB_MODEL_SNAPSHOT;
 const company={api:'openai-completions',baseUrl:'http://worker-manager:3030/gateway/user/test',apiKey:'gateway-token',models:[{id:'company-model',name:'Company',contextWindow:32000,maxTokens:4096,input:['text'],reasoning:false,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]};
 const save=(revision,allowPersonalModels,providers={'corp-test':company})=>writeFileSync(path,JSON.stringify({version:1,revision,allowPersonalModels,providers}));
 try {
 save('1',true); process.env.PI_WEB_MODEL_SNAPSHOT=path;
 const runtime=await ModelRuntime.create({modelsPath:null,authPath:`${root}/auth.json`,modelsStorePath:`${root}/store.json`,refreshOnCreate:false});
 runtime.registerProvider('personal',{api:'openai-completions',baseUrl:'https://example.test/v1',apiKey:'personal-key',models:[{id:'personal-model'}]});
 const personal=runtime.getModel('personal','personal-model'); assert.ok(personal);
 assert.ok(runtime.getModel('corp-test','company-model')); assert.ok(runtime.getModels().some(m=>m.provider==='personal'));
 save('2',false);
 assert.equal(personalModelsAllowed(),false);
 assert.equal(runtime.getModel('personal','personal-model'),undefined);
 assert.ok(runtime.getModels().every(m=>m.provider==='corp-test'));
 assert.ok((await runtime.getAvailable()).every(m=>m.provider==='corp-test'));
 assert.throws(()=>runtime.getAuth(personal),/disabled/);
 assert.throws(()=>runtime.streamSimple(personal,{messages:[]}),/disabled/);
 const corporate=runtime.getModel('corp-test','company-model'); const auth=await runtime.getAuth(corporate,{apiKey:'attacker'}); assert.equal(auth.auth.apiKey,'gateway-token');
 save('3',false,{}); assert.throws(()=>runtime.getAuth(corporate),/disabled/); assert.equal(runtime.getModel('corp-test','company-model'),undefined);
 save('4',true); assert.ok(runtime.getModel('personal','personal-model')); assert.equal((await runtime.getAuth(personal)).auth.apiKey,'personal-key');
 writeFileSync(path,'bad'); assert.throws(()=>runtime.getModels(),/unavailable/);
 } finally { if(previous===undefined) delete process.env.PI_WEB_MODEL_SNAPSHOT; else process.env.PI_WEB_MODEL_SNAPSHOT=previous; rmSync(root,{recursive:true,force:true}); }
});
test('policy covers all auth reads, login and personal config helpers',()=> {
 for(const path of ['/api/auth/providers','/api/auth/login/openai','/api/models-config','/api/models-config/test','/api/models-config/discover','/api/models-config/catalog']) assert.ok(personalModelPath(path));
 assert.equal(personalModelPath('/api/models/default'),false); assert.equal(personalModelPath('/api/models/enabled'),false);
});

test('live auth check denies stale snapshots after a manager policy update',async()=> {
 const root=mkdtempSync(`${tmpdir()}/corp-live-policy-`),path=`${root}/snapshot.json`;
 const previous=process.env.PI_WEB_MODEL_SNAPSHOT, fetchOriginal=globalThis.fetch;
 try {
 writeFileSync(path,JSON.stringify({version:1,revision:'stale',allowPersonalModels:true,providers:{},policyUrl:'http://manager.test/gateway/id/policy',gatewayToken:'gateway-token'})); process.env.PI_WEB_MODEL_SNAPSHOT=path;
 const runtime=await ModelRuntime.create({modelsPath:null,refreshOnCreate:false});
 runtime.registerProvider('personal-live',{api:'openai-completions',baseUrl:'https://example.test',apiKey:'personal-key',models:[{id:'test'}]});
 const model=runtime.getModel('personal-live','test');
 globalThis.fetch=async(url,options)=> { assert.equal(options.headers.authorization,'Bearer gateway-token'); return Response.json({allowPersonalModels:false,models:{}}); };
 await assert.rejects(runtime.getAuth(model),/disabled/);
 globalThis.fetch=async()=> { throw new Error('network unavailable'); };
 await assert.rejects(runtime.getAuth(model));
 } finally { globalThis.fetch=fetchOriginal; if(previous===undefined) delete process.env.PI_WEB_MODEL_SNAPSHOT; else process.env.PI_WEB_MODEL_SNAPSHOT=previous; rmSync(root,{recursive:true,force:true}); }
});

test('an already-open AgentSession cannot send another personal request after revocation',async()=> {
 const {fauxProvider,fauxAssistantMessage,fauxText}=await import('@earendil-works/pi-ai');
 const {createAgentSession,SessionManager,SettingsManager}=await import('@earendil-works/pi-coding-agent');
 const root=mkdtempSync(`${tmpdir()}/corp-open-session-`),path=`${root}/snapshot.json`;
 const previous=process.env.PI_WEB_MODEL_SNAPSHOT; let session;
 const save=(revision,allowPersonalModels)=>writeFileSync(path,JSON.stringify({version:1,revision,allowPersonalModels,providers:{}}));
 try {
 save('before',true); process.env.PI_WEB_MODEL_SNAPSHOT=path;
 const faux=fauxProvider({models:[{id:'personal-session-model'}]}); let requests=0;
 faux.setResponses([()=>{requests++;return fauxAssistantMessage([fauxText('first response')]);},()=>{requests++;return fauxAssistantMessage([fauxText('must not execute')]);}]);
 const runtime=await ModelRuntime.create({authPath:`${root}/auth.json`,modelsPath:null,refreshOnCreate:false}); runtime.registerNativeProvider(faux.provider);
 ({session}=await createAgentSession({cwd:root,agentDir:root,modelRuntime:runtime,model:faux.getModel('personal-session-model'),tools:[],sessionManager:SessionManager.inMemory(root),settingsManager:SettingsManager.inMemory()}));
 await session.prompt('first request'); assert.equal(requests,1);
 save('after',false);
 try { await session.prompt('second request'); } catch { /* SDK may reject before a transcript error is produced. */ }
 assert.equal(requests,1);
 } finally { session?.dispose(); if(previous===undefined) delete process.env.PI_WEB_MODEL_SNAPSHOT; else process.env.PI_WEB_MODEL_SNAPSHOT=previous; rmSync(root,{recursive:true,force:true}); }
});
