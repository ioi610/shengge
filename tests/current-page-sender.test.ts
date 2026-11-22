import 'fake-indexeddb/auto';
import test from 'node:test';import assert from 'node:assert/strict';
import {currentPageSender} from '../src/current-page-sender';
import {resolveSource} from '../src/domain';

const oldUrl='https://www.bilibili.com/video/BV1xo4y1c7Pq/';
const newUrl='https://www.bilibili.com/video/BV1aX4y1879h/';
const sender={id:'extension',tab:{id:5},frameId:0,documentId:'doc',url:oldUrl} as chrome.runtime.MessageSender;
test('live document replaces stale SPA sender URL and document-target validation rejects navigation',async()=>{
 const prior=globalThis.chrome;let target:any,calls=0;
 let row:any={frameId:0,documentId:'doc',result:newUrl};
 Object.assign(globalThis,{chrome:{runtime:{id:'extension'},scripting:{executeScript:async(input:any)=>{target=input.target;calls++;return [row];}}}});
 try{
  assert.equal((await currentPageSender(sender)).url,newUrl);assert.deepEqual(target,{tabId:5,documentIds:['doc']});
  await currentPageSender({...sender,documentId:undefined});assert.deepEqual(target,{tabId:5,frameIds:[0]});
  const count=calls;for(const s of [{...sender,id:'other'},{...sender,frameId:2},{...sender,tab:undefined}])await assert.rejects(currentPageSender(s));assert.equal(calls,count);
  const valid={...row};
  for(const bad of [{...valid,documentId:'replacement'},{...valid,frameId:2},{...valid,result:'https://www.youtube.com/watch?v=joNO7J8609s'},{...valid,result:'https://www.bilibili.com/'}]){row=bad;await assert.rejects(currentPageSender(sender));}
 }finally{Object.assign(globalThis,{chrome:prior});}
});

test('SPA change updates actual background status, audio, ASR and storage authority together',async()=>{
 const prior=globalThis.chrome;let listener:any,current=oldUrl,forwarded:any;
 Object.assign(globalThis,{chrome:{runtime:{id:'extension',getURL:(p:string)=>'chrome-extension://extension/'+p,onMessage:{addListener:(fn:any)=>listener=fn},sendMessage:async(m:any)=>{forwarded=m;return {ok:true,data:{ready:true}};}},action:{onClicked:{addListener:()=>{}}},offscreen:{hasDocument:async()=>true},scripting:{executeScript:async({func}:any)=>{
  const source=resolveSource(current);return [{frameId:0,documentId:'doc',result:func.name==='readCurrentPageUrl'?current:{url:current,id:source.id,part:Number(new URL(current).searchParams.get('p')??1),cid:123,durationMs:2000,mediaSrc:'blob:current',candidates:[source.platform==='bilibili'?'https://example.bilivideo.com/upgcxcode/1/2/123/123-1-30280.m4s':'https://example.googlevideo.com/audio']}}];
 }}}});
 try{
  await import('../src/background');
  const request=(m:any)=>new Promise<any>(resolve=>listener(m,sender,resolve));
  const envelope=(type:string,payload:any={},extra:any={})=>({type,payload,protocolVersion:1,dataEpoch:1,requestId:crypto.randomUUID(),...extra});
  const save=()=>request(envelope('SAVE_CLIP',{videoKey:resolveSource(current).videoKey,url:current,title:'SPA fixture',name:'test',durationMs:2000,segments:[{id:'s',revision:1,startMs:0,endMs:1000,source:'manual'}]}));
  const old=await save();assert.equal(old.ok,true);
  const oldOwner=await request(envelope('ACQUIRE_SESSION',{}, {clipId:old.data.id}));assert.equal(oldOwner.ok,true);
  for(const url of [newUrl,newUrl+'?p=2']){
   current=url;const key=resolveSource(current).videoKey;
   assert.equal((await request({type:'BACKEND_STATUS'})).data.videoKey,key);
   assert.equal((await request({type:'PAGE_AUDIO'})).data.videoKey,key);
   assert.equal((await request({type:'LOCAL_ASR',action:'health'})).ok,true);assert.equal(forwarded.videoKey,key);
   const fresh=await save();assert.equal(fresh.ok,true);assert.equal(fresh.data.videoKey,key);assert.notEqual(fresh.data.id,old.data.id);
   const stale=await request(envelope('SAVE_CHECKPOINT',{current:0,mode:'shadow',...oldOwner.data},{clipId:old.data.id,expectedRevision:old.data.revision}));assert.equal(stale.ok,false);assert.equal(stale.error,'STALE_BINDING');
  }
  const oldRead=await request(envelope('GET_RECORD',{}, {clipId:old.data.id}));assert.deepEqual(oldRead.data.progress,old.data.progress);
  // A separate YouTube document has the same history.pushState failure mode.
  sender.url='https://www.youtube.com/watch?v=joNO7J8609s';current='https://www.youtube.com/watch?v=883BgL8uXW0';
  assert.equal((await request({type:'BACKEND_STATUS'})).data.videoKey,'youtube:883BgL8uXW0');
  assert.equal((await request({type:'PAGE_AUDIO'})).data.videoKey,'youtube:883BgL8uXW0');
 }finally{sender.url=oldUrl;Object.assign(globalThis,{chrome:prior});}
});
