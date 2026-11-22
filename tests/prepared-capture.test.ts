import test from 'node:test';import assert from 'node:assert/strict';
import {capturePreparedAudio} from '../src/prepared-capture';
import type {VideoAdapter} from '../src/player';
import {MediaEnd} from '../src/media-end';

function fixture(decodedSeconds=6){
 const prior={MediaRecorder:globalThis.MediaRecorder,MediaStream:globalThis.MediaStream,OfflineAudioContext:globalThis.OfflineAudioContext};
 let recorder:any,decoded=0;const track={stopped:false,stop(){this.stopped=true;}};
 class Stream {getVideoTracks(){return [];}getAudioTracks(){return [track];}getTracks(){return [track];}}
 class Recorder {
  static isTypeSupported(){return true;}state='inactive';ondataavailable:any;onstop:any;onerror:any;pauses=0;resumes=0;
  constructor(){recorder=this;}start(){this.state='recording';}pause(){this.state='paused';this.pauses++;}resume(){this.state='recording';this.resumes++;}
  stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['encoded fixture'])});this.onstop?.();});}
 }
 class Context {async decodeAudioData(){decoded++;return {sampleRate:16000,duration:decodedSeconds,length:Math.round(decodedSeconds*16000),numberOfChannels:1,getChannelData:()=>new Float32Array(Math.round(decodedSeconds*16000))};}}
 Object.assign(globalThis,{MediaRecorder:Recorder,MediaStream:Stream,OfflineAudioContext:Context});
 const host=new EventTarget();
 const video=Object.assign(new EventTarget(),{ownerDocument:{defaultView:host},currentSrc:'blob:source',playbackRate:1,paused:true,ended:false,readyState:4,currentTime:0,captureStream:()=>new Stream()});
 const adapter={video,mediaEnd:new EventTarget(),valid:true,ad:false,duration:6000,get position(){return video.currentTime*1000;},pause(){video.paused=true;video.dispatchEvent(new Event('pause'));},setRate(n:number){video.playbackRate=n;},async seek(n:number){video.currentTime=n/1000;video.dispatchEvent(new Event('seeking'));},async play(){video.paused=false;video.dispatchEvent(new Event('playing'));}};
 const guard=new MediaEnd(video as unknown as HTMLVideoElement,()=>adapter.valid,()=>true);adapter.mediaEnd=guard;
 let siteEnded=0;host.addEventListener('ended',()=>siteEnded++);
 const end=()=>{video.currentTime=6;video.ended=true;const event=new Event('ended');Object.defineProperty(event,'target',{value:video});host.dispatchEvent(event);};
 const controller=new AbortController(),messages:string[]=[];
 const result=capturePreparedAudio(adapter as unknown as VideoAdapter,controller.signal,m=>messages.push(m));
 return {video,adapter,controller,result,messages,track,end,get siteEnded(){return siteEnded;},get recorder(){return recorder;},get decoded(){return decoded;},restore(){guard.dispose();Object.assign(globalThis,prior);}};
}
const ready=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('full capture pauses with original player, resumes, verifies duration and returns PCM while original stays paused at zero',async()=>{
 const f=fixture();try{
  await ready();assert.equal(f.recorder.state,'recording');
  f.adapter.pause();assert.equal(f.recorder.state,'paused');await f.adapter.play();assert.equal(f.recorder.state,'recording');assert.equal(f.recorder.pauses,1);assert.equal(f.recorder.resumes,1);
  f.end();
  const pcm=await f.result;assert.equal(pcm.length,96000);assert.equal(f.video.currentTime,0);assert.equal(f.video.paused,true);assert.equal(f.track.stopped,true);assert.equal(f.decoded,1);
  assert.equal(f.siteEnded,0,'formal EOF must be consumed without hanging capture or invoking native auto-next');
 }finally{f.restore();}
});
test('cancel, manual seek, rate change and source replacement reject partial captures and release tracks without decoding',async()=>{
 for(const action of ['cancel','seek','rate','source','early-stop']){
  const f=fixture();try{
   const rejected=assert.rejects(f.result);await ready();
   if(action==='cancel')f.controller.abort();
   if(action==='seek')f.video.dispatchEvent(new Event('seeking'));
   if(action==='rate'){f.video.playbackRate=2;f.video.dispatchEvent(new Event('ratechange'));}
   if(action==='source'){f.video.currentSrc='blob:different';f.video.dispatchEvent(new Event('emptied'));}
   if(action==='early-stop')f.recorder.stop();
   await rejected;assert.equal(f.track.stopped,true,action);assert.equal(f.video.paused,true,action);assert.equal(f.decoded,0,action);
  }finally{f.restore();}
 }
});
test('a complete-looking recording with a missing second is rejected instead of saving a shifted timeline',async()=>{
 const f=fixture(5);try{
  const rejected=assert.rejects(f.result,/时长不一致/);await ready();f.end();await rejected;assert.equal(f.track.stopped,true);
 }finally{f.restore();}
});
test('native ended state finalizes a live recording even when another listener suppresses every EOF notification',{timeout:1500},async()=>{
 const f=fixture();try{await ready();f.video.currentTime=6;f.video.ended=true;const pcm=await f.result;assert.equal(pcm.length,96000);assert.equal(f.video.paused,true);assert.equal(f.track.stopped,true);}finally{f.restore();}
});
test('duplicate EOF notifications do not finalize before the recorder flushes its last data chunk',async()=>{
 const f=fixture();try{await ready();f.end();f.end();const pcm=await f.result;assert.equal(pcm.length,96000);assert.equal(f.decoded,1);}finally{f.restore();}
});
test('stopping during a buffered seek cancels that seek before any capture stream is opened',async()=>{
 const prior=globalThis.MediaRecorder;Object.assign(globalThis,{MediaRecorder:{}});
 const controller=new AbortController();let rejectSeek:(reason:Error)=>void=()=>{};let cancelled=false,opened=false;
 const adapter={duration:6000,pause(){},setRate(){},video:{captureStream(){opened=true;}},seek:()=>new Promise<void>((_,reject)=>{rejectSeek=reject;}),cancelSeek(){cancelled=true;rejectSeek(new Error('seek cancelled'));}};
 try{const rejected=assert.rejects(capturePreparedAudio(adapter as unknown as VideoAdapter,controller.signal,()=>{}));controller.abort();await rejected;assert.equal(cancelled,true);assert.equal(opened,false);}finally{Object.assign(globalThis,{MediaRecorder:prior});}
});
test('native capture denial is reported without starting a recorder or decoding audio',async()=>{
 const f=fixture();f.video.captureStream=()=>{throw new DOMException('not allowed','NotSupportedError');};
 try{await assert.rejects(f.result,/不允许采集播放音轨/);assert.equal(f.recorder,undefined);assert.equal(f.decoded,0);}finally{f.restore();}
});
