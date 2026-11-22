import {TurnHost} from '../src/turn-host';
import {RemoteTurnModel} from '../src/turn-client';
import {LiveSpeech} from '../src/live-speech';
import {VideoAdapter} from '../src/player';
import {RecognitionHost} from '../src/recognition-host';
const video=document.querySelector<HTMLVideoElement>('video')!,button=document.querySelector<HTMLButtonElement>('#run')!,output=document.querySelector('#output')!;
const select=document.querySelector<HTMLSelectElement>('#sample')!;
const host=new RecognitionHost(()=>{const worker=new Worker('./recognition-worker.js',{type:'module'});worker.addEventListener('message',({data})=>{if(['progress','ready','error','result'].includes(data.type))document.querySelector('#recognition')!.textContent+=JSON.stringify({...data,result:data.result})+'\n';});return worker;});
const turns=new TurnHost(()=>new Worker('./turn-worker.js',{type:'module'}));
select.onchange=()=>{video.src='./'+select.value;};
button.onclick=async()=>{
 button.disabled=true;document.querySelector('#recognition')!.textContent='';const events:any[]=[];const start=performance.now();let last=performance.now(),maxFrame=0;const playingFrames:number[]=[];let wasPlaying=false;
 let raf=0;const tick=()=>{const now=performance.now();maxFrame=Math.max(maxFrame,now-last);if(wasPlaying&&!video.paused)playingFrames.push(now-last);wasPlaying=!video.paused;last=now;raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);
 const log=(type:string,data:any={})=>{events.push({type,wallMs:Math.round(performance.now()-start),...data});output.textContent=JSON.stringify({events,maxFrameMs:Math.round(maxFrame)},null,2);};
 const observations:any[]=[];let observationsView=document.querySelector('#observations');
 if(!observationsView){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='说话人模型回归证据';observationsView=document.createElement('pre');observationsView.id='observations';details.append(summary,observationsView);document.body.append(details);}
 observationsView.textContent='[]';
 const transport=async(action:string,payload:Record<string,unknown>={})=>{if(action.startsWith('turn-')){const result=await turns.request(action,payload,'qa');if(action==='turn-analyze'){observations.push({positionMs:Math.round(video.currentTime*1000),offsetMs:payload.offsetMs,ended:payload.ended,...result});observationsView!.textContent=JSON.stringify(observations);}return result;}if(action==='warmup'){host.request('prepare',{},'qa');return {}; }return host.request(action,payload,'qa');};
 const adapter=new VideoAdapter(video,'demo:cafe');const speech=new LiveSpeech(adapter,transport,new RemoteTurnModel(transport));speech.useLanguage(document.querySelector<HTMLSelectElement>('#language')?.value);const controller=new AbortController();
 const abort=()=>controller.abort();document.querySelector('#stop')!.addEventListener('click',abort);
 let n=0;const captions:Promise<unknown>[]=[];
 try{
  await adapter.seek(0);
  while(adapter.position<adapter.duration-100&&!controller.signal.aborted){
   const boundary=await speech.detect(controller.signal,phase=>log('phase',{phase,positionMs:Math.round(adapter.position)}));
   if(!boundary)break;
   const detectedAt=adapter.position;
   log('sentence',{text:boundary.text,confidence:boundary.confidence,number:++n,startMs:boundary.startMs,endMs:boundary.endMs,detectedAtMs:Math.round(detectedAt),endpointDelayMs:Math.round(detectedAt-boundary.endMs)});
   const number=n;if(boundary.caption)captions.push(boundary.caption.then(caption=>log('caption',{number,caption:caption??null})));
   for(let repetition=1;repetition<=2;repetition++){
    await adapter.seek(boundary.startMs);await adapter.play();log('repeat-start',{number:n,repetition});
    await new Promise<void>((resolve,reject)=>{const poll=()=>{if(controller.signal.aborted){reject(controller.signal.reason);return;}if(adapter.position>=boundary.endMs||video.ended){resolve();return;}requestAnimationFrame(poll);};poll();});
    adapter.pause();log('repeat-end',{number:n,repetition,overshootMs:Math.round(adapter.position-boundary.endMs)});
   }
   await adapter.seek(boundary.endMs);
  }
  const sorted=playingFrames.sort((a,b)=>a-b);log('playback-complete',{playingFrameP95Ms:Math.round(sorted[Math.floor(sorted.length*.95)]??0),playingFrameMaxMs:Math.round(sorted.at(-1)??0),playingFramesOver100ms:sorted.filter(n=>n>100).length,sentences:n,durationMs:Math.round(adapter.duration),positionMs:Math.round(adapter.position),maxFrameMs:Math.round(maxFrame)});
  await Promise.all(captions);log('captions-settled');
 }catch(e){log('failed',{error:String(e)});}
 finally{cancelAnimationFrame(raf);speech.dispose();video.pause();document.querySelector('#stop')!.removeEventListener('click',abort);button.disabled=false;}
};
