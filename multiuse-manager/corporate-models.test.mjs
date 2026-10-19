import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createCorporateModels } from './corporate-models.mjs';
const p={api:'openai-completions',baseUrl:'https://example.com/v1',apiKey:'literal-secret-test',headers:{'x-private':'header-secret'},models:[{id:'model'}]};
test('encrypted canonical state, masked rename, conflicts, live snapshots, corruption preservation',async()=> {
 const root=await mkdtemp(`${tmpdir()}/corp-models-`);
 try {
 const store=createCorporateModels({root,secret:'a'.repeat(40)});
 assert.equal((await store.read()).allowPersonalModels,true);
 const saved=await store.update({revision:'initial',providers:{test:p}});
 assert.ok(saved.providers.test.apiKey.startsWith('retain:'));
 assert.ok(!JSON.stringify(saved).includes('literal-secret-test'));
 const raw=await readFile(`${root}/models.enc`,'utf8'); assert.ok(!raw.includes('secret')); assert.ok(!raw.includes('example.com'));
 const renamed=await store.update({revision:saved.revision,providers:{renamed:saved.providers.test}});
 assert.equal((await store.read()).providers.renamed.apiKey,p.apiKey);
 await assert.rejects(store.update({revision:saved.revision,providers:{}}),e=>e.status===409);
 const id='11111111-1111-4111-8111-111111111111'; await store.publish(id);
 const restart=createCorporateModels({root,secret:'a'.repeat(40)}); await restart.update({allowPersonalModels:false},true);
 const snapshot=JSON.parse(await readFile(`${root}/model-snapshots/${id}/snapshot.json`)); assert.equal(snapshot.allowPersonalModels,false); assert.ok(!JSON.stringify(snapshot).includes(p.apiKey)); assert.equal(snapshot.providers['corp-renamed'].apiKey,store.token(id));
 await assert.rejects(store.update({revision:renamed.revision,providers:{x:{...p,apiKey:'$SECRET'}}}));
 await writeFile(`${root}/models.enc`,'broken'); await assert.rejects(store.read(),e=>e.status===503); await assert.rejects(store.update({allowPersonalModels:true},true)); assert.equal(await readFile(`${root}/models.enc`,'utf8'),'broken');
 } finally { await rm(root,{recursive:true,force:true}); }
});
test('strict schema rejects unknowns, protocols and unbounded values',async()=> {
 const root=await mkdtemp(`${tmpdir()}/corp-models-`); const store=createCorporateModels({root,secret:'x'.repeat(40)});
 try { for(const invalid of [{...p,api:'oauth'},{...p,extra:true},{...p,models:[{id:'a',maxTokens:-1}]},{...p,headers:{Host:'evil'}},{...p,apiKey:'!command'},{...p,baseUrl:'http://127.0.0.1'}]) await assert.rejects(store.update({revision:'initial',providers:{x:invalid}})); } finally { await rm(root,{recursive:true,force:true}); }
});

test('concurrent editors cannot overwrite the same revision',async()=> {
 const root=await mkdtemp(`${tmpdir()}/corp-race-`),store=createCorporateModels({root,secret:'test'.repeat(10)});
 try { const results=await Promise.allSettled([store.update({revision:'initial',providers:{one:p}}),store.update({revision:'initial',providers:{two:p}})]); assert.equal(results.filter(r=>r.status==='fulfilled').length,1); assert.equal(results.find(r=>r.status==='rejected').reason.status,409); assert.equal(Object.keys((await store.read()).providers).length,1); } finally { await rm(root,{recursive:true,force:true}); }
});
