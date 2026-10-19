import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createCorporateModels } from './corporate-models.mjs';
import { modelAdmin } from './model-admin.mjs';
import { readJson } from './model-gateway.mjs';
const request=(method,body)=>Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{method});
test('admin discover/test resolve masked secrets without personal credentials or upstream error echo',async()=> {
 const root=await mkdtemp(`${tmpdir()}/corporate-admin-`),store=createCorporateModels({root,secret:'secret'.repeat(8)});
 try {
 const saved=await store.update({revision:'initial',providers:{test:{api:'openai-completions',baseUrl:'https://example.com/v1',apiKey:'UPSTREAM-SECRET',models:[{id:'m',headers:{'x-secret':'HEADER-SECRET'}}]}}});
 const provider=saved.providers.test;
 let calls=0;
 const options={checkTarget:async()=>{},fetcher:async(url,options)=> { calls++; assert.equal(options.headers.get('authorization'),'Bearer UPSTREAM-SECRET'); if(calls===1) { assert.equal(url.pathname,'/v1/models'); return Response.json({data:[{id:'m',name:'UPSTREAM-SECRET'}]}); } assert.equal(options.headers.get('x-secret'),'HEADER-SECRET'); return new Response('UPSTREAM-SECRET',{status:401}); }};
 const discover=await modelAdmin(request('POST',{providerName:'test',provider}),new URL('http://manager/admin/models-config/discover'),store,options);
 assert.equal(discover.models[0].id,'m'); assert.ok(!JSON.stringify(discover).includes('UPSTREAM-SECRET'));
 const result=await modelAdmin(request('POST',{providerName:'test',provider,model:provider.models[0]}),new URL('http://manager/admin/models-config/test'),store,options);
 assert.equal(result.ok,false); assert.ok(!JSON.stringify(result).includes('UPSTREAM-SECRET'));
 const invalid={...provider,apiKey:'retain:unrecognized'}; await assert.rejects(modelAdmin(request('POST',{providerName:'test',provider:invalid}),new URL('http://manager/admin/models-config/discover'),store,options)); assert.equal(calls,2);
 } finally { await rm(root,{recursive:true,force:true}); }
});
test('oversized admin body is rejected before parsing',async()=> { await assert.rejects(readJson(Readable.from([Buffer.alloc(1048577)])),e=>e.status===413); });
