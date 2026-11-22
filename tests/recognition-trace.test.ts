import test from 'node:test';import assert from 'node:assert/strict';
import {RecognitionTrace,visualCheckOutcome} from '../src/recognition-trace';
import type {Transcript} from '../src/background-captions';
test('suspicious trace is bounded, emitted once, and excludes PCM and transcript fields',()=>{
 const out:any[]=[];const trace=new RecognitionTrace(1000,v=>out.push(v));
 for(let i=0;i<1000;i++){trace.frame(.5,new Float32Array([.25,-.25]),1000+i);trace.observe(Array.from({length:600},(_,j)=>({atMs:j*16,speaker:0,confidence:.8})),1000+i);trace.decision('review-rejected',{startMs:1100,endMs:1200},2000);}
 const boundary={startMs:10000,endMs:11000,text:'PRIVATE TRANSCRIPT',caption:Promise.resolve('PRIVATE CAPTION'),language:'japanese'};trace.finish(12000,boundary);trace.finish(13000);
 assert.equal(out.length,1);assert.equal(out[0].audio.length,220);assert.equal(out[0].observations.length,24);assert.equal(out[0].observations[0].frames.length,450);assert.equal(out[0].decisions.length,32);
 assert.deepEqual(out[0].audio[0],[0,500,25000]);assert.deepEqual(out[0].boundary,{startMs:10000,endMs:11000});assert(!JSON.stringify(out).includes('PRIVATE'));assert(JSON.stringify(out).length<250000);
});
test('normal fast boundary writes only timing summary, not detailed observations',()=>{
 let out:any;const trace=new RecognitionTrace(1000,v=>out=v);trace.frame(.9,new Float32Array([.25]),1100);trace.finish(3000,{startMs:1200,endMs:2500});assert.equal(out.audio,undefined);assert.equal(out.observations,undefined);assert.equal(out.decisions,undefined);
});

test('raw and filtered observations have independent bounded diagnostic budgets',()=>{
 let out:any;const trace=new RecognitionTrace(0,v=>out=v);
 const frames=[{atMs:100,speaker:0,confidence:.9}];
 for(let i=0;i<40;i++){trace.observe(frames,100+i*128);trace.observe(frames,100+i*128,true);}
 trace.finish(6000);
 assert.equal(out.observations.filter((o:any)=>!o.focused).length,24);
 assert.equal(out.observations.filter((o:any)=>o.focused).length,24);
});

test('review holds retain wall-clock evidence even when the media boundary looks fast',t=>{
 let now=1000;t.mock.method(performance,'now',()=>now);
 let out:any;const trace=new RecognitionTrace(1000,v=>out=v);
 now=3000;trace.decision('review-hold',{startMs:1200,endMs:2200},2500);
 now=11000;trace.finish(2500,{startMs:1200,endMs:2200});
 assert.equal(out.wallStartedAt,1000);assert.equal(out.wallElapsedMs,10000);
 assert.equal(out.position-out.boundary.endMs,300);
 assert.equal(out.reviewHolds[0].wallElapsedMs,2000);
 assert.equal(out.reviewHolds[0].kind,'review-hold');
});

test('exhausted decision details do not hide a later review pause or native clock correction',t=>{
 let now=1000;t.mock.method(performance,'now',()=>now);
 let out:any;const trace=new RecognitionTrace(1000,v=>out=v);
 for(let i=0;i<32;i++)trace.decision('review-rejected',{startMs:1100,endMs:1200},2000);
 now=3000;trace.decision('review-hold',{startMs:1200,endMs:2200},2500);
 now=11000;trace.decision('review-resume',{startMs:2500,endMs:2500},2500);
 now=11200;trace.decision('clock-correction',{startMs:2500,endMs:2700},2700);
 now=12000;trace.finish(2800,{startMs:1200,endMs:2400});
 assert.equal(out.decisions,undefined,'normal media timing still omits verbose decision details');
 assert.deepEqual(out.reviewHolds.map((d:any)=>d.kind),['review-hold','review-resume']);
 assert.deepEqual(out.reviewTiming,{holds:1,resumes:1,wallPausedMs:8000,openAtFinish:false});
 assert.equal(out.correctionCount,1);assert.equal(out.corrections[0].wallElapsedMs,10200);
});

test('review totals remain complete beyond their bounded event details, including a final open pause',t=>{
 let now=0;t.mock.method(performance,'now',()=>now);
 let out:any;const trace=new RecognitionTrace(0,v=>out=v);
 for(let i=0;i<40;i++){
  now=i*1000;trace.decision('review-hold',{startMs:100,endMs:200},300);
  now+=600;trace.decision('review-resume',{startMs:300,endMs:300},300);
  trace.decision('clock-correction',{startMs:300,endMs:400},400);
 }
 now=40000;trace.decision('review-hold',{startMs:100,endMs:200},300);
 now=42500;trace.finish(400);
 assert.equal(out.decisions.length,32);assert.equal(out.reviewHolds.length,32);
 assert.equal(out.corrections.length,32);assert.equal(out.correctionCount,40);
 assert.deepEqual(out.reviewTiming,{holds:41,resumes:40,wallPausedMs:26500,openAtFinish:true});
});

test('repeated hold or resume notifications cannot double-count paused wall time',t=>{
 let now=0;t.mock.method(performance,'now',()=>now);
 let out:any;const trace=new RecognitionTrace(0,v=>out=v);
 const event=(kind:string,at:number)=>{now=at;trace.decision(kind,{startMs:0,endMs:100},100);};
 event('review-resume',100);event('review-hold',200);event('review-hold',400);
 event('review-resume',1000);event('review-resume',1200);now=1400;trace.finish(100);
 assert.deepEqual(out.reviewTiming,{holds:1,resumes:1,wallPausedMs:800,openAtFinish:false});
});

test('visual results distinguish only outcomes exposed by the existing transcript interface',()=>{
 const row={text:'PRIVATE TRANSCRIPT',startMs:0,endMs:1000,confidence:.9};
 const outcome=(language:string|undefined,segments:Transcript['segments'])=>visualCheckOutcome({language,segments},false);
 assert.equal(visualCheckOutcome(undefined,false),'no-result','undefined is not specifically a timeout');
 assert.equal(outcome(undefined,[row]),'language-unavailable');
 assert.equal(outcome('english',[row]),'non-japanese');
 assert.equal(outcome('japanese',[]),'empty-result');
 assert.equal(outcome('japanese',[{...row,confidence:.59}]),'low-confidence');
 assert.equal(outcome('japanese',[{...row,confidence:undefined}]),'low-confidence');
 assert.equal(outcome('japanese',[row]),'text-mismatch');
 assert.equal(visualCheckOutcome({language:'ja',segments:[row]},true),'matched');
});

test('visual checks retain actual printed intervals and request/completion wall times beyond the audio trace limit',t=>{
 let now=100;t.mock.method(performance,'now',()=>now);
 let out:any;const trace=new RecognitionTrace(200689,v=>out=v);
 now=16100;const id=trace.startVisualCheck({startMs:214000,endMs:215600},216000,1632);
 now=22600;trace.finishVisualCheck(id,'no-result');
 trace.finish(222500,{startMs:216635,endMs:218700});
 assert.deepEqual(out.visualChecks,[{id:1,startMs:13311,endMs:14911,position:15311,observedWallElapsedMs:16000,requestedWallElapsedMs:16000,audioDurationMs:1632,completedWallElapsedMs:22500,outcome:'no-result'}]);
 assert.equal(out.visualCheckCount,1);
 assert.equal(out.visualChecks[0].nativeStartedAt,undefined,'request time must not pretend to measure decoder queue or inference separately');
});

test('overlapping checks remain associated with their own line when results complete out of order',t=>{
 let now=0;t.mock.method(performance,'now',()=>now);
 let out:any;const trace=new RecognitionTrace(1000,v=>out=v);
 const first=trace.startVisualCheck({startMs:1100,endMs:1400},1600,512);
 now=200;const second=trace.startVisualCheck({startMs:1800,endMs:2200},2400,640);
 now=500;trace.finishVisualCheck(second,'text-mismatch');
 now=900;trace.finishVisualCheck(first,'matched');trace.finishVisualCheck(first,'no-result');
 trace.finish(2400,{startMs:1100,endMs:1400});
 assert.deepEqual(out.visualChecks.map((c:any)=>[c.id,c.startMs,c.outcome,c.completedWallElapsedMs]),[[1,100,'matched',900],[2,800,'text-mismatch',500]]);
});

test('closing a window finalizes pending checks once and late completion cannot mutate emitted diagnostics',t=>{
 let now=0;t.mock.method(performance,'now',()=>now);
 const outputs:any[]=[];const trace=new RecognitionTrace(0,v=>outputs.push(v));
 const first=trace.startVisualCheck({startMs:100,endMs:400},600,512);
 trace.skipVisualCheck({startMs:800,endMs:1200},1400,'busy');
 now=1800;trace.finish(1600,undefined,new DOMException('PRIVATE ERROR','AbortError'));
 const snapshot=JSON.stringify(outputs);
 now=9000;trace.finishVisualCheck(first,'matched');trace.startVisualCheck({startMs:2000,endMs:2400},2600,512);trace.finish(2600);
 assert.equal(JSON.stringify(outputs),snapshot);assert.equal(outputs.length,1);
 assert.deepEqual(outputs[0].visualChecks.map((c:any)=>[c.outcome,c.notRequested,c.completedWallElapsedMs]),[['window-cancelled',undefined,1800],[undefined,'busy',undefined]]);
 assert(!snapshot.includes('PRIVATE ERROR'));
});

test('visual diagnostics have an independent bounded budget and do not copy text, URL or PCM',()=>{
 let out:any;const trace=new RecognitionTrace(0,v=>out=v);
 const turn={startMs:100,endMs:200,text:'PRIVATE PRINT',reference:'PRIVATE TRANSLATION',url:'https://private.test',pcm:new Float32Array([.12345])};
 for(let i=0;i<50;i++){
  if(i%2)trace.skipVisualCheck(turn,300,'cooldown');
  else {const id=trace.startVisualCheck(turn,300,512);trace.finishVisualCheck(id,'text-mismatch');}
 }
 trace.finish(300,{startMs:100,endMs:200});
 assert.equal(out.visualChecks.length,32);assert.equal(out.visualCheckCount,50);
 assert.equal(out.audio,undefined,'normal fast windows still keep only the small visual summaries');
 const json=JSON.stringify(out);assert(!json.includes('PRIVATE'));assert(!json.includes('private.test'));assert(!json.includes('0.12345'));assert(json.length<10000);
});
