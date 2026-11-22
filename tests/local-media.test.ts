import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {localMediaKey,isLocalMediaKey} from '../src/local-media';
import {Repository,fresh,execute,Request,Authority} from '../src/storage';
import {uid} from '../src/domain';

const key='local-file:'+'a'.repeat(64);
const authority:Authority={binding:'local-session',controller:true,videoKey:key};
const request=(type:string,payload:Record<string,unknown>={},extra:Partial<Request>={}):Request=>({protocolVersion:1,requestId:uid(),type,payload,dataEpoch:1,...extra});
const clip={videoKey:key,url:key,title:'actual-video.mp4',name:'边播边练',durationMs:20000,segments:[{id:'one',revision:1,startMs:2100,endMs:4100,source:'turn',text:'A complete sentence.'}]};

test('local file identity survives reselection and distinguishes changed content with identical metadata',async()=>{
 const file=(value:string)=>new File([value],'film.mp4',{lastModified:10});
 const a=await localMediaKey(file('audio A'));assert.ok(isLocalMediaKey(a));
 assert.equal(await localMediaKey(file('audio A')),a);
 assert.notEqual(await localMediaKey(file('audio B')),a);
 const start=new Uint8Array(1024*1024);const tailA=new Uint8Array(1024*1024),tailB=new Uint8Array(tailA);tailB[tailB.length-1]=1;
 assert.notEqual(await localMediaKey(new File([start,tailA],'long.mp4',{lastModified:10})),await localMediaKey(new File([start,tailB],'long.mp4',{lastModified:10})));
});

test('local video authority is explicit and cannot weaken formal YouTube source validation',()=>{
 assert.throws(()=>execute(fresh(),request('SAVE_CLIP',clip),authority));
 assert.throws(()=>execute(fresh(),request('SAVE_CLIP',clip),{...authority,controller:false},Date.now(),false,true));
 assert.throws(()=>execute(fresh(),request('SAVE_CLIP',clip),{...authority,videoKey:'local-file:'+'b'.repeat(64)},Date.now(),false,true));
 for(const url of ['blob:temporary','https://example.com/video.mp4'])assert.throws(()=>execute(fresh(),request('SAVE_CLIP',{...clip,url}),authority,Date.now(),false,true));
 const saved=execute(fresh(),request('SAVE_CLIP',clip),authority,Date.now(),false,true);
 assert.equal(saved.progress.one.target,20);assert.equal(saved.segments[0].source,'turn');
});

test('real video sentence boundaries and repetitions survive closing and reopening local storage',async()=>{
 const name='real-video-'+uid();let repository=new Repository(name,false,true);
 const saved=await repository.request(request('SAVE_CLIP',clip),authority);assert.ok(saved.ok);
 const id=saved.data.id;
 const acquired=await repository.request(request('ACQUIRE_SESSION',{}, {clipId:id}),authority);assert.ok(acquired.ok);
 const committed=await repository.request(request('COMMIT_COMPLETION',{...acquired.data,attemptId:uid(),segmentId:'one',segmentRevision:1},{clipId:id,expectedRevision:1}),authority);assert.ok(committed.ok);
 await repository.close();repository=new Repository(name,false,true);
 try{
  const restored=await repository.request(request('LIST_RECORDS',{videoKey:key}),{binding:'reader',controller:false});assert.ok(restored.ok);
  assert.equal(restored.data.total,1);assert.equal(restored.data.clips[0].progress.one.count,1);
  assert.deepEqual(restored.data.clips[0].segments,clip.segments);
  assert.equal(restored.data.clips[0].url,key);
 }finally{await repository.close();}
});
