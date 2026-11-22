import test from 'node:test';import assert from 'node:assert/strict';
import {applyYoutubeVolume,dispatchPageVolume,validateVolumeChange} from '../src/page-volume';
test('YouTube volume uses native state and keeps a muted player muted when adjusting the slider',()=>{
 const prior={document:globalThis.document,location:globalThis.location};let volume=100,muted=true;
 const url='https://www.youtube.com/watch?v=joNO7J8609s';let src='blob:current';
 const player={querySelector:()=>({currentSrc:src}),setVolume:(v:number)=>volume=v,getVolume:()=>volume,mute:()=>muted=true,unMute:()=>muted=false,isMuted:()=>muted};
 try{Object.assign(globalThis,{document:{querySelector:()=>player},location:new URL(url)});
  assert.deepEqual(applyYoutubeVolume(url,src,{volume:1}),{volume:1,muted:true});
  assert.deepEqual(applyYoutubeVolume(url,src,{muted:false}),{volume:1,muted:false});
  assert.deepEqual(applyYoutubeVolume(url,src,{volume:0}),{volume:0,muted:true});
  assert.throws(()=>applyYoutubeVolume(url.replace('joNO7J8609s','other'),src,{volume:50}),/视频已变化/);
  assert.throws(()=>applyYoutubeVolume(url,'blob:previous',{volume:50}),/播放器已变化/);assert.equal(volume,0);
 }finally{Object.assign(globalThis,prior);}
});
test('volume bridge validates inputs and authenticates the current document before executing',async()=>{
 for(const value of [null,{},[],{volume:NaN},{volume:-1},{volume:101},{muted:'true'},{volume:10,script:'x'}])assert.throws(()=>validateVolumeChange(value));
 const prior=globalThis.chrome;let calls=0,target:any;
 const sender={id:'extension',tab:{id:5},frameId:0,documentId:'current',url:'https://www.youtube.com/watch?v=joNO7J8609s'} as chrome.runtime.MessageSender;
 Object.assign(globalThis,{chrome:{runtime:{id:'extension'},scripting:{executeScript:async(input:any)=>{calls++;target=input.target;return [{frameId:0,documentId:'current',result:{volume:1,muted:true}}];}}}});
 try{const message={change:{volume:1},mediaSrc:'blob:current'};
  assert.deepEqual(await dispatchPageVolume(message,sender),{volume:1,muted:true});assert.deepEqual(target,{tabId:5,documentIds:['current']});
  for(const bad of [{...sender,id:'other'},{...sender,frameId:1},{...sender,url:'https://www.bilibili.com/video/BV1xo4y1c7Pq/'}])await assert.rejects(dispatchPageVolume(message,bad));
  await assert.rejects(dispatchPageVolume({...message,change:{volume:Infinity}},sender));assert.equal(calls,1);
 }finally{Object.assign(globalThis,{chrome:prior});}
});
