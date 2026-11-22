import test from 'node:test';import assert from 'node:assert/strict';import {allowedAudioUrl,validatePageAudio,readPageAudio,dispatchPageAudio,AudioSourceUnavailable} from '../src/page-audio';
const url='https://www.bilibili.com/video/BV1xo4y1c7Pq/';
const data={url,id:'BV1xo4y1c7Pq',part:1,cid:123,durationMs:630764,candidates:['https://upos.example.bilivideo.com/upgcxcode/1/2/123/123-1-30280.m4s?token=example'],mediaSrc:'blob:video'};
test('page audio is restricted to the platform media host and HTTPS without credentials',()=>{
 for(const value of ['http://x.bilivideo.com/a','https://bilivideo.com.evil.test/a','https://user:pass@x.bilivideo.com/a','https://x.bilivideo.com:444/a','file:///tmp/a'])assert.equal(allowedAudioUrl(value,'bilibili'),undefined);
 assert.equal(allowedAudioUrl('https://x.googlevideo.com/a','bilibili'),undefined);assert.ok(allowedAudioUrl(data.candidates[0],'bilibili'));
 assert.ok(allowedAudioUrl('https://upos-hz-mirrorakam.akamaized.net/audio','bilibili'));
 for(const host of ['other.akamaized.net','upos-hz-mirrorakam.akamaized.net.evil.test'])assert.equal(allowedAudioUrl(`https://${host}/audio`,'bilibili'),undefined);
 assert.equal(allowedAudioUrl('https://upos-hz-mirrorakam.akamaized.net/audio','youtube'),undefined);
});
test('Bilibili prefers the current CID audio observed after SPA navigation and retains CDN backups',()=>{
 const prior={window:globalThis.window,document:globalThis.document,location:globalThis.location,performance:globalThis.performance};
 const audio=(cid:number,host='example.bilivideo.com')=>`https://${host}/upgcxcode/1/2/${cid}/${cid}-1-30232.m4s`;
 const current='https://www.bilibili.com/video/BV1aX4y1879h/?p=2';
 const manifest={bvid:'BV1aX4y1879h',cid:456,p:2};
 const video={duration:630.897,currentSrc:'blob:new',closest:()=>null,getBoundingClientRect:()=>({width:960,height:540})};
 const initial={dash:{audio:[{mimeType:'audio/mp4',baseUrl:audio(123),backupUrl:[audio(123,'upos-hz-mirrorakam.akamaized.net')]}]},timelength:900000};
 try{Object.assign(globalThis,{window:{player:{getManifest:()=>manifest},__INITIAL_STATE__:{videoData:{bvid:'BV1xo4y1c7Pq',cid:123}},__playinfo__:{data:initial}},location:new URL(current),document:{querySelectorAll:()=>[video]},performance:{getEntriesByType:()=>[{name:audio(123)},{name:audio(456,'upos-hz-mirrorakam.akamaized.net')},{name:audio(456).replace('30232','100026')}]}});
  const found=readPageAudio();assert.equal(found.cid,456);assert.equal(found.id,manifest.bvid);assert.equal(found.part,2);assert.equal(found.durationMs,630897);
  assert.deepEqual(validatePageAudio(found,current).urls,[audio(456,'upos-hz-mirrorakam.akamaized.net')]);
  initial.dash.audio=[{mimeType:'audio/mp4',baseUrl:audio(456),backupUrl:[audio(456,'upos-hz-mirrorakam.akamaized.net')]}];
  Object.assign(globalThis,{performance:{getEntriesByType:()=>[]}});
  assert.deepEqual(validatePageAudio(readPageAudio(),current).urls,[audio(456),audio(456,'upos-hz-mirrorakam.akamaized.net')]);
  assert.throws(()=>validatePageAudio({...found,candidates:[audio(123)]},current),AudioSourceUnavailable);
 }finally{Object.assign(globalThis,prior);}
});
test('YouTube SPA response wins over initial video and hidden preview player',()=>{
 const prior={window:globalThis.window,document:globalThis.document,location:globalThis.location};
 const current='joNO7J8609s',youtube=`https://www.youtube.com/watch?v=${current}`;
 const response=(id:string)=>({videoDetails:{videoId:id,lengthSeconds:'2981'},streamingData:{serverAbrStreamingUrl:'https://r.example.googlevideo.com/sabr',adaptiveFormats:[]}});
 const video=(src:string,visible:boolean)=>({currentSrc:src,closest:()=>visible?{}:null,getBoundingClientRect:()=>({width:visible?960:0,height:visible?540:0})});
 const player={getPlayerResponse:()=>response(current)};
 try{
  Object.assign(globalThis,{window:{ytInitialPlayerResponse:response('previous000')},location:new URL(youtube),document:{querySelectorAll:()=>[video('blob:preview',false),video('blob:current',true)],querySelector:()=>player}});
  const metadata=readPageAudio();assert.equal(metadata.id,current);assert.equal(metadata.mediaSrc,'blob:current');assert.equal(metadata.streamOnly,true);
  assert.throws(()=>validatePageAudio(metadata,youtube),(e:any)=>e instanceof AudioSourceUnavailable&&/分段音轨/.test(e.message));
  player.getPlayerResponse=()=>response('another0000');assert.equal(readPageAudio().id,undefined,'never take a previous video after SPA navigation');
 }finally{Object.assign(globalThis,prior);}
});
test('page audio targets an authenticated top frame when documentId is absent and rejects navigation or other senders',async()=>{
 const prior=globalThis.chrome;let target:any,calls=0;
 const sender={id:'extension',tab:{id:5},frameId:0,url} as chrome.runtime.MessageSender;
 let row:any={frameId:0,documentId:'doc',result:data};
 Object.assign(globalThis,{chrome:{runtime:{id:'extension'},scripting:{executeScript:async(input:any)=>{calls++;target=input.target;return [row];}}}});
 try{
  assert.equal((await dispatchPageAudio(sender)).videoKey,'bilibili:BV1xo4y1c7Pq:p1');assert.deepEqual(target,{tabId:5,frameIds:[0]});
  await dispatchPageAudio({...sender,documentId:'doc'});assert.deepEqual(target,{tabId:5,documentIds:['doc']});
  const before=calls;for(const invalid of [{...sender,id:'other'},{...sender,frameId:2},{...sender,tab:undefined}])await assert.rejects(dispatchPageAudio(invalid));assert.equal(calls,before);
  row={...row,documentId:'new-doc'};await assert.rejects(dispatchPageAudio({...sender,documentId:'doc'}),/文档已变化/);
  row={...row,result:{...data,id:'BV1824y1c74J'}};await assert.rejects(dispatchPageAudio(sender),/分集音轨/);
 }finally{Object.assign(globalThis,{chrome:prior});}
});
test('stale page, wrong part or absent audio fails instead of analyzing a different episode',()=>{
 assert.equal(validatePageAudio(data,url).videoKey,'bilibili:BV1xo4y1c7Pq:p1');
 assert.throws(()=>validatePageAudio({...data,part:2},url));assert.throws(()=>validatePageAudio({...data,id:'BV1824y1c74J'},url));assert.throws(()=>validatePageAudio({...data,candidates:[]},url));
});
