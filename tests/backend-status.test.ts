import 'fake-indexeddb/auto';
import test from 'node:test';import assert from 'node:assert/strict';
import {backendStatus,verifyBackend} from '../src/backend-status';
import {BUILD_VERSION} from '../src/config';

test('backend handshake is based on running code and only accepts the current supported top frame',()=>{
 const prior=globalThis.chrome;Object.assign(globalThis,{chrome:{runtime:{id:'extension'}}});
 const sender={id:'extension',tab:{id:5},frameId:0,documentId:'doc',url:'https://www.youtube.com/watch?v=joNO7J8609s'} as chrome.runtime.MessageSender;
 try{
  const data=backendStatus(sender);assert.equal(data.videoKey,'youtube:joNO7J8609s');assert.equal(data.documentTarget,'document');verifyBackend({ok:true,data});
  assert.throws(()=>backendStatus({...sender,id:'other'}));assert.throws(()=>backendStatus({...sender,frameId:1}));assert.throws(()=>backendStatus({...sender,url:'https://example.test/'}));
  for(const response of [{ok:false,error:'INVALID_REQUEST'},{ok:true,data:{...data,buildVersion:'previous'}},{ok:true,data:{...data,analysisCache:0}}])assert.throws(()=>verifyBackend(response),/网页与后台未同步/);
  assert.equal(data.buildVersion,BUILD_VERSION);
  assert.throws(()=>verifyBackend({ok:true,data:{...data,buildVersion:'0.8.1'}},'0.8.3'),/网页 0\.8\.3，运行后台 0\.8\.1.*chrome:\/\/extensions/);
 }finally{Object.assign(globalThis,{chrome:prior});}
});

test('actual background listener routes new requests before repository protocol validation',async()=>{
 const prior=globalThis.chrome;let listener:any;
 Object.assign(globalThis,{chrome:{runtime:{id:'extension',getURL:(p:string)=>'chrome-extension://extension/'+p,onMessage:{addListener:(fn:any)=>listener=fn}},action:{onClicked:{addListener:()=>{}}},scripting:{executeScript:async({func}:any)=>[{frameId:0,documentId:'doc',result:func.name==='readCurrentPageUrl'?'https://www.youtube.com/watch?v=joNO7J8609s':{url:'https://www.youtube.com/watch?v=joNO7J8609s',id:'joNO7J8609s',durationMs:2981000,mediaSrc:'blob:current',streamOnly:true,candidates:[]}}]}}});
 try{
  await import('../src/background');
  const sender={id:'extension',tab:{id:5},frameId:0,documentId:'doc',url:'https://www.youtube.com/watch?v=joNO7J8609s'};
  const request=(m:any)=>new Promise<any>(resolve=>listener(m,sender,resolve));
  verifyBackend(await request({type:'BACKEND_STATUS'}));
  const response=await request({type:'PAGE_AUDIO'});assert.equal(response.ok,false);assert.equal(response.code,'AUDIO_SOURCE_UNAVAILABLE');assert.match(response.error,/分段音轨/);
  assert.equal(listener({target:'ASR_OFFSCREEN'},sender,()=>assert.fail('must not reply to internal worker messages')),false);
 }finally{Object.assign(globalThis,{chrome:prior});}
});

test('the 0.8.25 content-only update can launch through the installed 0.8.24 toolbar',()=>{
 const data={buildVersion:'0.8.24',pageAudio:1,analysisCache:1};
 verifyBackend({ok:true,data},'0.8.25');
 assert.throws(()=>verifyBackend({ok:true,data:{...data,analysisCache:0}},'0.8.25'));
 assert.throws(()=>verifyBackend({ok:true,data},'0.8.26'));
});
