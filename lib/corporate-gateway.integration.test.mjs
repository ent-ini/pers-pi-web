import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { gateway } from '../multiuse-manager/model-gateway.mjs';

test('all four real SDK adapters reach only the configured gateway operations',async()=> {
 const id='11111111-1111-4111-8111-111111111111', calls=[], incoming=[];
 const protocols=['openai-completions','openai-responses','anthropic-messages','google-generative-ai'];
 const providers=Object.fromEntries(protocols.map((api,index)=>[`p${index}`,{api,baseUrl:'https://example.com',apiKey:'MANAGER-ONLY',models:[{id:'model',name:'Test',input:['text'],reasoning:false,contextWindow:32000,maxTokens:4096,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}]));
 const store={authenticate:(user,token)=>user===id && token==='worker-token',read:async()=>({providers})};
 const server=createServer((req,res)=> { incoming.push(req.url); return gateway(req,res,new URL(req.url,'http://local'),store,{checkTarget:async()=>{},fetcher:async(target,options)=> { calls.push({target,options}); return new Response('MANAGER-ONLY',{status:401}); }}); });
 server.listen(0,'127.0.0.1'); await once(server,'listening');
 try {
 const runtime=await ModelRuntime.create({modelsPath:null,refreshOnCreate:false});
 for(const [index,api] of protocols.entries()) {
  const provider=`gateway-test-${index}`;
  runtime.registerProvider(provider,{api,baseUrl:`http://127.0.0.1:${server.address().port}/gateway/${id}/p${index}`,apiKey:'worker-token',models:[{id:'model',name:'Test',input:['text'],reasoning:false,contextWindow:32000,maxTokens:4096,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
  const model=runtime.getModel(provider,'model');
  const result=await runtime.completeSimple(model,{messages:[{role:'user',content:'test',timestamp:0}]},{maxTokens:16,maxRetries:0});
  assert.equal(result.stopReason,'error'); assert.ok(!JSON.stringify(result).includes('MANAGER-ONLY'));
  assert.equal(calls.length,index+1,`${api} did not reach upstream: ${JSON.stringify(result)} ${JSON.stringify(incoming)}`);
 }
 assert.deepEqual(calls.map(c=>c.target.pathname),['/chat/completions','/responses','/v1/messages','/v1beta/models/model:streamGenerateContent']);
 } finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); }
});
