import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { gateway, gatewayOperation, publicAddress } from './model-gateway.mjs';
const p={api:'openai-completions',baseUrl:'https://example.com/v1',apiKey:'TOP-SECRET',headers:{'x-private':'PRIVATE'},models:[{id:'allowed'}]};
test('gateway validates model, exact operation, query and credential overrides',()=> {
 for(const [op,q,body] of [['files','',{model:'allowed'}],['chat/completions','?x=1',{model:'allowed'}],['chat/completions','',{model:'other'}],['chat/completions','',{model:'allowed',api_key:'bad'}]]) assert.throws(()=>gatewayOperation(p,op,q,body));
 assert.equal(gatewayOperation(p,'chat/completions','',{model:'allowed'}).id,'allowed');
 for(const a of ['127.0.0.1','10.0.0.1','169.254.169.254','::ffff:127.0.0.1','fc00::1']) assert.equal(publicAddress(a),false);
});
test('token isolation, injected credentials, sanitized errors and streaming split secret redaction',async()=> {
 let calls=0, headers;
 const store={authenticate:(id,token)=>id==='11111111-1111-4111-8111-111111111111' && token==='worker-token',read:async()=>({providers:{test:p}})};
 const server=createServer((req,res)=>gateway(req,res,new URL(req.url,'http://local'),store,{checkTarget:async()=>{},fetcher:async(url,options)=> { calls++; headers=options.headers; if(calls===2) return new Response('TOP-SECRET',{status:401}); return new Response(new ReadableStream({start(c) { c.enqueue(new TextEncoder().encode('data: TOP-')); c.enqueue(new TextEncoder().encode('SECRET\n\ndata: done\n\n')); c.close(); }}),{headers:{'content-type':'text/event-stream','content-encoding':'gzip'}}); }})); server.listen(0,'127.0.0.1'); await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}/gateway/11111111-1111-4111-8111-111111111111/test/chat/completions`;
 try {
 const request=(url=base,token='worker-token')=>fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'x-private':'attacker'},body:JSON.stringify({model:'allowed',stream:true})});
 assert.equal((await request(base,'wrong')).status,401);
 assert.equal((await request(base.replace('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'))).status,401);
 const result=await request(); assert.equal(result.headers.get('content-encoding'),null); const text=await result.text(); assert.ok(text.includes('done')); assert.ok(!text.includes('TOP-SECRET')); assert.equal(headers.get('authorization'),'Bearer TOP-SECRET'); assert.equal(headers.get('x-private'),'PRIVATE');
 const error=await request(); assert.equal(error.status,502); assert.ok(!(await error.text()).includes('TOP-SECRET'));
 } finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); }
});

test('downstream cancellation aborts the provider stream',async()=> {
 let aborted; const didAbort=new Promise(resolve=>aborted=resolve);
 const store={authenticate:()=>true,read:async()=>({providers:{test:p}})};
 const server=createServer((req,res)=>gateway(req,res,new URL(req.url,'http://local'),store,{checkTarget:async()=>{},fetcher:async(_url,options)=> { options.signal.addEventListener('abort',()=>aborted()); return new Response(new ReadableStream({start(c) { c.enqueue(new TextEncoder().encode('data: stream is running and this chunk is long enough\n\n')); options.signal.addEventListener('abort',()=>c.close()); }}),{headers:{'content-type':'text/event-stream'}}); }}));
 server.listen(0,'127.0.0.1'); await once(server,'listening'); const controller=new AbortController();
 try { const response=await fetch(`http://127.0.0.1:${server.address().port}/gateway/11111111-1111-4111-8111-111111111111/test/chat/completions`,{method:'POST',headers:{authorization:'Bearer token'},body:JSON.stringify({model:'allowed'}),signal:controller.signal}); await response.body.getReader().read(); controller.abort(); await Promise.race([didAbort,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Provider was not aborted')),1000).unref())]); }
 finally { controller.abort(); server.closeAllConnections(); await new Promise(r=>server.close(r)); }
});
