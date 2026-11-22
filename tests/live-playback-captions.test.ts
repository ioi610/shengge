import test from 'node:test';
import assert from 'node:assert/strict';
import {LivePlaybackCaptions} from '../desktop/live-playback-captions';
import {BackgroundCaptions} from '../src/background-captions';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('captures during model startup and drains slow recognition and the final partial window in order',async t=>{
 let prepare!:()=>void,finish!:()=>void,receive!:(e:{data:{message:string;data:ArrayBuffer}})=>void;
 const startup=new Promise<void>(resolve=>{prepare=resolve;});
 const first=new Promise<void>(resolve=>{finish=resolve;});
 const stub=(key:string,value:unknown)=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,key);
  Object.defineProperty(globalThis,key,{value,configurable:true});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);});
 };
 stub('chrome',{runtime:{getURL:(s:string)=>s,sendMessage:async()=>{await startup;return {ok:true,data:{streaming:true}};}}});
 stub('AudioContext',class{
  audioWorklet={addModule:async()=>{}};resume=async()=>{};close=async()=>{};
  createMediaStreamSource(){return {connect(){}};}
 });
 stub('AudioWorkletNode',class{
  port={set onmessage(handler:typeof receive){receive=handler;},close(){}};connect(){}disconnect(){}
 });
 const samples:number[]=[];
 t.mock.method(BackgroundCaptions.prototype,'transcribe',async(pcm:Float32Array)=>{
  const initial=samples.length===0;
  for(let i=0;i<pcm.length;i+=1600)samples.push(pcm[i]);
  if(initial)await first;
  return {segments:[]};
 });
 const video=Object.assign(new EventTarget(),{currentTime:0,playbackRate:1,readyState:4,paused:false,
  captureStream:()=>({getAudioTracks:()=>[{}],getVideoTracks:()=>[],getTracks:()=>[]})});
 const reader=new LivePlaybackCaptions(video as unknown as HTMLVideoElement,()=>undefined);
 t.after(()=>reader.dispose());await tick();
 const feed=(i:number)=>{video.currentTime=i/10;receive({data:{message:'AUDIO_FRAME',data:new Float32Array(1600).fill(i).buffer}});};
 for(let i=1;i<=43;i++)feed(i);
 prepare();await tick();
 for(let i=44;i<=278;i++)feed(i);
 video.paused=true;video.dispatchEvent(new Event('pause'));finish();await tick();
 assert.deepEqual([...new Set(samples)],Array.from({length:278},(_,i)=>i+1));
});
