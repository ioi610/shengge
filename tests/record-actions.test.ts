import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {AppError,createClip,uid} from '../src/domain';
import {Client} from '../src/client';
import {execute,fresh,Repository,type Request} from '../src/storage';
import {collectRecordIds,deleteSelectedRecords} from '../src/record-actions';

function fixture(){
 const root=fresh();const base=createClip({videoKey:'youtube:abcdefghijk',url:'https://www.youtube.com/watch?v=abcdefghijk',title:'record',durationMs:5000,segments:[{id:'s',revision:1,startMs:0,endMs:2000,source:'manual'}]});
 for(let i=0;i<125;i++){const c=structuredClone(base);c.id=`record-${i.toString().padStart(3,'0')}`;if(i%2===0)c.progress.s.reason='early';root.clips[c.id]=c;}
 const client=new Client(async(request:Request)=>({ok:true,dataEpoch:root.dataEpoch,data:execute(root,request,{binding:'record-actions-test',controller:false})}));
 return {root,client};
}
test('select all includes unloaded pages and respects the active category',async()=>{
 const {root,client}=fixture();const signal=new AbortController().signal;
 const ids=await collectRecordIds(client,'all',signal);assert.equal(ids.length,125);assert.equal(new Set(ids).size,125);
 const done=await collectRecordIds(client,'done',signal);assert.equal(done.length,63);
 assert.ok(done.every(id=>root.clips[id].progress.s.reason==='early'));
 assert.equal(Object.keys(root.clips).length,125,'selecting does not delete records');
});
test('navigation aborts selection and a repeating cursor fails instead of looping',async()=>{
 const abort=new AbortController();let calls=0;
 const client={async call(){calls++;abort.abort();return {clips:[{id:'a'}],hasMore:true,nextCursor:{id:'a',time:'now'}};}};
 await assert.rejects(collectRecordIds(client,'all',abort.signal),{code:'OPERATION_CANCELLED'});assert.equal(calls,1);
 const repeated={async call(){return {clips:[{id:'a'}],hasMore:true,nextCursor:{id:'a',time:'now'}};}};
 await assert.rejects(collectRecordIds(repeated,'all',new AbortController().signal),{code:'INVALID_REQUEST'});
});
test('batch deletion affects only the confirmed snapshot and preserves unrelated progress',async()=>{
 const {root,client}=fixture();const keep=structuredClone(root.clips['record-003']);
 const ids=new Set(['record-000','record-001']);let calls=0;
 const wrapped={async call(type:string,payload?:Record<string,any>,id?:string){calls++;ids.add('record-002');return client.call(type,payload,id);}};
 const result=await deleteSelectedRecords(wrapped,ids);
 assert.deepEqual(result.deleted,['record-000','record-001']);assert.equal(calls,2);assert.equal(result.failed.length,0);
 assert.ok(root.clips['record-002']);assert.deepEqual(root.clips['record-003'],keep);assert.equal(root.dataEpoch,1);
});
test('a failed delete stops further writes and reports completed IDs accurately',async()=>{
 const calls:string[]=[];const client={async call(type:string,_payload?:Record<string,any>,id?:string){assert.equal(type,'DELETE_RECORD');calls.push(id!);if(id==='b')throw new AppError('DISCONNECTED');}};
 const result=await deleteSelectedRecords(client,['a','a','b','c']);
 assert.deepEqual(calls,['a','b']);assert.deepEqual(result.deleted,['a']);assert.equal(result.failed[0].id,'b');
});
test('batch deletion uses indexed cleanup, retires creation receipts and persists across reopen',async()=>{
 const name='batch-records-'+uid();const repository=new Repository(name);const videoKey='youtube:abcdefghijk';
 const authority={binding:'test',controller:true,videoKey};let epoch=1;
 const transport=async(m:Request)=>{const r=await repository.request(m,authority);if(r.ok)epoch=r.dataEpoch;return r;};
 const client=new Client(transport);const requests:Request[]=[];const ids:string[]=[];
 try{
  for(let i=0;i<3;i++){
   const m:Request={protocolVersion:1,requestId:uid(),type:'SAVE_CLIP',dataEpoch:epoch,payload:{videoKey,url:'https://www.youtube.com/watch?v=abcdefghijk',title:'test',name:'test',durationMs:5000,segments:[{id:'s',revision:1,startMs:0,endMs:2000,source:'manual'}]}};
   requests.push(m);const r=await transport(m);assert.ok(r.ok);ids.push(r.data.id);
  }
  await deleteSelectedRecords(client,[ids[0],ids[1]]);assert.deepEqual(await transport(requests[0]),{ok:false,error:'STALE_EPOCH'});
 }finally{await repository.close();}
 const reopened=new Repository(name);
 try{const r=await reopened.request({protocolVersion:1,requestId:uid(),type:'LIST_RECORDS',dataEpoch:epoch,payload:{}},authority);assert.ok(r.ok);assert.deepEqual(r.data.clips.map((c:any)=>c.id),[ids[2]]);}finally{await reopened.close();}
});
