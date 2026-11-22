import type {VideoAdapter} from './player';
import {verifyBackend} from './backend-status';
import {AudioSourceUnavailable} from './page-audio';
const MAX_BYTES=128*1024*1024;
export async function fetchAudio(url:string,signal:AbortSignal,progress:(bytes:number,total?:number)=>void){
 const response=await fetch(url,{signal,credentials:'omit',redirect:'error'});
 if(!response.ok||!response.body)throw new Error('音轨地址已过期或读取失败，请刷新原站视频后重试分析。');
 const total=Number(response.headers.get('content-length'))||undefined;
 if(total&&total>MAX_BYTES)throw new Error('音轨超过当前分析容量，请使用较短的视频。');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){signal.throwIfAborted();const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES)throw new Error('音轨超过当前分析容量。');chunks.push(value);progress(size,total);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 if(size<44)throw new Error('读取到的音轨为空。');const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes.buffer;
}
export async function decodeAudio(bytes:ArrayBuffer,durationMs:number,signal:AbortSignal){
 signal.throwIfAborted();if(durationMs>3600000)throw new Error('预分析暂支持一小时以内的视频。');
 const context=new OfflineAudioContext(1,16000,16000),audio=await context.decodeAudioData(bytes);signal.throwIfAborted();
 if(audio.sampleRate!==16000||Math.abs(audio.duration*1000-durationMs)>500)throw new Error('音轨与视频时长不一致，未保存错位时间轴。请刷新原站重试。');
 const pcm=new Float32Array(audio.length);for(let c=0;c<audio.numberOfChannels;c++){const data=audio.getChannelData(c);for(let i=0;i<data.length;i++)pcm[i]+=data[i]/audio.numberOfChannels;}
 return pcm;
}
export async function loadPageAudio(adapter:VideoAdapter,signal:AbortSignal,progress:(message:string)=>void,pause=true){
 if(pause)adapter.pause();const source=adapter.video.currentSrc,duration=adapter.duration;
 if(duration>3600000)throw new Error('预分析暂支持一小时以内的视频。');
 verifyBackend(await chrome.runtime.sendMessage({type:'BACKEND_STATUS'}));signal.throwIfAborted();
 const response=await chrome.runtime.sendMessage({type:'PAGE_AUDIO'});signal.throwIfAborted();
 if(!response?.ok){if(response?.code==='AUDIO_SOURCE_UNAVAILABLE')throw new AudioSourceUnavailable(response.error);throw new Error(response?.error??'无法读取当前视频音轨。');}const info=response.data;
 if(info.videoKey!==adapter.videoKey||info.mediaSrc!==source||Math.abs(info.durationMs-duration)>1500)throw new Error('视频已变化，请重新连接后分析。');
 let failure:unknown;
 for(const url of info.urls){try{
  const bytes=await fetchAudio(url,signal,(n,total)=>progress(total?`读取音轨 ${Math.min(100,Math.floor(n/total*100))}%`:`读取音轨 ${(n/1048576).toFixed(1)} MB`));
  if(!adapter.valid||adapter.video.currentSrc!==source)throw new Error('视频已变化，分析已停止。');
  progress('正在解码音轨');const pcm=await decodeAudio(bytes,duration,signal);
  if(!adapter.valid||adapter.video.currentSrc!==source)throw new Error('视频已变化，分析已停止。');return pcm;
 }catch(e){signal.throwIfAborted();if(!adapter.valid||adapter.video.currentSrc!==source)throw new Error('视频已变化，分析已停止。');failure=e;}}
 throw failure??new Error('音轨读取失败，请刷新原站重试。');
}
