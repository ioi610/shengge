import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('shipped native engine matches source provenance and excludes experimental QA entry points',async()=>{
 const root=new URL('../',import.meta.url);
 const info=JSON.parse(await readFile(new URL('assets/recognition/build-info.json',root),'utf8'));
 for(const [file,expected] of Object.entries(info.hashes)){
  const bytes=await readFile(new URL(file,root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),expected,file+' needs a matching native rebuild');
 }
 const wasm=await readFile(new URL('assets/recognition/shengge-asr.wasm',root));
 assert.equal(wasm.includes(Buffer.from('transcribeQa')),false,'QA decoder modes must not ship');
 assert.equal(wasm.includes(Buffer.from('sg_qa_')),false,'QA instrumentation must not ship');
});
