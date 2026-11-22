import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';
import {createClip,uid,videoPracticeComplete} from '../src/domain';import {Repository,Root,fresh,execute,Request,Authority} from '../src/storage';
const videoKey='youtube:abcdefghijk';const auth:Authority={binding:'tab:1',controller:true,videoKey};
function setup(){const root=fresh();const c=createClip({videoKey,url:'https://www.youtube.com/watch?v=abcdefghijk',title:'sample',durationMs:30000,segments:[{id:'a',revision:1,startMs:0,endMs:2000,source:'manual'},{id:'b',revision:1,startMs:3000,endMs:5000,source:'manual'}]});root.clips[c.id]=c;return {root,c};}
function req(root:Root,type:string,payload:any={},clipId?:string,revision?:number):Request{return {protocolVersion:1,requestId:uid(),type,dataEpoch:root.dataEpoch,clipId,expectedRevision:revision,payload};}
function owner(root:Root,id:string,a=auth){return execute(root,req(root,'ACQUIRE_SESSION',{},id),a);}
function commit(root:Root,id:string,o:any,attemptId='attempt-1',revision=root.clips[id].revision){return req(root,'COMMIT_COMPLETION',{...o,attemptId,segmentId:'a',segmentRevision:1},id,revision);}
test('delayed renewal preserves exact ownership but cannot revive release, takeover or cleared data',()=>{
 const {root,c}=setup(),o=owner(root,c.id),later=Date.now()+2*86400000;
 const renewed=execute(root,req(root,'RENEW_SESSION',o,c.id),auth,later);
 assert.equal(renewed.ownerId,o.ownerId);assert.equal(renewed.generation,o.generation);assert.equal(renewed.expiresAt,later+15000);
 execute(root,req(root,'RELEASE_SESSION',o,c.id),auth,later);
 assert.throws(()=>execute(root,req(root,'RENEW_SESSION',o,c.id),auth,later+1),{code:'STALE_BINDING'});
 const next=execute(root,req(root,'ACQUIRE_SESSION',{},c.id),auth,later+1);
 assert.throws(()=>execute(root,req(root,'RENEW_SESSION',o,c.id),auth,later+2),{code:'STALE_BINDING'});
 const other={...auth,binding:'tab:2'};
 execute(root,req(root,'ACQUIRE_SESSION',{takeover:true},c.id),other,later+2);
 assert.throws(()=>execute(root,req(root,'RENEW_SESSION',next,c.id),auth,later+3),{code:'STALE_BINDING'});
 const stale=req(root,'RENEW_SESSION',next,c.id);execute(root,req(root,'CLEAR_DATA',{confirm:true}),auth,later+3);
 assert.throws(()=>execute(root,stale,auth,later+4),{code:'STALE_EPOCH'});
});
test('A04 / A05 commits exactly 20 unique attempts and deduplicates retries',()=>{const {root,c}=setup(),o=owner(root,c.id);for(let i=0;i<20;i++){const m=commit(root,c.id,o,`attempt-${i}`);const a=execute(root,m,auth);assert.equal(a.progress.a.count,i+1);assert.equal(execute(root,m,auth).progress.a.count,i+1);}assert.equal(root.clips[c.id].progress.a.count,20);assert.throws(()=>execute(root,commit(root,c.id,o,'attempt-21'),auth));});
test('same attempt on another request uses receipt before revision conflict',()=>{const {root,c}=setup(),o=owner(root,c.id),m=commit(root,c.id,o);execute(root,m,auth);const next={...m,requestId:uid()};assert.equal(execute(root,next,auth).progress.a.count,1);assert.equal(root.clips[c.id].progress.a.count,1);assert.throws(()=>execute(root,{...m,payload:{...m.payload,attemptId:'changed'}},auth));});
test('checkpoint cannot set count; wrong revision and expired lease reject',()=>{const {root,c}=setup(),o=owner(root,c.id);execute(root,req(root,'SAVE_CHECKPOINT',{...o,completedCount:99},c.id,c.revision),auth);assert.equal(root.clips[c.id].progress.a.count,0);assert.throws(()=>execute(root,commit(root,c.id,o,'stale',0),auth));assert.throws(()=>execute(root,commit(root,c.id,o),auth,Date.now()+20000));});
test('A09 two tabs require explicit takeover; old generation cannot commit',()=>{const {root,c}=setup(),o=owner(root,c.id);const other={...auth,binding:'tab:2'};assert.throws(()=>owner(root,c.id,other));const newer=execute(root,req(root,'ACQUIRE_SESSION',{takeover:true},c.id),other);assert.ok(newer.generation>o.generation);assert.throws(()=>execute(root,commit(root,c.id,o),auth));});
test('A07 cannot rate can before reveal and skip does not enter denominator',()=>{const {root,c}=setup(),o=owner(root,c.id);execute(root,req(root,'START_QUESTIONS',o,c.id,c.revision),auth);const q=c.questions[0];assert.throws(()=>execute(root,req(root,'RATE_ANSWER',{...o,questionId:q.id,rating:'can'},c.id,c.revision),auth));execute(root,req(root,'REVEAL_ANSWER',{...o,questionId:q.id},c.id,c.revision),auth);execute(root,req(root,'RATE_ANSWER',{...o,questionId:q.id,rating:'can'},c.id,c.revision),auth);assert.equal(c.questions[0].rating,'can');});
test('A10 delete and clear cannot resurrect records via delayed callbacks',()=>{const {root,c}=setup(),o=owner(root,c.id),m=commit(root,c.id,o);execute(root,req(root,'DELETE_RECORD',{},c.id),auth);assert.throws(()=>execute(root,m,auth));assert.equal(Object.keys(root.clips).length,0);execute(root,req(root,'CLEAR_DATA',{confirm:true}),auth);assert.throws(()=>execute(root,m,auth));assert.equal(root.dataEpoch,2);});
test('A11 edit only resets affected segment and invalidates questions',()=>{const {root,c}=setup(),o=owner(root,c.id);execute(root,commit(root,c.id,o),auth);c.progress.b.count=7;c.questions=[{id:'q',cueId:'a',targetId:'b',revealed:true,rating:'stuck'}];execute(root,req(root,'SAVE_CLIP',{...o,videoKey,url:c.url,title:c.title,name:c.name,durationMs:c.durationMs,segments:c.segments.map(s=>({...s,endMs:s.id==='a'?1900:s.endMs}))},c.id,c.revision),auth);assert.equal(c.progress.a.count,0);assert.equal(c.progress.b.count,7);assert.equal(c.questions.length,0);});
test('A13 cursor with identical updatedAt yields 1000 unique rows with independent filters',()=>{const {root,c}=setup();for(let i=0;i<1000;i++){const id=`clip-${String(i).padStart(4,'0')}`;root.clips[id]={...structuredClone(c),id};}delete root.clips[c.id];let cursor,ids:string[]=[];for(let i=0;i<20;i++){const result=execute(root,req(root,'LIST_RECORDS',{cursor}),{binding:'web',controller:false});ids.push(...result.clips.map((x:any)=>x.id));cursor=result.nextCursor;}assert.equal(new Set(ids).size,1000);});
test('protocol and controller origin checks reject write access for web-only client',()=>{const {root,c}=setup();assert.throws(()=>execute(root,req(root,'ACQUIRE_SESSION',{},c.id),{binding:'web',controller:false}));assert.throws(()=>execute(root,{...req(root,'HELLO'),protocolVersion:2}as any,auth));});
test('IndexedDB survives close/reopen and concurrent same-attempt transactions count once',async()=>{const name='test-'+uid();let repo=new Repository(name);const hello=await repo.request({protocolVersion:1,requestId:uid(),type:'HELLO',payload:{}},auth);assert.equal(hello.ok,true);const m:Request={protocolVersion:1,requestId:uid(),type:'SAVE_CLIP',dataEpoch:1,payload:{videoKey,url:'https://www.youtube.com/watch?v=abcdefghijk',title:'test',name:'persisted',durationMs:10000,segments:[{id:'a',revision:1,startMs:0,endMs:2000,source:'manual'}]}};const saved=await repo.request(m,auth);assert.ok(saved.ok);const c=(saved as any).data;const acquired=await repo.request({...m,requestId:uid(),type:'ACQUIRE_SESSION',clipId:c.id,payload:{}},auth);const o=(acquired as any).data;const event={...m,type:'COMMIT_COMPLETION',requestId:uid(),clipId:c.id,expectedRevision:1,payload:{...o,attemptId:'one',segmentId:'a',segmentRevision:1}};const replies=await Promise.all([repo.request(event,auth),repo.request({...event,requestId:uid()},auth)]);for(const r of replies){assert.ok(r.ok);assert.equal((r as any).data.progress.a.count,1);}await repo.close();repo=new Repository(name);const read=await repo.request({...m,type:'GET_RECORD',requestId:uid(),clipId:c.id,payload:{}},auth);assert.ok(read.ok);assert.equal((read as any).data.progress.a.count,1);await repo.close();});
test('v1 migration preserves counts and rejects old epoch after clear across reopen',async()=>{const name='migration-'+uid();const {root,c}=setup();c.progress.a.count=6;root.dataEpoch=4;await new Promise<void>((resolve,reject)=>{const q=indexedDB.open(name,1);q.onupgradeneeded=()=>q.result.createObjectStore('state').put(root,'root');q.onsuccess=()=>{q.result.close();resolve();};q.onerror=()=>reject(q.error);});let repo=new Repository(name);const read=req(root,'GET_RECORD',{},c.id);let response=await repo.request(read,auth);assert.ok(response.ok);assert.equal((response as any).data.progress.a.count,6);const clear=await repo.request(req(root,'CLEAR_DATA',{confirm:true}),auth);assert.ok(clear.ok);await repo.close();repo=new Repository(name);response=await repo.request(read,auth);assert.deepEqual(response,{ok:false,error:'STALE_EPOCH'});await repo.close();});
test('indexed deletion retires creation receipt so delayed create cannot resurrect a record',async()=>{const name='cascade-'+uid(),repo=new Repository(name);const {root,c}=setup();const create=req(root,'SAVE_CLIP',{videoKey,url:c.url,title:c.title,name:c.name,durationMs:c.durationMs,segments:c.segments});const saved=await repo.request(create,auth);assert.ok(saved.ok);const id=(saved as any).data.id;assert.ok((await repo.request(req(root,'DELETE_RECORD',{},id),auth)).ok);await repo.close();const db=await new Promise<IDBDatabase>(r=>{const q=indexedDB.open(name,3);q.onsuccess=()=>r(q.result);});const receipt=await new Promise<any>(r=>{const q=db.transaction('receipts').objectStore('receipts').get(create.requestId);q.onsuccess=()=>r(q.result);});assert.equal(receipt.retired,true);assert.equal(receipt.response,null);assert.equal(receipt.fingerprint,'');db.close();const reopened=new Repository(name);assert.deepEqual(await reopened.request(create,auth),{ok:false,error:'STALE_EPOCH'});const rows=await reopened.request(req(root,'LIST_RECORDS'),auth);assert.ok(rows.ok);assert.equal(rows.data.total,0);await reopened.close();});
test('changing subtitles or gap does not remove additional practice target',()=>{const {root,c}=setup(),o=owner(root,c.id);execute(root,req(root,'UPDATE_PROGRESS',{...o,segmentId:'a',action:'extra'},c.id,c.revision),auth);assert.equal(c.progress.a.target,25);execute(root,req(root,'SAVE_CHECKPOINT',{...o,settings:{...c.settings,showJapanese:false}},c.id,c.revision),auth);assert.equal(c.progress.a.target,25);});
test('restart archives old assessment and counts, creates a fresh practice round',()=>{const {root,c}=setup(),o=owner(root,c.id);execute(root,commit(root,c.id,o),auth);execute(root,req(root,'RESTART_SESSION',o,c.id,c.revision),auth);assert.equal(c.progress.a.count,0);assert.equal(c.history![0].progress.a.count,1);assert.equal(c.mode,'listen');});
test('diagnostics bounded at 500 and renewal does not accumulate permanent receipts',async()=>{const repo=new Repository('logs-'+uid());const {root,c}=setup();let r=await repo.request(req(root,'SAVE_CLIP',{videoKey,url:c.url,title:c.title,name:c.name,durationMs:c.durationMs,segments:c.segments}),auth);assert.ok(r.ok);const id=(r as any).data.id;r=await repo.request(req(root,'ACQUIRE_SESSION',{},id),auth);assert.ok(r.ok);const o=(r as any).data;for(let i=0;i<505;i++)assert.ok((await repo.request(req(root,'RENEW_SESSION',o,id),auth)).ok);const logs=await repo.request(req(root,'GET_DIAGNOSTICS'),auth);assert.ok(logs.ok);assert.equal((logs as any).data.length,500);assert.ok((logs as any).data.every((row:any)=>!JSON.stringify(row).includes(videoKey)));await repo.close();});

test('A11 editing text preserves unaffected assessments and current segment identity',()=>{
 const {root,c}=setup(),o=owner(root,c.id);c.segments.push({id:'c',revision:1,startMs:6000,endMs:8000,source:'manual'});c.progress.c={count:8,target:20};c.current=2;c.questions=[{id:'ab',cueId:'a',targetId:'b',revealed:true,rating:'can'},{id:'bc',cueId:'b',targetId:'c',revealed:true,rating:'stuck'}];c.progress.a.count=5;
 execute(root,req(root,'SAVE_CLIP',{...o,videoKey,url:c.url,title:c.title,name:c.name,durationMs:c.durationMs,segments:c.segments.map(s=>s.id==='a'?{...s,text:'changed'}:{...s})},c.id,c.revision),auth);
 assert.equal(c.progress.a.count,0);assert.equal(c.segments[0].revision,2);assert.equal(c.progress.c.count,8);assert.deepEqual(c.questions.map(q=>q.id),['bc']);
 execute(root,req(root,'START_QUESTIONS',{...o,preserve:true},c.id,c.revision),auth);assert.equal(c.questions.length,2);assert.equal(c.questions[1].rating,'stuck');
 execute(root,req(root,'SAVE_CLIP',{...o,videoKey,url:c.url,title:c.title,name:c.name,durationMs:c.durationMs,segments:c.segments.slice(1)},c.id,c.revision),auth);assert.equal(c.segments[c.current].id,'c');
});
async function seedV2(name:string,clips:any[]){
 const initial=new Repository(name);await initial.request({protocolVersion:1,requestId:uid(),type:'HELLO',payload:{}},auth);await initial.close();
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open(name);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['clips','recordIndex'],'readwrite');for(const c of clips){tx.objectStore('clips').put(c,c.id);const buckets=['all',c.progress.a.reason&&c.progress.b.reason?'done':'active',...(c.questions.some((q:any)=>q.rating==='stuck')?['hard']:[])];tx.objectStore('recordIndex').put({id:c.id,keys:buckets.flatMap(b=>[[b,c.updatedAt,c.id],[`video:${c.videoKey}:${b}`,c.updatedAt,c.id]])});}tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();
}
test('A13 real repository pages 1000 equal-time records without full aggregate scans',async()=>{
 const {root,c}=setup();const clips=Array.from({length:1000},(_,i)=>{const x=structuredClone(c);x.id=`row-${String(i).padStart(4,'0')}`;if(i%2===0)for(const p of Object.values(x.progress))p.reason='early';if(i%3===0)x.questions=[{id:'q',cueId:'a',targetId:'b',revealed:true,rating:'stuck'}];return x;});const name='paged-'+uid();await seedV2(name,clips);const repo=new Repository(name);
 const all=IDBObjectStore.prototype.getAll;const get=IDBObjectStore.prototype.get;let aggregateReads=0;
 IDBObjectStore.prototype.getAll=function(...args:any[]){assert.notEqual(this.name,'clips','must not read all clip bodies');return all.apply(this,args as any);};
 IDBObjectStore.prototype.get=function(key:any){if(this.name==='clips')aggregateReads++;return get.call(this,key);};
 try{let cursor;const ids=new Set();for(let page=0;page<20;page++){const before=aggregateReads;const r=await repo.request(req(root,'LIST_RECORDS',{cursor,limit:50}),auth);assert.ok(r.ok);assert.equal(r.data.total,1000);assert.equal(aggregateReads-before,50);for(const row of r.data.clips)ids.add(row.id);cursor=r.data.nextCursor;assert.equal(r.data.hasMore,page<19);}assert.equal(ids.size,1000);
 for(const [filter,total] of [['done',500],['active',500],['hard',334]] as const){const r=await repo.request(req(root,'LIST_RECORDS',{filter,videoKey,limit:10}),auth);assert.ok(r.ok);assert.equal(r.data.total,total);assert.equal(r.data.clips.length,10);}
 const first=await repo.request(req(root,'LIST_RECORDS',{limit:1}),auth);assert.ok(first.ok);await repo.request(req(root,'DELETE_RECORD',{},first.data.clips[0].id),auth);const after=await repo.request(req(root,'LIST_RECORDS'),auth);assert.ok(after.ok);assert.equal(after.data.total,999);assert.notEqual(after.data.clips[0].id,first.data.clips[0].id);
 }finally{IDBObjectStore.prototype.getAll=all;IDBObjectStore.prototype.get=get;await repo.close();}
});
test('v2 to v3 upgrade creates listing index and keeps original clip and receipts',async()=>{
 const name='v2-'+uid(),{root,c}=setup();await new Promise<void>((resolve,reject)=>{const q=indexedDB.open(name,2);q.onupgradeneeded=()=>{const db=q.result;db.createObjectStore('state').put({...fresh(),dataEpoch:7},'root');const clips=db.createObjectStore('clips');clips.createIndex('videoKey','videoKey');clips.createIndex('updatedAt','updatedAt');clips.put(c,c.id);for(const store of ['receipts','attempts'])db.createObjectStore(store).createIndex('clipId','clipId');db.createObjectStore('owners');db.createObjectStore('diagnostics',{keyPath:'id',autoIncrement:true}).createIndex('at','at');};q.onsuccess=()=>{q.result.close();resolve();};q.onerror=()=>reject(q.error);});const repo=new Repository(name);root.dataEpoch=7;try{const list=await repo.request(req(root,'LIST_RECORDS'),auth);assert.ok(list.ok);assert.equal(list.data.total,1);assert.deepEqual(list.data.clips[0],c);}finally{await repo.close();}
});
test('A14 quota failure aborts clip, receipt, attempt and list index atomically; retry commits once',async()=>{
 const name='quota-'+uid(),repo=new Repository(name);const {root,c}=setup();const created=await repo.request(req(root,'SAVE_CLIP',{...c}),auth);assert.ok(created.ok);const clip=created.data;const acquired=await repo.request(req(root,'ACQUIRE_SESSION',{},clip.id),auth);assert.ok(acquired.ok);const m=req(root,'COMMIT_COMPLETION',{...acquired.data,attemptId:'quota',segmentId:'a',segmentRevision:1},clip.id,clip.revision);const put=IDBObjectStore.prototype.put;
 try{IDBObjectStore.prototype.put=function(...args:any[]){if(this.name==='attempts')throw new DOMException('test quota','QuotaExceededError');return put.apply(this,args as any);};assert.deepEqual(await repo.request(m,auth),{ok:false,error:'QUOTA_EXCEEDED'});}finally{IDBObjectStore.prototype.put=put;}
 try{const read=await repo.request(req(root,'GET_RECORD',{},clip.id),auth);assert.ok(read.ok);assert.equal(read.data.progress.a.count,0);const retry=await repo.request(m,auth);assert.ok(retry.ok);assert.equal(retry.data.progress.a.count,1);const duplicate=await repo.request(m,auth);assert.ok(duplicate.ok);assert.equal(duplicate.data.progress.a.count,1);}finally{await repo.close();}
});

test('difficult restart selects only stuck targets; duplicate delivery never clears new progress',()=>{
 const {root,c}=setup(),o=owner(root,c.id);c.progress.a.count=8;c.progress.b={count:12,target:25,reason:'early'};c.questions=[{id:'q',cueId:'a',targetId:'b',revealed:true,rating:'stuck'}];const m=req(root,'RESTART_DIFFICULT',o,c.id,c.revision);const saved=execute(root,m,auth);assert.equal(saved.progress.a.count,8);assert.deepEqual(saved.progress.b,{count:0,target:25,skipped:false});assert.deepEqual(saved.practiceIds,['b']);assert.equal(saved.current,1);assert.equal(saved.mode,'listen');assert.equal(saved.questions[0].rating,'stuck');c.progress.b.count=1;execute(root,m,auth);assert.equal(c.progress.b.count,1);
});
test('difficult restart without targets or without controller authority changes nothing',()=>{
 const {root,c}=setup(),o=owner(root,c.id),before=structuredClone(c);const m=req(root,'RESTART_DIFFICULT',o,c.id,c.revision);assert.throws(()=>execute(root,m,auth));assert.deepEqual(c,before);assert.throws(()=>execute(root,m,{...auth,controller:false}));assert.deepEqual(c,before);
});
test('difficult restart quota failure rolls back every target, cursor and receipt together',async()=>{
 const {root,c}=setup();c.segments.push({id:'c',revision:1,startMs:6000,endMs:8000,source:'manual'});c.progress.a.count=8;c.progress.b.count=6;c.progress.c={count:4,target:25};c.questions=[{id:'ab',cueId:'a',targetId:'b',revealed:true,rating:'stuck'},{id:'bc',cueId:'b',targetId:'c',revealed:true,rating:'stuck'}];const name='difficult-quota-'+uid();await seedV2(name,[c]);const repo=new Repository(name);try{const acquired=await repo.request(req(root,'ACQUIRE_SESSION',{},c.id),auth);assert.ok(acquired.ok);const m=req(root,'RESTART_DIFFICULT',acquired.data,c.id,c.revision),put=IDBObjectStore.prototype.put;
 try{IDBObjectStore.prototype.put=function(...args:any[]){if(this.name==='recordIndex')throw new DOMException('QA quota','QuotaExceededError');return put.apply(this,args as any);};assert.deepEqual(await repo.request(m,auth),{ok:false,error:'QUOTA_EXCEEDED'});}finally{IDBObjectStore.prototype.put=put;}
 const before=await repo.request(req(root,'GET_RECORD',{},c.id),auth);assert.ok(before.ok);assert.deepEqual(before.data,c);const retried=await repo.request(m,auth);assert.ok(retried.ok);assert.equal(retried.data.progress.a.count,8);assert.equal(retried.data.progress.b.count,0);assert.equal(retried.data.progress.c.count,0);assert.deepEqual(retried.data.practiceIds,['b','c']);const duplicate=await repo.request(m,auth);assert.deepEqual(duplicate,retried);
 }finally{await repo.close();}
});

test('onset-only calibration preserves progress, records the old boundary and rejects stale playback',()=>{
 const {root,c}=setup();c.segments[0].source='turn';c.progress.a.count=5;const o=owner(root,c.id);
 const stale=commit(root,c.id,o,'in-flight');const r=execute(root,req(root,'REFINE_START',{...o,segmentId:'a',segmentRevision:1,startMs:800},c.id,c.revision),auth);
 assert.equal(r.segments[0].startMs,800);assert.equal(r.segments[0].endMs,2000);assert.equal(r.segments[0].previousStartMs,0);assert.equal(r.progress.a.count,5);assert.equal(r.segments[0].revision,2);
 assert.throws(()=>execute(root,stale,auth));
 for(const startMs of [-1,700,2000,NaN])assert.throws(()=>execute(root,req(root,'REFINE_START',{...o,segmentId:'a',segmentRevision:2,startMs},c.id,r.revision),auth));
 assert.throws(()=>execute(root,req(root,'REFINE_START',{...o,segmentId:'a',segmentRevision:2,startMs:900},c.id,r.revision),{...auth,controller:false}));
});

for(const onsetVersion of [2,3])test(`onset calibration v${onsetVersion} restores clipped words without crossing the previous sentence or erasing counts`,()=>{
 const {root,c}=setup();c.segments[1].source='turn';c.segments[1].onsetVerified=true;c.progress.b.count=5;const o=owner(root,c.id);
 assert.throws(()=>execute(root,req(root,'REFINE_START',{...o,segmentId:'b',segmentRevision:1,startMs:1900,onsetVersion},c.id,c.revision),auth));
 const r=execute(root,req(root,'REFINE_START',{...o,segmentId:'b',segmentRevision:1,startMs:2600,onsetVersion},c.id,c.revision),auth);
 assert.equal(r.segments[1].startMs,2600);assert.equal(r.segments[1].previousStartMs,3000);assert.equal(r.segments[1].onsetVersion,onsetVersion);assert.equal(r.progress.b.count,5);
});
test('Bilibili part records keep canonical restore URLs and cannot acquire another part',()=>{
 const root=fresh(),base='https://www.bilibili.com/video/BV1824y1c74J/';
 const save=(part:number)=>{const key=`bilibili:BV1824y1c74J:p${part}`,a={binding:'bili:'+part,controller:true,videoKey:key};const c=execute(root,req(root,'SAVE_CLIP',{videoKey:key,url:base+(part===1?'':`?p=${part}`),title:'B站分P',name:'练习',durationMs:10000,segments:[{id:'a',revision:1,startMs:0,endMs:2000,source:'asr',text:'こんにちは'}]}),a);return {a,c};};
 const first=save(1),second=save(2);assert.notEqual(first.c.id,second.c.id);assert.equal(second.c.url,base+'?p=2');
 assert.throws(()=>execute(root,req(root,'ACQUIRE_SESSION',{},second.c.id),first.a));
 const o=execute(root,req(root,'ACQUIRE_SESSION',{},second.c.id),second.a);
 const updated=execute(root,req(root,'COMMIT_COMPLETION',{...o,attemptId:'one',segmentId:'a',segmentRevision:1},second.c.id,second.c.revision),second.a);
 assert.equal(updated.progress.a.count,1);assert.equal(root.clips[first.c.id].progress.a.count,0);
 assert.throws(()=>execute(root,req(root,'SAVE_CLIP',{...second.c,url:base}),second.a));
});

test('desktop migration groups prior sessions by video and refreshes the same history entry',async()=>{
 const {root,c}=setup(),name='desktop-history-'+uid();
 const legacy=new Repository(name);
 async function call(repo:Repository,m:Request){
  const result=await repo.request(m,auth);assert.ok(result.ok,JSON.stringify(result));return result.data;
 }
 const make=()=>req(root,'SAVE_CLIP',{...c,name:'边播边练'});
 const first=await call(legacy,make()),second=await call(legacy,make());
 assert.equal((await call(legacy,req(root,'LIST_RECORDS'))).total,2);
 await legacy.close();
 const desktop=new Repository(name,false,false,true);
 const latest=await call(desktop,req(root,'LIST_RECORDS',{limit:1}));
 assert.equal(latest.total,1);assert.equal(latest.hasMore,false);
 const older=latest.clips[0].id===first.id?second:first;
 const owner=await call(desktop,req(root,'ACQUIRE_SESSION',{},older.id));
 await call(desktop,req(root,'SAVE_CHECKPOINT',{...owner,current:1},older.id,older.revision));
 const updated=await call(desktop,req(root,'LIST_RECORDS',{filter:'active'}));
 assert.equal(updated.total,1);assert.equal(updated.clips[0].id,older.id);assert.equal(updated.clips[0].current,1);
 await call(desktop,req(root,'DELETE_RECORD',{},older.id));
 assert.equal((await call(desktop,req(root,'LIST_RECORDS'))).total,0);
 assert.equal((await call(desktop,req(root,'LIST_RECORDS',{videoKey}))).total,0);
 await desktop.close();
});

test('finishing the known turns leaves a partially explored video in progress',()=>{
 const {c}=setup();
 for(const s of c.segments){s.source='turn';c.progress[s.id].reason='early';}
 assert.equal(videoPracticeComplete(c),false);
 c.sourceExhausted=true;assert.equal(videoPracticeComplete(c),true);
 delete c.sourceExhausted;c.segments.at(-1)!.endMs=c.durationMs;assert.equal(videoPracticeComplete(c),true);
});

test('desktop navigation resumes its tab lease and fences the replaced document',()=>{
 const {root,c}=setup(),first={...auth,binding:'8:0:first',activeTabFrame:'8:0:'};
 const o=owner(root,c.id,first);
 const other={...auth,binding:'9:0:other',activeTabFrame:'9:0:'};
 assert.throws(()=>owner(root,c.id,other),{code:'SESSION_OWNED'});
 const replacement={...first,binding:'8:0:replacement'};
 assert.ok(owner(root,c.id,replacement).generation>o.generation);
 assert.throws(()=>execute(root,req(root,'RENEW_SESSION',o,c.id),first),{code:'STALE_BINDING'});
});
