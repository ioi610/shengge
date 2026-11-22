import {CorroboratedTurns} from './corroborated-turns';
import {speechBand} from './speech-band';
import * as ort from 'onnxruntime-web/wasm';
import {decodeSpeakerFrames,firstSpeakerTurn,closedSpeakerTurns,StableTurns,TurnDecision,SpeakerFrame} from './speaker-turns';
export interface TurnAnalyzer {analyze(samples:Float32Array,offsetMs:number,ended?:boolean):Promise<{decision:TurnDecision|undefined;frames:SpeakerFrame[];focusedFrames?:SpeakerFrame[]}>;dispose():void;}
export type TurnContext={samples:Float32Array;times:number[];origin:number;endMs:number;rate:number};
export type SpeakerWindow={startMs:number;endMs:number;ended:boolean;clockAligned:boolean};
export class TurnModel {
 private session:Promise<ort.InferenceSession>;private disposed=false;
 constructor(base:string){
  ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths=base;
  this.session=ort.InferenceSession.create(base+'speaker-turns.onnx',{executionProviders:['wasm'],graphOptimizationLevel:'all'});void this.session.catch(()=>{});
 }
 async analyze(samples:Float32Array,offsetMs:number,ended=false){
  const session=await this.session;if(this.disposed)throw new DOMException('已暂停','AbortError');
  const run=async(pcm:Float32Array,offset:number,actualEnd:number)=>{
   const input=new ort.Tensor('float32',pcm,[1,1,pcm.length]);
   try{const output=await session.run({x:input});try{const y=output.y;return decodeSpeakerFrames(y.data as Float32Array,Number(y.dims[1]),offset).filter(f=>f.atMs<=actualEnd);}finally{Object.values(output).forEach(t=>t.dispose());}}finally{input.dispose();}
  };
  const end=offsetMs+samples.length/16,frames=await run(samples,offsetMs,end);
  // Preserve the original detector. The independent voice-band view reduces
  // low-frequency backing music without discarding the sentence's context or
  // waiting six seconds to start. Its evidence never votes for the raw path.
  const focusedFrames=await run(speechBand(samples),offsetMs,end);
  return {decision:firstSpeakerTurn(frames,end,ended),frames,focusedFrames};
 }
 dispose(){this.disposed=true;void this.session.then(s=>s.release()).catch(()=>{});}
}
export class StreamingTurns {
 private samples:number[]=[];private mediaTimes:number[]=[];private startedAt?:number;private lastRun=0;private busy=false;private stable=new StableTurns();private corroborated=new CorroboratedTurns();private stopped=false;private ignoredBefore=0;
 private prefixMs=0;private bufferOrigin:number;
 constructor(private model:TurnAnalyzer,private origin:number,private rate:number,private accept:(t:TurnDecision)=>void,private error:(e:Error)=>void,private speechStart?:(ms:number)=>void,private observe?:(frames:SpeakerFrame[],focused?:boolean,window?:SpeakerWindow)=>void,context?:TurnContext){
  this.bufferOrigin=origin;
  if(context&&context.rate===rate&&Math.abs(context.endMs-origin)<=150&&context.samples.length===context.times.length*512&&context.times.length<=312){
   this.samples=Array.from(context.samples);this.mediaTimes=[...context.times];this.prefixMs=context.samples.length/16;this.ignoredBefore=this.prefixMs;this.lastRun=context.samples.length;this.bufferOrigin=context.origin;
  }
 }
 /** Carry only audio preceding an accepted boundary, never the later look-ahead
  * or a replay. This keeps neighbouring searches in the same detector context. */
 contextThrough(endMs:number):TurnContext|undefined{
  const after=this.mediaTimes.findIndex(t=>t>endMs),end=after<0?this.mediaTimes.length:after,start=Math.max(0,end-312);
  if(end<=start)return;
  return {samples:Float32Array.from(this.samples.slice(start*512,end*512)),times:this.mediaTimes.slice(start,end),origin:start>0?this.mediaTimes[start-1]:this.bufferOrigin,endMs,rate:this.rate};
 }
 push(frame:Float32Array,mediaTime:number){
  if(this.stopped)return;for(const x of frame)this.samples.push(x);this.mediaTimes.push(mediaTime);
  if(this.samples.length-this.lastRun<4096||this.busy)return;this.lastRun=this.samples.length;void this.run();
 }
 /** A reviewed/rejected old candidate must not monopolize the rolling window. */
 ignoreBefore(mediaMs:number){
  const i=this.mediaTimes.findIndex(t=>t>=mediaMs);if(i<0)return;
  this.ignoredBefore=Math.max(this.ignoredBefore,(i+1)*32);this.stable=new StableTurns();this.corroborated.discardBefore(this.ignoredBefore);this.startedAt=undefined;
 }
 private async run(ended=false){
  if(this.stopped||this.busy||this.samples.length<16000)return;this.busy=true;
  const start=Math.max(0,this.samples.length-160000),pcm=Float32Array.from(this.samples.slice(start));
  try{const {decision,frames,focusedFrames}=await this.model.analyze(pcm,start/16,ended);if(this.stopped)return;
   const currentFrames=(frames:SpeakerFrame[])=>frames.filter(f=>f.atMs>=this.prefixMs).map(f=>({...f,atMs:f.atMs-this.prefixMs}));
   const firstFrame=Math.floor(start/512),lastFrame=Math.ceil((start+pcm.length)/512);
   // Old frame observers use the continuous PCM clock. Do not authorize late
   // printed-line evidence if a native media correction broke that mapping,
   // even when the correction itself has already rolled out of this window.
   const clockAligned=this.mediaTimes.slice(firstFrame,lastFrame).every((time,i)=>
    Math.abs(time-(this.origin+((firstFrame+i+1)*32-this.prefixMs)*this.rate))<=96);
   const window={startMs:this.toMedia(start/16),endMs:this.toMedia((start+pcm.length)/16),ended,clockAligned};
   this.observe?.(currentFrames(frames),false,window);if(focusedFrames)this.observe?.(currentFrames(focusedFrames),true,window);
   const eligible=frames.filter(f=>f.atMs>=this.ignoredBefore);
   const first=eligible.find((f,i)=>f.speaker>=0&&f.confidence>=.7&&eligible.slice(i,i+3).length===3&&eligible.slice(i,i+3).every(next=>next.speaker===f.speaker&&next.confidence>=.7));
   // A rolled window with a real leading pause belongs to a new utterance.
   // Carrying an old tail's onset forever made later dialogue look like music.
   if(first&&(this.startedAt===undefined||this.startedAt<start/16&&first.atMs-start/16>=950)){this.startedAt=Math.max(0,first.atMs-200);this.speechStart?.(Math.max(0,this.startedAt-this.prefixMs));}
   const current=this.ignoredBefore?firstSpeakerTurn(eligible,start/16+pcm.length/16,ended):decision;
   for(const accepted of [...this.stable.accept(closedSpeakerTurns(eligible,start/16+pcm.length/16,ended,current)),...(focusedFrames?this.corroborated.observe(focusedFrames.filter(f=>f.atMs>=this.ignoredBefore),start/16+pcm.length/16,ended).map(t=>({...t,focused:true})):[])].filter(t=>t.endMs>this.ignoredBefore)){
    if(this.stopped)break;
    // Only carry an onset across a rolling window when voice starts at its
    // leading edge. A new in-window turn must not inherit an older rejected
    // tail, or even end up with a start after its own end.
    const startMs=this.startedAt!==undefined&&this.startedAt<start/16&&accepted.startMs<=start/16+320?Math.min(this.startedAt,accepted.startMs):accepted.startMs;
    if(startMs<accepted.endMs)this.accept({...accepted,startMs:this.toMedia(startMs),endMs:this.toMedia(accepted.endMs),...(accepted.leadingStartMs!==undefined?{leadingStartMs:this.toMedia(accepted.leadingStartMs)}:{})});
   }
  }catch(e){if(!this.stopped)this.error(e as Error);}finally{this.busy=false;}
 }
 private toMedia(ms:number){const frame=ms/32;const i=Math.floor(frame);const before=i===0?this.bufferOrigin:this.mediaTimes[Math.min(i-1,this.mediaTimes.length-1)];const after=this.mediaTimes[Math.min(i,this.mediaTimes.length-1)];return Math.round(before+(after-before)*(frame-i));}
 /** Flush current evidence without pretending the still-playing media ended. */
 async flush(){while(this.busy&&!this.stopped)await new Promise(r=>setTimeout(r,10));await this.run(false);}
 async finish(){while(this.busy&&!this.stopped)await new Promise(r=>setTimeout(r,10));await this.run(true);await this.run(true);}
 stop(){this.stopped=true;this.samples=[];}
}
