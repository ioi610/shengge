import type {VideoAdapter} from './player';
import {decodeAudio} from './prepared-audio';
import {formatTime} from './domain';

const MAX_BYTES=128*1024*1024;
/** Explicit alternative for normally playable media without a whole-track URL.
 * Records only this video element, at normal speed; never requests a microphone.
 * No partial recording is saved. The decoded duration must cover the full source.
 */
export async function capturePreparedAudio(adapter:VideoAdapter,signal:AbortSignal,progress:(message:string)=>void){
 signal.throwIfAborted();adapter.pause();adapter.setRate(1);
 if(adapter.duration>3600000)throw new Error('预分析暂支持一小时以内的视频。');
 const video=adapter.video as HTMLVideoElement&{captureStream?:()=>MediaStream};
 if(!video.captureStream||typeof MediaRecorder==='undefined')throw new Error('当前播放器不能采集音轨，请使用桌面 Chrome。');
 const seekZero=async()=>{const cancel=()=>adapter.cancelSeek();signal.addEventListener('abort',cancel,{once:true});try{signal.throwIfAborted();await adapter.seek(0);signal.throwIfAborted();}finally{signal.removeEventListener('abort',cancel);}};
 await seekZero();
 const duration=adapter.duration,source=video.currentSrc;let stream:MediaStream;
 try{stream=video.captureStream();}catch{throw new Error('当前视频不允许采集播放音轨，无法开始分析。');}
 stream.getVideoTracks().forEach(t=>t.stop());
 const tracks=stream.getAudioTracks();if(!tracks.length){stream.getTracks().forEach(t=>t.stop());throw new Error('当前视频没有可采集的音轨，请先在原站播放正片。');}
 const mime=['audio/webm;codecs=opus','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
 if(!mime){stream.getTracks().forEach(t=>t.stop());throw new Error('当前 Chrome 不支持音轨录制。');}
 let recorder:MediaRecorder;
 try{recorder=new MediaRecorder(new MediaStream(tracks),{mimeType:mime,audioBitsPerSecond:128000});}
 catch{stream.getTracks().forEach(t=>t.stop());throw new Error('浏览器无法启动当前音轨的采集，未保存练习。');}
 const chunks:Blob[]=[];let size=0;
 try{
  const blob=await new Promise<Blob>((resolve,reject)=>{
   let finished=false,ended=false,failed:unknown;
   const valid=()=>adapter.valid&&!adapter.ad&&video.currentSrc===source;
   const cleanup=()=>{clearInterval(poll);signal.removeEventListener('abort',abort);adapter.mediaEnd.removeEventListener('ended',end);for(const [name,handler]of listeners)video.removeEventListener(name,handler);recorder.ondataavailable=null;recorder.onerror=null;recorder.onstop=null;};
   const finish=()=>{if(finished)return;finished=true;cleanup();if(failed)reject(failed);else if(!ended||!valid()||Math.abs(adapter.position-duration)>250)reject(new Error('音轨未完整采集，未保存练习。请重新从头采集。'));else if(!size)reject(new Error('采集到的音轨为空。'));else resolve(new Blob(chunks,{type:mime}));};
   const stop=(error?:unknown)=>{if(finished)return;failed??=error;if(recorder.state!=='inactive'){try{recorder.stop();}catch{finish();}}else finish();};
   const abort=()=>stop(signal.reason??new DOMException('采集已停止','AbortError'));
   const playing=()=>{if(!valid()){stop(new Error('视频已变化，采集已停止。'));return;}if(recorder.state==='inactive')recorder.start(1000);else if(recorder.state==='paused')recorder.resume();};
   const pause=()=>{if(recorder.state==='recording')recorder.pause();};
   const seeking=()=>stop(new Error('采集时发生跳转，未保存错位音轨。请重新从头采集。'));
   const rate=()=>{if(video.playbackRate!==1)stop(new Error('采集需要正常语速，已停止。请重新从头采集。'));};
   // Formal players intentionally stop propagation of the DOM ended event.
   // Subscribe to their normalized EOF notification, as the practice engine does.
   const end=()=>{if(ended||finished)return;ended=true;adapter.pause();stop();};
   const lost=()=>stop(new Error('播放器或音轨已变化，采集已停止。'));
   const listeners:Array<[string,EventListener]>=[['playing',playing],['pause',pause],['waiting',pause],['seeking',seeking],['ratechange',rate],['emptied',lost],['error',lost]];
   recorder.ondataavailable=e=>{if(!e.data.size)return;chunks.push(e.data);size+=e.data.size;if(size>MAX_BYTES)stop(new Error('采集音轨超过当前容量，已停止。'));};
   recorder.onerror=()=>stop(new Error('浏览器音轨采集失败，未保存练习。'));
   recorder.onstop=()=>{if(!ended&&video.ended)ended=true;finish();};
   for(const [name,handler]of listeners)video.addEventListener(name,handler);
   adapter.mediaEnd.addEventListener('ended',end);
   signal.addEventListener('abort',abort,{once:true});
   const poll=setInterval(()=>{if(!valid()){lost();return;}if(video.ended){end();return;}rate();progress(`采集音轨 ${formatTime(adapter.position)} / ${formatTime(duration)}${video.paused?' · 原片已暂停':' · 完成后分析'}（停止后需从头采集）`);},250);
   progress(`采集音轨 00:00 / ${formatTime(duration)} · 完成后分析（停止后需从头采集）`);
   if(signal.aborted){abort();return;}
   void adapter.play().then(()=>{if(!video.paused&&video.readyState>=3)playing();},stop);
  });
  signal.throwIfAborted();adapter.pause();
  if(!adapter.valid||video.currentSrc!==source)throw new Error('视频已变化，未保存采集音轨。');
  await seekZero();progress('音轨采集完成 · 正在解码');
  return await decodeAudio(await blob.arrayBuffer(),duration,signal);
 }finally{adapter.pause();try{if(recorder.state!=='inactive')recorder.stop();}finally{stream.getTracks().forEach(t=>t.stop());chunks.length=0;}}
}
