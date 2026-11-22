import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';
import {Client} from '../src/client';
import {createClip,uid} from '../src/domain';
import {fresh,execute,Authority,Repository,Request} from '../src/storage';
const auth:Authority={binding:'tab:qa',controller:true,videoKey:'youtube:abcdefghijk'};
function setup(){const root=fresh(),clip=createClip({videoKey:auth.videoKey!,url:'https://www.youtube.com/watch?v=abcdefghijk',title:'QA',durationMs:10000,segments:[{id:'a',revision:1,startMs:100,endMs:2000,source:'turn',onsetVerified:true,onsetVersion:3}]});root.clips[clip.id]=clip;const client=new Client(async m=>{try{return {ok:true,dataEpoch:1,data:execute(root,m,auth)};}catch(e){return {ok:false,error:(e as any).code};}});client.clip=structuredClone(clip);return {root,clip,client};}
const caption={text:'Hello there.',confidence:.9,language:'en'};
test('onset review that restores a word invalidates its old English and fences late writes',async()=>{
 const {root,clip,client}=setup();await client.acquire();
 try{
  await client.saveCaption(clip.id,'a',{text:'サリー',language:'ja',confidence:.92});
  await client.saveTranslation(clip.id,'a','サリー','Sally.');
  const late=client.envelope('SAVE_TRANSLATION',{segmentId:'a',segmentRevision:1,sourceText:'サリー',englishText:'Sally.'});
  const revised=await client.call('REFINE_START',{segmentId:'a',segmentRevision:1,startMs:0,onsetVersion:3,text:'アクセサリー',language:'ja'});
  assert.equal(revised.segments[0].text,'アクセサリー');
  assert.equal(revised.segments[0].englishText,undefined);
  await assert.rejects(client.send(late));
  await client.saveTranslation(clip.id,'a','アクセサリー','Accessory.');
  const same=await client.call('REFINE_START',{segmentId:'a',segmentRevision:2,startMs:10,onsetVersion:3,text:'アクセサリー',language:'ja'});
  assert.equal(same.segments[0].englishText,'Accessory.');
  await client.call('REFINE_START',{segmentId:'a',segmentRevision:3,startMs:15,onsetVersion:3,language:'en'});
  assert.equal(root.clips[clip.id].segments[0].englishText,undefined);
 }finally{await client.release();}
});
test('background caption commutes with an already prepared completion without resetting counts',async()=>{
 const {root,clip,client}=setup();await client.acquire();
 const completion=client.envelope('COMMIT_COMPLETION',{attemptId:'first',segmentId:'a',segmentRevision:1});
 await client.saveCaption(clip.id,'a',caption);
 assert.equal(root.clips[clip.id].revision,completion.expectedRevision);
 client.clip=await client.send(completion);assert.equal(client.clip?.progress.a.count,1);assert.equal(client.clip?.segments[0].text,caption.text);assert.equal(client.clip?.segments[0].revision,1);
 await client.release();
});
test('stale append and replayed old receipts cannot erase a caption or reset practice',async()=>{
 const {root,clip,client}=setup();await client.acquire();
 const checkpoint=client.envelope('SAVE_CHECKPOINT',{});client.clip=await client.send(checkpoint);
 const append=client.envelope('SAVE_CLIP',{...structuredClone(client.clip),segments:[...structuredClone(client.clip!.segments),{id:'b',revision:1,startMs:3000,endMs:4000,source:'turn'}]});
 await client.saveCaption(clip.id,'a',caption);
 const replay=await client.send(checkpoint);assert.equal(replay.segments[0].text,caption.text);
 client.clip=await client.send(append);assert.equal(client.clip?.segments[0].revision,1);assert.equal(root.clips[clip.id].segments[0].text,caption.text);await client.release();
});
test('caption requires current ownership and interval revision and cannot replace existing text',async()=>{
 const {clip,client}=setup();await client.acquire();await client.saveCaption(clip.id,'a',caption);
 await client.call('SAVE_TRANSCRIPT',{segmentId:'a',segmentRevision:1,...caption,text:'different'});assert.equal(client.clip?.segments[0].text,caption.text);
 await assert.rejects(client.call('SAVE_TRANSCRIPT',{segmentId:'a',segmentRevision:2,...caption}));
 await client.release();await assert.rejects(client.call('SAVE_TRANSCRIPT',{segmentId:'a',segmentRevision:1,...caption}));
});
test('caption metadata persists through IndexedDB reopen with the same progress revision',async()=>{
 const {clip}=setup(),name='caption-'+uid(),repo=new Repository(name);
 const request=(type:string,payload:any={},clipId?:string):Request=>({protocolVersion:1,requestId:uid(),type,dataEpoch:1,clipId,payload});
 const saved=await repo.request(request('SAVE_CLIP',clip),auth);assert(saved.ok);const id=saved.data.id,revision=saved.data.revision;
 const owner=await repo.request(request('ACQUIRE_SESSION',{},id),auth);assert(owner.ok);
 const result=await repo.request(request('SAVE_TRANSCRIPT',{...owner.data,segmentId:'a',segmentRevision:1,...caption},id),auth);assert(result.ok);await repo.close();
 const reopened=new Repository(name),read=await reopened.request(request('GET_RECORD',{},id),auth);assert(read.ok);assert.equal(read.data.segments[0].text,caption.text);assert.equal(read.data.revision,revision);assert.equal(read.data.progress.a.count,0);await reopened.close();
});
test('incremental continuation passes 500 sentences without resending or changing old records',async()=>{
 const {root,clip,client}=setup();clip.durationMs=600000;clip.segments=Array.from({length:500},(_,i)=>({id:String(i),revision:1,startMs:i*1000,endMs:i*1000+800,source:'turn' as const}));clip.progress=Object.fromEntries(clip.segments.map(s=>[s.id,{count:2,target:2}]));client.clip=structuredClone(clip);await client.acquire();
 const request=client.envelope('APPEND_SEGMENTS',{segments:[{id:'new',revision:1,startMs:500000,endMs:501000,source:'turn'}]});assert(JSON.stringify(request).length<1000);
 client.clip=await client.send(request);assert.equal(client.clip?.segments.length,501);assert.equal(client.clip?.progress['0'].count,2);assert.equal(client.clip?.progress.new.count,0);assert.equal(root.clips[clip.id].segments[0].revision,1);await client.release();
});

test('English translation is separate metadata and survives a stale checkpoint without replacing original or counts',async()=>{
 const {root,clip,client}=setup();await client.acquire();const original={text:'これは日本語です。',confidence:.95,language:'ja'};await client.saveCaption(clip.id,'a',original);
 const checkpoint=client.envelope('SAVE_CHECKPOINT',{});client.clip=await client.send(checkpoint);const completion=client.envelope('COMMIT_COMPLETION',{attemptId:'bilingual',segmentId:'a',segmentRevision:1});
 await client.saveTranslation(clip.id,'a',original.text,'This is Japanese.');const replay=await client.send(checkpoint);assert.equal(replay.segments[0].englishText,'This is Japanese.');
 client.clip=await client.send(completion);assert.equal(client.clip?.segments[0].text,original.text);assert.equal(client.clip?.segments[0].englishText,'This is Japanese.');assert.equal(client.clip?.progress.a.count,1);
 await assert.rejects(client.call('SAVE_TRANSLATION',{segmentId:'a',segmentRevision:1,sourceText:'wrong original',englishText:'bad'}));assert.equal(root.clips[clip.id].segments[0].text,original.text);await client.release();
});
