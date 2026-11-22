import {LiveSpeech} from '../src/live-speech';
import {VideoAdapter} from '../src/player';
const button=document.querySelector<HTMLButtonElement>('#run')!,output=document.querySelector('#output')!,video=document.querySelector<HTMLVideoElement>('video')!;
button.onclick=async()=>{
 button.disabled=true;const events:any[]=[];let speech:LiveSpeech|undefined;
 const log=(name:string,data:Record<string,unknown>={})=>{events.push({name,...data});output.textContent=JSON.stringify(events,null,2);};
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);
 let duration=0,submitted=0,waitVerified=false;
 try{
  await video.play();video.currentTime=0;await new Promise<void>(r=>video.addEventListener('seeked',()=>r(),{once:true}));
  const adapter=new VideoAdapter(video,'demo:cafe');
  speech=new LiveSpeech(adapter,async(action,payload={})=>{
   if(action==='warmup')return {warming:false};
   if(action==='prepare'){if(!video.paused)throw Error('video ran during preparation');await new Promise(r=>setTimeout(r,800));log('preparation-paused',{position:video.currentTime});return {streaming:true};}
   if(action==='submit'){duration=Number(payload.durationMs);submitted++;log('submit',{paused:video.paused,position:video.currentTime,durationMs:duration});if(!video.paused)throw Error('speculative job while playing');return {id:'latency-fixture'};}
   if(action==='status'){const position=video.currentTime;await new Promise(r=>setTimeout(r,2000));if(Math.abs(video.currentTime-position)>.05)throw Error('video advanced during slow ASR');log('slow-asr-paused',{seconds:2});waitVerified=true;controller.abort();return {state:'running'};}
   return {};
  });
  const boundary=await speech.detect(controller.signal,phase=>log('phase',{phase,position:video.currentTime}));
  if(submitted!==1)throw Error('expected one closed-window decode');
  log('passed',{submitted,boundary,note:'Real media capture, VAD and speaker model; controlled 2-second ASR stub. Does not benchmark Whisper accuracy/speed.'});
 }catch(e){if(waitVerified&&submitted===1&&(e as Error).name==='AbortError')log('passed',{submitted,paused:video.paused,note:'Real capture/VAD/speaker models; delayed ASR stub; cancellation verified. Not a Whisper speed benchmark.'});else log('failed',{error:String(e)});}finally{clearTimeout(timer);speech?.dispose();video.pause();button.disabled=false;}
};
