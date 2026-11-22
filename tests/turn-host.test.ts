import test from 'node:test';import assert from 'node:assert/strict';import {TurnHost} from '../src/turn-host';
class FakeWorker {onmessage?:({data}:{data:any})=>void;onerror?:()=>void;messages:any[]=[];terminated=false;postMessage(m:any){this.messages.push(m);}terminate(){this.terminated=true;}emit(data:any){this.onmessage?.({data});}}
const payload=()=>({samples:btoa('\0'.repeat(64000)),offsetMs:0,ended:false});
test('speaker worker isolates cancelled documents and bounds queued audio',async()=>{
 const worker=new FakeWorker(),host=new TurnHost(()=>worker as unknown as Worker);
 const a=host.request('turn-analyze',payload(),'a'),b=host.request('turn-analyze',payload(),'b');
 await assert.rejects(host.request('turn-analyze',payload(),'a'),/过多/);
 const cancelled=assert.rejects(a,{name:'AbortError'});await host.request('turn-release',{},'a');await cancelled;
 worker.emit({id:worker.messages[0].id,result:{old:true}});
 worker.emit({id:worker.messages[1].id,result:{frames:[],decision:undefined}});
 assert.deepEqual(await b,{frames:[],decision:undefined});host.dispose();assert.equal(worker.terminated,true);
});
test('speaker worker errors reject waiting work and invalid audio never enters the worker',async()=>{
 const worker=new FakeWorker(),host=new TurnHost(()=>worker as unknown as Worker);
 await assert.rejects(host.request('turn-analyze',{...payload(),samples:'AA=='},'a'));assert.equal(worker.messages.length,0);
 const job=host.request('turn-analyze',payload(),'a'),error=assert.rejects(job,/线程/);worker.onerror?.();await error;host.dispose();
});
