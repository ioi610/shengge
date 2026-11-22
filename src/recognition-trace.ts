import type {SpeakerFrame} from './speaker-turns';
import {ResumeRecognition} from './recognition-resume';
import {languageCode} from './source-language';
import type {Transcript} from './background-captions';
type Decision={kind:string;startMs:number;endMs:number;position:number;wallElapsedMs:number};
type VisualCheckOutcome='matched'|'no-result'|'language-unavailable'|'non-japanese'|'empty-result'|'low-confidence'|'text-mismatch'|'window-cancelled'|'invalid-window'|'request-rejected';
type VisualCheckSkip='busy'|'cooldown'|'non-japanese-source'|'insufficient-samples'|'low-peak-audio';
type VisualCheck={id:number;startMs:number;endMs:number;position:number;observedWallElapsedMs:number;requestedWallElapsedMs?:number;completedWallElapsedMs?:number;audioDurationMs?:number;outcome?:VisualCheckOutcome;notRequested?:VisualCheckSkip};
/** undefined combines timeout, queue rejection, cancellation and transport
 * failure: BackgroundCaptions does not expose which one occurred. */
export function visualCheckOutcome(result:Transcript|undefined,matched:boolean):VisualCheckOutcome{
 if(matched)return 'matched';
 if(!result)return 'no-result';
 const language=languageCode(result.language);
 if(!language)return 'language-unavailable';
 if(language!=='ja')return 'non-japanese';
 if(!result.segments.length)return 'empty-result';
 if(!result.segments.some(row=>(row.confidence??0)>=.6))return 'low-confidence';
 return 'text-mismatch';
}

/** Bounded local evidence for intermittent misses. No PCM, URL or transcript. */
export class RecognitionTrace {
 private audio:number[][]=[];private observations:{position:number;frames:number[][];focused?:true}[]=[];
 private decisions:Decision[]=[];private reviewHolds:Decision[]=[];private corrections:Decision[]=[];
 private correctionCount=0;private reviewHoldAt?:number;private reviewPausedMs=0;private reviewHoldCount=0;private reviewResumeCount=0;
 private wallStartedAt=performance.now();
 private visualCounts={reads:0,lines:0,accepted:0,audioChecks:0};
 private visualChecks:VisualCheck[]=[];private visualCheckCount=0;
 visual(event:keyof typeof this.visualCounts){this.visualCounts[event]++;}
 private visualCheck(turn:{startMs:number;endMs:number},position:number){
  if(this.emitted)return;
  const id=++this.visualCheckCount;if(this.visualChecks.length>=32)return;
  const check:VisualCheck={id,startMs:Math.round(turn.startMs-this.origin),endMs:Math.round(turn.endMs-this.origin),position:Math.round(position-this.origin),observedWallElapsedMs:Math.round(performance.now()-this.wallStartedAt)};
  this.visualChecks.push(check);return check;
 }
 startVisualCheck(turn:{startMs:number;endMs:number},position:number,audioDurationMs:number){
  const check=this.visualCheck(turn,position);if(!check)return;
  // Request time includes the existing decoder queue, preparation and work;
  // it is deliberately not described as native inference start time.
  check.requestedWallElapsedMs=check.observedWallElapsedMs;check.audioDurationMs=Math.round(audioDurationMs);return check.id;
 }
 skipVisualCheck(turn:{startMs:number;endMs:number},position:number,reason:VisualCheckSkip){
  const check=this.visualCheck(turn,position);if(check)check.notRequested=reason;
 }
 finishVisualCheck(id:number|undefined,outcome:VisualCheckOutcome){
  if(this.emitted||id===undefined)return;
  const check=this.visualChecks.find(item=>item.id===id);
  if(!check||check.outcome||check.notRequested)return;
  check.completedWallElapsedMs=Math.round(performance.now()-this.wallStartedAt);check.outcome=outcome;
 }
 private emitted=false;
 constructor(private origin:number,private write:(value:unknown)=>void=value=>console.debug('[声格分句诊断]',JSON.stringify(value))){}
 frame(probability:number,pcm:Float32Array,time:number){
  if(this.audio.length>=220||time-this.origin>7000)return;
  let energy=0;for(const x of pcm)energy+=x*x;
  this.audio.push([Math.round(time-this.origin),Math.round(probability*1000),Math.round(Math.sqrt(energy/Math.max(1,pcm.length))*100000)]);
 }
 observe(frames:SpeakerFrame[],position:number,focused=false){
  if(this.observations.filter(o=>!!o.focused===focused).length>=24||position-this.origin>7000)return;
  this.observations.push({position:Math.round(position-this.origin),frames:frames.slice(0,450).map(f=>[Math.round(f.atMs),f.speaker,Math.round(f.confidence*1000)]),...(focused?{focused:true as const}:{})});
 }
 decision(kind:string,turn:{startMs:number;endMs:number},position:number){
  const now=performance.now();
  const decision={kind,startMs:Math.round(turn.startMs-this.origin),endMs:Math.round(turn.endMs-this.origin),position:Math.round(position-this.origin),wallElapsedMs:Math.round(now-this.wallStartedAt)};
  if(this.decisions.length<32)this.decisions.push(decision);
  // Detailed events have independent bounded budgets. Totals must survive a
  // noisy window exhausting those budgets, or long pauses and native clock
  // corrections would silently disappear from whole-video measurements.
  if(kind==='clock-correction'){this.correctionCount++;if(this.corrections.length<32)this.corrections.push(decision);}
  if(kind==='review-hold'||kind==='review-resume'){
   if(this.reviewHolds.length<32)this.reviewHolds.push(decision);
   if(kind==='review-hold'&&this.reviewHoldAt===undefined){this.reviewHoldAt=now;this.reviewHoldCount++;}
   if(kind==='review-resume'&&this.reviewHoldAt!==undefined){this.reviewPausedMs+=Math.max(0,now-this.reviewHoldAt);this.reviewHoldAt=undefined;this.reviewResumeCount++;}
  }
 }
 finish(position:number,boundary?:{startMs:number;endMs:number},error?:Error){
  if(this.emitted)return;
  for(const check of this.visualChecks)if(check.requestedWallElapsedMs!==undefined&&!check.outcome)this.finishVisualCheck(check.id,'window-cancelled');
  this.emitted=true;
  const suspicious=!boundary||boundary.startMs-this.origin>6000||position-boundary.endMs>2500;
  const now=performance.now(),openAtFinish=this.reviewHoldAt!==undefined;
  const pausedMs=this.reviewPausedMs+(openAtFinish?Math.max(0,now-this.reviewHoldAt!):0);
  this.write({version:1,...(this.visualCounts.reads?{visual:this.visualCounts}:{}),origin:Math.round(this.origin),position:Math.round(position),wallStartedAt:this.wallStartedAt,wallElapsedMs:Math.round(now-this.wallStartedAt),boundary:boundary?{startMs:Math.round(boundary.startMs),endMs:Math.round(boundary.endMs)}:undefined,error:error?.name,
   ...(error instanceof ResumeRecognition?{recovery:{reason:error.reason,target:Math.round(error.rewindTo)}}:{}),
   ...(this.visualCheckCount?{visualChecks:this.visualChecks.map(check=>({...check})),visualCheckCount:this.visualCheckCount}:{}),
   ...(this.correctionCount?{corrections:this.corrections,correctionCount:this.correctionCount}:{}),
   ...(this.reviewHolds.length?{reviewHolds:this.reviewHolds,reviewTiming:{holds:this.reviewHoldCount,resumes:this.reviewResumeCount,wallPausedMs:Math.round(pausedMs),openAtFinish}}:{}),
   ...(suspicious?{audio:this.audio,observations:this.observations,decisions:this.decisions}:{})});
 }
}
