import {BackgroundCaptions} from './background-captions';
import {AsrTransport,extensionAsr} from './local-asr-client';
import {formatTime,validateSegments} from './domain';
import {prepareRecognition} from './recognition-ready';
import {analysisOffsets,AnalysisWindow,needsReview,TIMELINE_VERSION,TimelineCheckpoint,timelineSegments,validCheckpoint} from './timeline-plan';
export async function prepareTimeline(pcm:Float32Array,durationMs:number,originMs:number,signal:AbortSignal,progress:(message:string)=>void,transport:AsrTransport=extensionAsr,language?:string){
 // Players can report a few milliseconds of duration drift after refreshing.
 // Cache against the decoded audio, then clamp the final plan to this player.
 const duration=Math.round(pcm.length/16),mediaDuration=Math.round(durationMs),origin=Math.round(originMs);signal.throwIfAborted();
 const hash=await crypto.subtle.digest('SHA-256',pcm.slice().buffer);signal.throwIfAborted();
 const fingerprint=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
 const key=`${TIMELINE_VERSION}:${origin}:${duration}:${fingerprint}`;
 const cached=await transport('analysis-load',{key});signal.throwIfAborted();
 const state:TimelineCheckpoint=validCheckpoint(cached,duration,origin)?cached:{version:TIMELINE_VERSION,durationMs:duration,originMs:origin,windows:[],reviewed:[]};
 let prepared=false;
 const captions=new BackgroundCaptions(transport),abort=()=>captions.dispose();signal.addEventListener('abort',abort,{once:true});
 const save=async()=>{signal.throwIfAborted();await transport('analysis-save',{key,checkpoint:state});signal.throwIfAborted();};
 const windowAt=async(offset:number):Promise<AnalysisWindow>=>{
  const existing=state.windows.find(w=>w.offsetMs===offset);if(existing)return existing;
  if(!prepared){await prepareRecognition(transport,signal,progress);prepared=true;progress(`分析对白 ${formatTime(offset)} / ${formatTime(duration)}`);}
  signal.throwIfAborted();const stop=Math.min(pcm.length,Math.round((offset+24000)*16)),start=Math.round(offset*16);
  const audio=pcm.slice(start,stop),padded=new Float32Array(Math.max(16000,audio.length));padded.set(audio);
  const result=await captions.transcribe(padded,language,120000);signal.throwIfAborted();
  if(!result)throw new Error('音轨分析未完成，已保留分析进度。请点击继续分析。');
  if(result.language&&result.language!=='auto')language??=result.language;
  const window={offsetMs:offset,durationMs:Math.round(padded.length/16),language:result.language,segments:result.segments};state.windows.push(window);await save();return window;
 };
 try{
  for(const offset of analysisOffsets(origin,duration)){
   progress(`分析对白 ${formatTime(offset)} / ${formatTime(duration)} · 已确认 ${timelineSegments(state.windows,duration,origin).length} 句`);
   const window=await windowAt(offset);
   if(needsReview(window)&&!state.reviewed.includes(offset)){
    progress(`复核弱声 ${formatTime(offset)} / ${formatTime(duration)}`);
    const shifted=Math.max(origin,Math.min(offset+5000,duration-24000));if(shifted!==offset)await windowAt(shifted);
    state.reviewed.push(offset);await save();
   }
  }
  signal.throwIfAborted();const segments=timelineSegments(state.windows,Math.min(duration,mediaDuration),origin);
  if(!segments.length)throw new Error('分析完成，但未能确认可练习的对白。未创建空练习。');
  validateSegments(segments,mediaDuration);state.complete=true;await save();progress(`分析完成 · ${segments.length} 句`);return segments;
 }finally{signal.removeEventListener('abort',abort);captions.dispose();}
}
