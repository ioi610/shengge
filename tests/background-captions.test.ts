import test from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundCaptions} from '../src/background-captions';
import {StreamingSentences} from '../src/streaming-sentences';

test('acoustic boundary requires corroboration at the beginning, without any ASR job',()=>{
 let submits=0;const s=new StreamingSentences(10000,()=>{},()=>{},async()=>{submits++;return {};},undefined,true);
 for(let i=0;i<100;i++)s.push(new Float32Array(512).fill(.1),10000+(i+1)*32,i>=20&&i<60?.95:0);
 const turn={startMs:10500,endMs:12000};
 const frames=Array.from({length:190},(_,i)=>({atMs:i*16.875,speaker:i*16.875>=640&&i*16.875<1920?0:-1,confidence:.95}));
 s.observeSpeech(frames);assert.equal(s.acousticBoundary(turn),undefined);
 s.observeSpeech(frames);const b=s.acousticBoundary(turn);assert(b);assert(b.startMs<=10500);assert(b.endMs>=12000&&b.endMs<12600);assert.equal(submits,0);assert(s.audioFor(b).length<51200);s.stop();
});
test('VAD music false positives and later speech never justify dropping a weak first word',()=>{
 const s=new StreamingSentences(0,()=>{},()=>{},async()=>({}),undefined,true);
 for(let i=0;i<100;i++)s.push(new Float32Array(512),(i+1)*32,.95);
 assert.equal(s.acousticBoundary({startMs:0,endMs:2800}),undefined);
 const frames=Array.from({length:190},(_,i)=>({atMs:i*16.875,speaker:i*16.875>1800?0:-1,confidence:.95}));
 s.observeSpeech(frames);s.observeSpeech(frames);assert.equal(s.acousticBoundary({startMs:0,endMs:2800}),undefined);s.stop();
});
test('caption queue is bounded and failures do not prevent a later sentence',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let submitted=0;
 const q=new BackgroundCaptions(async action=>{
  if(action==='prepare'){await gate;return {streaming:true};}
  if(action==='submit')return {id:String(++submitted)};
  if(action==='status')return {state:'done',result:{language:'ja',segments:[{startMs:0,endMs:600,text:'こんにちは。',confidence:.9}]}};
  return {};
 });
 const first=q.enqueue(new Float32Array(16000)),obsolete=q.enqueue(new Float32Array(16000)),latest=q.enqueue(new Float32Array(16000));
 release();assert.equal((await obsolete)?.text,'こんにちは。');assert.equal((await first)?.text,'こんにちは。');assert.equal((await latest)?.text,'こんにちは。');assert.equal(submitted,3);q.dispose();
 const failed=new BackgroundCaptions(async()=>{throw Error('GPU unavailable');});assert.equal(await failed.enqueue(new Float32Array(16000)),undefined);failed.dispose();
});
test('disposed and weak caption jobs cannot publish a fabricated subtitle',async()=>{
 const q=new BackgroundCaptions(async action=>action==='prepare'?{streaming:true}:action==='submit'?{id:'a'}:action==='status'?{state:'done',result:{segments:[{startMs:0,endMs:500,text:'hallucination',confidence:.2}]}}:{});
 assert.equal(await q.enqueue(new Float32Array(16000)),undefined);q.dispose();assert.equal(await q.enqueue(new Float32Array(16000)),undefined);
});
test('quiet suffixes extend a pause boundary, while a speaker change remains bounded',()=>{
 const s=new StreamingSentences(0,()=>{},()=>{},async()=>({}),undefined,true);
 for(let i=0;i<100;i++)s.push(new Float32Array(512).fill(.1),(i+1)*32,i>=6&&i<32?.95:0);
 const frames=Array.from({length:190},(_,i)=>{const atMs=i*16.875;return {atMs,speaker:atMs>=200&&atMs<1600?0:-1,confidence:atMs<1000?.95:.65};});s.observeSpeech(frames);s.observeSpeech(frames);
 const turn={startMs:100,endMs:1050};const pause=s.acousticBoundary({...turn,reason:'turn-end'});assert(pause);assert(pause.endMs>=1800&&pause.endMs<=2300);
 const change=s.acousticBoundary({...turn,reason:'speaker-change'});assert.equal(change?.endMs,1050);s.stop();
});
test('real end of media may close voiced audio without waiting for future silence',()=>{
 const s=new StreamingSentences(0,()=>{},()=>{},async()=>({}),undefined,true);for(let i=0;i<30;i++)s.push(new Float32Array(512).fill(.1),(i+1)*32,.95);
 const frames=Array.from({length:56},(_,i)=>({atMs:i*16.875,speaker:0,confidence:.95}));s.observeSpeech(frames);s.observeSpeech(frames);
 const turn={startMs:0,endMs:960,reason:'turn-end' as const};assert.equal(s.acousticBoundary(turn),undefined);assert(s.acousticBoundary(turn,true));s.stop();
});
test('zero-duration invented words at EOF cannot become a confident caption',async()=>{
 const q=new BackgroundCaptions(async action=>action==='prepare'?{streaming:true}:action==='submit'?{id:'a'}:action==='status'?{state:'done',result:{segments:[{startMs:100,endMs:1000,text:'Hello invented ending.',confidence:.9,words:[{startMs:100,endMs:500,text:'Hello'},{startMs:1000,endMs:1000,text:'invented ending'}]}]}}:{});
 assert.equal(await q.enqueue(new Float32Array(16000)),undefined);q.dispose();
});

test('a timed-out review cancels its decoder job and allows the next request',async()=>{
 const cancelled:string[]=[];let submitted=0;
 const q=new BackgroundCaptions(async(action,payload)=>{
  if(action==='prepare')return {streaming:true};
  if(action==='submit')return {id:String(++submitted)};
  if(action==='status')return payload?.id==='1'?{state:'running'}:{state:'done',result:{segments:[]}};
  if(action==='cancel')cancelled.push(String(payload?.id));return {};
 });
 assert.equal(await q.transcribe(new Float32Array(16000),undefined,10),undefined);assert.deepEqual(cancelled,['1']);
 assert.deepEqual(await q.transcribe(new Float32Array(16000)),{segments:[],language:undefined});q.dispose();
});

test('uncertain dialogue review preempts an optional subtitle instead of waiting behind it',async()=>{
 let submitted=0;const cancelled:string[]=[];
 const q=new BackgroundCaptions(async(action,payload)=>{
  if(action==='prepare')return {streaming:true};if(action==='submit')return {id:String(++submitted)};
  if(action==='status')return payload?.id==='1'?{state:'running'}:{state:'done',result:{segments:[]}};
  if(action==='cancel')cancelled.push(String(payload?.id));return {};
 });
 const caption=q.enqueue(new Float32Array(16000));await new Promise(r=>setImmediate(r));
 const review=q.transcribe(new Float32Array(16000));assert.deepEqual(await review,{segments:[],language:undefined});await caption;assert(cancelled.includes('1'));assert.equal(submitted,3,'preempted caption was retried after priority review');q.dispose();
});

test('a fast decision cancels its obsolete review so the next sentence does not queue behind it',async()=>{
 let submitted=0;const cancelled:string[]=[];
 const q=new BackgroundCaptions(async(action,payload)=>{
  if(action==='prepare')return {streaming:true};if(action==='submit')return {id:String(++submitted)};
  if(action==='status')return payload?.id==='1'?{state:'running'}:{state:'done',result:{segments:[]}};
  if(action==='cancel')cancelled.push(String(payload?.id));return {};
 });
 const obsolete=q.transcribe(new Float32Array(16000));await new Promise(r=>setImmediate(r));q.cancelReview();
 const next=q.transcribe(new Float32Array(16000));assert.equal(await obsolete,undefined);assert.deepEqual(await next,{segments:[],language:undefined});assert(cancelled.includes('1'));q.dispose();
});

test('caption-only quiet lead-in preserves audio samples and restores original word times',async()=>{
 let review=false;const q=new BackgroundCaptions(async(action,payload)=>{
  if(action==='prepare')return {streaming:true};
  if(action==='submit'){
   const bytes=Uint8Array.from(atob(String(payload?.audio)),c=>c.charCodeAt(0)),view=new DataView(bytes.buffer);
   assert.equal(payload?.durationMs,review?1000:1160);assert.equal(view.getInt16(44,true),review?8192:0);if(!review)assert.equal(view.getInt16(44+2560*2,true),8192);return {id:'padded'};
  }
  if(action==='status')return {state:'done',result:{language:'ja',segments:[{startMs:160,endMs:960,text:'原文',confidence:.9,words:[{startMs:160,endMs:960,text:'原文'}]}]}};
  return {};
 });
 const padded=await q.transcribe(new Float32Array(16000).fill(.25),'ja',30000,false);assert.equal(padded?.segments[0].startMs,0);assert.equal(padded?.segments[0].endMs,800);assert.equal(padded?.segments[0].words?.[0].startMs,0);
 review=true;const unchanged=await q.transcribe(new Float32Array(16000).fill(.25),'ja');assert.equal(unchanged?.segments[0].startMs,160);q.dispose();
});
test('quiet lead-in text is excluded while invalid word durations remain invalid',async()=>{
 const {unpadCaption}=await import('../src/background-captions');
 const shifted=unpadCaption({segments:[{startMs:0,endMs:700,text:'paddingreal',words:[{startMs:0,endMs:100,text:'padding'},{startMs:200,endMs:700,text:'real'}]},{startMs:0,endMs:100,text:'fake'}]},160);
 assert.equal(shifted.segments.length,1);assert.equal(shifted.segments[0].text,'real');assert.equal(shifted.segments[0].words?.[0].startMs,40);
 const invalid=unpadCaption({segments:[{startMs:200,endMs:900,text:'invalid',words:[{startMs:700,endMs:700,text:'invalid'}]}]},160);assert.equal(invalid.segments[0].words?.[0].endMs,invalid.segments[0].words?.[0].startMs);
});

test('long captions and automatic language probes keep their original decoder input',async()=>{
 let expected=5000;const q=new BackgroundCaptions(async(action,payload)=>{
  if(action==='prepare')return {streaming:true};if(action==='submit'){assert.equal(payload?.durationMs,expected);return {id:'unchanged'};}
  if(action==='status')return {state:'done',result:{segments:[{startMs:200,endMs:800,text:'words',confidence:.9}]}};return {};
 });
 assert.equal((await q.transcribe(new Float32Array(80000),'ja',30000,false))?.segments[0].startMs,200);
 expected=2000;assert.equal((await q.transcribe(new Float32Array(32000),undefined,30000,false))?.segments[0].startMs,200);q.dispose();
});
