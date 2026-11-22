import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {verifiedModel} from '../src/recognition-model';
import {decodeRecognitionWav} from '../src/recognition-audio';
import {RecognitionHost} from '../src/recognition-host';

function mockCaches(t:import('node:test').TestContext,value:CacheStorage){const prior=Object.getOwnPropertyDescriptor(globalThis,'caches');Object.defineProperty(globalThis,'caches',{value,configurable:true});t.after(()=>{if(prior)Object.defineProperty(globalThis,'caches',prior);else Reflect.deleteProperty(globalThis,'caches');});}

test('browser model validates downloads, reuses cache offline, and replaces corruption',async t=>{
 const bytes=new Uint8Array([1,2,3,4]);const spec={url:'https://example.test/model',bytes:4,sha256:createHash('sha256').update(bytes).digest('hex'),cache:'test'};
 let saved:Response|undefined,downloads=0;const cache={match:async()=>saved?.clone(),delete:async()=>{saved=undefined;return true;},put:async(_key:string,r:Response)=>{saved=r;}};
 t.mock.method(globalThis,'fetch',async()=>{downloads++;return new Response(bytes);});
 mockCaches(t,{open:async()=>cache} as unknown as CacheStorage);
 const signal=new AbortController().signal,stages:string[]=[];
 assert.deepEqual(new Uint8Array(await verifiedModel(p=>stages.push(p.stage),signal,spec)),bytes);assert.equal(downloads,1);assert.ok(stages.includes('verifying'));
 await verifiedModel(()=>{},signal,spec);assert.equal(downloads,1,'second use works without download');
 saved=new Response(new Uint8Array([4,3,2,1]));await verifiedModel(()=>{},signal,spec);assert.equal(downloads,2,'same-size corruption redownloaded');
});
test('partial or altered model never enters cache; explicit retry succeeds',async t=>{
 const bytes=new Uint8Array([1,2,3,4]);const spec={url:'https://example.test/model',bytes:4,sha256:createHash('sha256').update(bytes).digest('hex'),cache:'test'};let writes=0,body=new Uint8Array([1,2]);
 mockCaches(t,{open:async()=>({match:async()=>undefined,put:async()=>{writes++;}})} as unknown as CacheStorage);
 t.mock.method(globalThis,'fetch',async()=>new Response(body));
 await assert.rejects(verifiedModel(()=>{},new AbortController().signal,spec),/不完整/);body=new Uint8Array([4,3,2,1]);
 await assert.rejects(verifiedModel(()=>{},new AbortController().signal,spec),/校验失败/);assert.equal(writes,0);
 body=bytes;await verifiedModel(()=>{},new AbortController().signal,spec);assert.equal(writes,1);
});
test('aborted preparation does not fetch',async t=>{let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response();});const c=new AbortController();c.abort();await assert.rejects(verifiedModel(()=>{},c.signal),{name:'AbortError'});assert.equal(calls,0);});
test('PCM decoding preserves full beginning and rejects inconsistent duration or format',async()=>{
 const wav=new Uint8Array(await readFile('tests/fixtures/recognition.wav'));const duration=Math.round((wav.length-44)/32);const pcm=decodeRecognitionWav(wav,duration);assert.equal(pcm.length,(wav.length-44)/2);const view=new DataView(wav.buffer,wav.byteOffset,wav.byteLength);for(let i=0;i<pcm.length;i++)assert.equal(pcm[i],view.getInt16(44+i*2,true)/32768);
 assert.throws(()=>decodeRecognitionWav(wav,duration-200),/不匹配/);const bad=wav.slice();new DataView(bad.buffer).setUint32(24,48000,true);assert.throws(()=>decodeRecognitionWav(bad,duration),/不匹配/);
});
class FakeWorker {onmessage?:({data}:{data:any})=>void;onerror?:()=>void;messages:any[]=[];terminated=false;postMessage(data:any){this.messages.push(data);}terminate(){this.terminated=true;}emit(data:any){this.onmessage?.({data});}}
test('offscreen jobs isolate tabs, cancel through shared memory and ignore stale results',()=>{
 const worker=new FakeWorker(),host=new RecognitionHost(()=>worker as unknown as Worker);const flags=new Int32Array(new SharedArrayBuffer(4));
 try{
  assert.equal((host.request('prepare',{},'tab1') as any).state,'loading');host.request('prepare',{},'tab2');assert.equal(worker.messages.length,1);
  worker.emit({type:'memory',buffer:flags.buffer,pointer:0});worker.emit({type:'ready'});
  const payload={audio:btoa('audio'),durationMs:2000,language:'ja'};const a=host.request('submit',payload,'tab1') as {id:string};assert.equal(worker.messages.at(-1).type,'run');
  assert.throws(()=>host.request('status',{id:a.id},'tab2'));assert.throws(()=>host.request('cancel',{id:a.id},'tab2'));assert.equal(flags[0],0);
  assert.throws(()=>host.request('submit',payload,'tab2'),/另一个视频/);
  host.request('cancel',{id:a.id},'tab1');assert.equal(flags[0],1);
  const b=host.request('submit',payload,'tab1') as {id:string};assert.equal(worker.messages.at(-1).id,a.id,'cancelled inference must finish before next starts');
  worker.emit({type:'result',id:a.id,result:{segments:['stale']}});assert.equal(worker.messages.at(-1).id,b.id);assert.equal(flags[0],0);assert.throws(()=>host.request('status',{id:a.id},'tab1'));
  worker.emit({type:'result',id:b.id,result:{segments:['fresh']}});assert.deepEqual((host.request('status',{id:b.id},'tab1') as any).result,{segments:['fresh']});
 }finally{host.dispose();assert.equal(worker.terminated,true);}
});
test('failed worker exposes actionable error and retries with a fresh worker',()=>{
 const workers:FakeWorker[]=[];const host=new RecognitionHost(()=>{const w=new FakeWorker();workers.push(w);return w as unknown as Worker;});
 try{host.request('prepare',{},'tab');workers[0].emit({type:'error',error:'下载失败'});assert.equal((host.request('health',{},'tab') as any).error,'下载失败');host.request('prepare',{},'tab');assert.equal(workers.length,2);workers[0].emit({type:'error',error:'late error'});workers[0].emit({type:'ready'});assert.equal((host.request('health',{},'tab') as any).state,'loading');assert.equal(workers[0].terminated,true);assert.equal((host.request('health',{},'tab') as any).error,undefined);}finally{host.dispose();}
});

test('music result does not silently retry with another language',()=>{
 const worker=new FakeWorker(),host=new RecognitionHost(()=>worker as unknown as Worker);
 try{host.request('prepare',{},'tab');worker.emit({type:'memory',buffer:new SharedArrayBuffer(4),pointer:0});worker.emit({type:'ready'});const {id}=host.request('submit',{audio:btoa('audio'),durationMs:2000,language:'japanese'},'tab') as {id:string};assert.equal(worker.messages.at(-1).language,'japanese');worker.emit({type:'result',id,result:{language:'auto',segments:[]}});assert.equal(worker.messages.filter(m=>m.type==='run').length,1);assert.deepEqual((host.request('status',{id},'tab') as any).result.segments,[]);}finally{host.dispose();}
});

import {prepareRecognition,preparationMessage} from '../src/recognition-ready';
test('cached ready model does not poll or show a download',async()=>{
 const calls:string[]=[];await prepareRecognition(async action=>{calls.push(action);return {streaming:true,state:'ready'};},new AbortController().signal,()=>assert.fail('cached ready model must start directly'));assert.deepEqual(calls,['prepare']);
});
test('preparation failure and pause remain actionable',async()=>{
 await assert.rejects(prepareRecognition(async()=>({state:'error',error:'下载失败'}),new AbortController().signal,()=>{}),/下载失败/);
 const c=new AbortController();await assert.rejects(prepareRecognition(async()=>({state:'loading'}),c.signal,()=>c.abort()),{name:'AbortError'});
 assert.match(preparationMessage({stage:'downloading',loaded:50,total:100}),/50%/);
});

test('cancelled stuck GPU worker is replaced and queued retry survives',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const workers:FakeWorker[]=[];const host=new RecognitionHost(()=>{const w=new FakeWorker();workers.push(w);return w as unknown as Worker;});
 const ready=(w:FakeWorker)=>{w.emit({type:'memory',buffer:new SharedArrayBuffer(4),pointer:0});w.emit({type:'ready'});};
 try{
  host.request('prepare',{},'tab');ready(workers[0]);
  const payload={audio:btoa('audio'),durationMs:2000};const a=host.request('submit',payload,'tab') as {id:string};
  host.request('cancel',a,'tab');const b=host.request('submit',payload,'tab') as {id:string};
  t.mock.timers.tick(3000);assert.equal(workers[0].terminated,true);assert.equal(workers.length,2);
  workers[0].emit({type:'result',id:a.id,result:{stale:true}});assert.equal((host.request('health',{},'tab') as any).state,'loading');
  ready(workers[1]);assert.equal(workers[1].messages.at(-1).id,b.id);
  workers[1].emit({type:'result',id:b.id,result:{fresh:true}});assert.deepEqual((host.request('status',b,'tab') as any).result,{fresh:true});
 }finally{host.dispose();}
});

test('normal cooperative cancellation does not kill the following healthy job',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const worker=new FakeWorker(),host=new RecognitionHost(()=>worker as unknown as Worker);
 try{
  host.request('prepare',{},'tab');worker.emit({type:'memory',buffer:new SharedArrayBuffer(4),pointer:0});worker.emit({type:'ready'});
  const p={audio:btoa('audio'),durationMs:2000};const a=host.request('submit',p,'tab') as {id:string};host.request('cancel',a,'tab');
  const b=host.request('submit',p,'tab') as {id:string};worker.emit({type:'result',id:a.id});t.mock.timers.tick(4000);
  assert.equal(worker.terminated,false);assert.equal(worker.messages.at(-1).id,b.id);
 }finally{host.dispose();}
});
test('refresh retires the same tabs abandoned inference without taking over a different tab',()=>{
 const worker=new FakeWorker(),host=new RecognitionHost(()=>worker as unknown as Worker),flags=new Int32Array(new SharedArrayBuffer(4));
 try{host.request('prepare',{},'12:old-document');worker.emit({type:'memory',buffer:flags.buffer,pointer:0});worker.emit({type:'ready'});
 const p={audio:btoa('audio'),durationMs:2000};const a=host.request('submit',p,'12:old-document') as {id:string};
 host.request('prepare',{},'13:other-document');assert.equal(flags[0],0);assert.throws(()=>host.request('submit',p,'13:other-document'));
 host.request('prepare',{},'12:new-document');assert.equal(flags[0],1);assert.throws(()=>host.request('status',a,'12:old-document'));
 const b=host.request('submit',p,'12:new-document') as {id:string};worker.emit({type:'result',id:a.id});assert.equal(worker.messages.at(-1).id,b.id);
 }finally{host.dispose();}
});
