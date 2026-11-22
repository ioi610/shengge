import test from 'node:test';
import assert from 'node:assert/strict';
import {PendingTurns} from '../src/pending-turns';
import {closedSpeakerTurns,firstSpeakerTurn,StableTurns} from '../src/speaker-turns';

test('actual 4:58 overlapping candidates do not accumulate repeated eight-second reviews',()=>{
 const q=new PendingTurns();
 q.add({startMs:904,endMs:1549});q.add({startMs:2388,endMs:5260});q.add({startMs:5640,endMs:8648});q.add({startMs:6395,endMs:8730});
 q.discardReviewed({startMs:454,endMs:1360});assert.equal(q.shift()?.startMs,2388);assert.equal(q.first?.startMs,5640);
 q.discardReviewed(q.shift()!);assert.equal(q.first,undefined);
});

test('review deduplication preserves adjacent short replies and meaningfully longer endings',()=>{
 const q=new PendingTurns();q.add({startMs:2010,endMs:2250});q.add({startMs:1100,endMs:2500});q.add({startMs:4000,endMs:4800});
 q.discardReviewed({startMs:1000,endMs:2000});assert.equal(q.shift()?.endMs,2500);assert.equal(q.shift()?.startMs,2010);assert.equal(q.shift()?.startMs,4000);
});

test('a rejected early sound cannot replace a pending quiet utterance with a later clear reply',()=>{
 const q=new PendingTurns();
 q.add({startMs:400000,endMs:402000}); // later clear reply arrives first
 q.add({startMs:391700,endMs:392700}); // quiet line still needs review
 q.add({startMs:388000,endMs:388700});
 assert.equal(q.shift()?.startMs,388000);
 q.add({startMs:391750,endMs:392650}); // refined estimate, not another sentence
 q.discardThrough(388700);
 assert.equal(q.shift()?.startMs,391750);
 assert.equal(q.shift()?.startMs,400000);
 assert.equal(q.first,undefined);
});

test('real 6:33 model frames expose the quiet sentence before the old sound leaves the window',async()=>{
 const {readFile}=await import('node:fs/promises'),{gunzipSync}=await import('node:zlib');
 const data=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/bilibili-eyes-turns.json.gz',import.meta.url))).toString());
 const stable=new StableTurns();let found=false;
 for(const o of data.observations){
  const first=firstSpeakerTurn(o.frames,o.at);
  assert(!first||first.endMs<7000,'old first-only output is an earlier sound');
  const accepted=stable.accept(closedSpeakerTurns(o.frames,o.at));
  if(accepted.some(t=>t.startMs>7000&&t.startMs<8000&&t.endMs>7800))found=true;
 }
 assert(found,'6:33 must be available by 394.484s, without waiting until 401.908s');
});

test('moderate voice needs six advancing windows; duplicates or intermittent evidence cannot authorize it',async()=>{
 const {SpeechOnset}=await import('../src/speech-onset');
 const frames=(end:number,confidence=.65)=>Array.from({length:Math.floor(end/16.875)},(_,i)=>({atMs:i*16.875,speaker:i*16.875>=800&&i*16.875<1600?0:-1,confidence}));
 const s=new SpeechOnset();for(let i=0;i<110;i++)s.push(.01);
 for(let i=0;i<8;i++)s.observe(frames(2000));assert.equal(s.acousticStart(700,1700),undefined);
 for(let i=1;i<6;i++)s.observe(frames(2000+i*256));assert.notEqual(s.acousticStart(700,1700),undefined);
 assert.equal(s.acousticStart(700,2300),undefined,'a long moderate sound still needs text review');
 const noisy=new SpeechOnset();for(let i=0;i<110;i++)noisy.push(.01);
 for(let i=0;i<8;i++)noisy.observe(frames(2000+i*256,i%2?.4:.65));assert.equal(noisy.acousticStart(700,1700),undefined);
});

test('recent consistent windows can recover after provisional low-confidence estimates',async()=>{
 const {SpeechOnset}=await import('../src/speech-onset');
 const s=new SpeechOnset();for(let i=0;i<180;i++)s.push(.01);
 const observe=(n:number,confidence:number)=>s.observe(Array.from({length:Math.floor((2000+n*256)/16.875)},(_,i)=>({atMs:i*16.875,speaker:i*16.875>=800&&i*16.875<1600?0:-1,confidence})));
 for(let n=0;n<14;n++)observe(n,.4);
 for(let n=14;n<17;n++)observe(n,.65);
 assert.equal(s.acousticStart(700,1700),undefined,'three of six witnesses still do not qualify');
 observe(17,.65);
 assert.notEqual(s.acousticStart(700,1700),undefined,'early provisional negatives cannot veto four fresh confirmations including the latest two in six advancing windows');
 assert.equal(s.acousticStart(700,2300),undefined,'do not turn long effects into short replies');
});

test('real Chrome capture at the full-run resume position corroborates the missed reply',async()=>{
 const {readFile}=await import('node:fs/promises'),{gunzipSync}=await import('node:zlib'),{SpeechOnset}=await import('../src/speech-onset');
 const observations=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/bilibili-eyes-resume-turns.json.gz',import.meta.url))).toString());
 const onset=new SpeechOnset();for(let i=0;i<150;i++)onset.push(.01);
 const stable=new StableTurns();let acceptedAt:number|undefined;
 for(const o of observations){
  onset.observe(o.frames);
  for(const t of stable.accept(closedSpeakerTurns(o.frames,o.positionMs))){
   if(t.startMs>700&&t.endMs<2300&&onset.acousticStart(t.startMs,t.endMs)!==undefined)acceptedAt??=o.positionMs;
  }
 }
 assert(acceptedAt!==undefined&&acceptedAt<=4354,'quiet target must remain recoverable after its first text review');
});


test('real capture with one uncertain window still retains the quiet reply',async()=>{
 const {readFile}=await import('node:fs/promises'),{gunzipSync}=await import('node:zlib'),{SpeechOnset}=await import('../src/speech-onset');
 const observations=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/bilibili-eyes-resume-unstable.json.gz',import.meta.url))).toString());
 const onset=new SpeechOnset();for(let i=0;i<180;i++)onset.push(.01);
 const stable=new StableTurns();let acceptedAt:number|undefined;
 for(const o of observations){onset.observe(o.frames);for(const t of stable.accept(closedSpeakerTurns(o.frames,o.positionMs))){if(t.startMs>700&&t.endMs<2300&&onset.acousticStart(t.startMs,t.endMs)!==undefined)acceptedAt??=o.positionMs;}}
 assert(acceptedAt!==undefined&&acceptedAt<=3600,'a single uncertain window must not permanently lose the reply');
});


test('short-turn endpoint jitter and one uncertain window do not erase the same utterance',()=>{
 const stable=new StableTurns();
 const turn=(startMs:number,endMs:number)=>({startMs,endMs,reason:'turn-end' as const,confidence:.65});
 assert.deepEqual(stable.accept([turn(1000,1600)]),[]);
 assert.equal(stable.accept([turn(1020,1830)])[0]?.endMs,1830);
 stable.accept([]);
 assert.equal(stable.accept([turn(1040,1850)])[0]?.endMs,1850);
 const adjacent=new StableTurns();adjacent.accept([turn(1000,1200)]);
 assert.deepEqual(adjacent.accept([turn(1250,1450)]),[],'nearby nonoverlapping replies cannot corroborate each other');
 adjacent.accept([]);adjacent.accept([]);
 assert.deepEqual(adjacent.accept([turn(1250,1450)]),[],'stale evidence expires');
});

test('real jittered capture does not wait until the ten-second window rolls away',async()=>{
 const {readFile}=await import('node:fs/promises'),{gunzipSync}=await import('node:zlib'),{SpeechOnset}=await import('../src/speech-onset');
 const observations=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/bilibili-eyes-resume-jitter.json.gz',import.meta.url))).toString());
 const onset=new SpeechOnset();for(let i=0;i<400;i++)onset.push(.01);
 const stable=new StableTurns();let acceptedAt:number|undefined;
 for(const o of observations){onset.observe(o.frames);for(const t of stable.accept(closedSpeakerTurns(o.frames,o.positionMs))){if(t.startMs>700&&t.endMs<2300&&onset.acousticStart(t.startMs,t.endMs)!==undefined)acceptedAt??=o.positionMs;}}
 assert(acceptedAt!==undefined&&acceptedAt<=4000,'candidate should recover at its first corroborated endpoint');
});


test('quiet real capture still reaches candidate confirmation when no 0.6 proposal existed',async()=>{
 const {readFile}=await import('node:fs/promises'),{gunzipSync}=await import('node:zlib'),{SpeechOnset}=await import('../src/speech-onset');
 const observations=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/bilibili-eyes-resume-no-proposal.json.gz',import.meta.url))).toString());
 const onset=new SpeechOnset();for(let i=0;i<240;i++)onset.push(.01);
 const stable=new StableTurns();let acceptedAt:number|undefined;
 for(const o of observations){onset.observe(o.frames);for(const t of stable.accept(closedSpeakerTurns(o.frames,o.positionMs))){if(t.startMs>500&&t.endMs<2500&&onset.acousticStart(t.startMs,t.endMs)!==undefined)acceptedAt??=o.positionMs;}}
 assert(acceptedAt!==undefined&&acceptedAt<=4200,'quiet reply must reach the confirmation stage');
});

test('an isolated moderate sound after a long lead-in cannot use the nearby-reply exception',async()=>{
 const {SpeechOnset}=await import('../src/speech-onset');
 const s=new SpeechOnset();for(let i=0;i<400;i++)s.push(.01);
 for(let n=0;n<8;n++)s.observe(Array.from({length:Math.floor((10000+n*256)/16.875)},(_,i)=>({atMs:i*16.875,speaker:i*16.875>=8000&&i*16.875<8800?0:-1,confidence:.55})));
 assert.equal(s.acousticStart(7900,8900),undefined,'music/effects after silence still require text review');
});

test('later model updates cannot requeue audio already covered by a completed review',()=>{
 const q=new PendingTurns(),reviewed={startMs:12703,endMs:13534};
 q.add({startMs:12747,endMs:13937});q.discardReviewed(reviewed,14494);
 assert.equal(q.first,undefined);
 q.add({startMs:12747,endMs:13937});assert.equal(q.first,undefined,'the next inference must not restart the same decode');
 q.add({startMs:13950,endMs:14300});assert.equal(q.shift()?.startMs,13950,'an independent adjacent reply survives');
 q.add({startMs:12747,endMs:14800});assert.equal(q.shift()?.endMs,14800,'new audio outside the reviewed crop remains eligible');
});
test('timed-out review does not suppress a materially extended candidate',()=>{
 const q=new PendingTurns();q.discardReviewed({startMs:12703,endMs:13534});q.add({startMs:12747,endMs:13937});assert.equal(q.first?.endMs,13937);
});

test('a coarse rejected proposal does not delete independent earlier or distinct-onset replies',()=>{
 const q=new PendingTurns(),coarse={startMs:1000,endMs:4000};
 const before={startMs:100,endMs:700},nearStart={startMs:1400,endMs:2000},inside={startMs:2500,endMs:3000};
 for(const t of [before,nearStart,inside])q.add(t);
 q.discardReviewed(coarse);
 assert.deepEqual([q.shift(),q.shift()],[before,inside]);
 assert.equal(q.wasReviewed(nearStart),true,'a smaller version of the same onset still deduplicates');
 for(const t of [inside]){assert.equal(q.wasReviewed(t),false);q.add(t);}
 assert.deepEqual([q.shift()],[inside],'later independent proposals remain eligible after the coarse review');
});

test('interval review suppression retains endpoint refinements without using a global time watermark',()=>{
 const q=new PendingTurns(),reviewed={startMs:1000,endMs:4000};
 const refined={startMs:1100,endMs:3900},adjacent={startMs:4010,endMs:4250};
 q.add(refined);q.add(adjacent);q.discardReviewed(reviewed);
 assert.equal(q.wasReviewed(refined),true);
 q.add(refined);assert.deepEqual(q.shift(),adjacent);assert.equal(q.first,undefined);
});

test('nearby disjoint or touching short replies cannot replace each other while review is busy',()=>{
 const q=new PendingTurns(),first={startMs:1000,endMs:1200},second={startMs:1250,endMs:1450},third={startMs:1450,endMs:1650};
 for(const t of [first,second,third])q.add(t);
 const refined={startMs:1010,endMs:1210};q.add(refined);
 assert.deepEqual([q.shift(),q.shift(),q.shift()],[refined,second,third]);
 assert.equal(q.first,undefined);
});


test('real 4:58 effect cannot restart text review as a smaller version of the same sound',()=>{
 const q=new PendingTurns();
 q.discardReviewed({startMs:69,endMs:1153},1153);
 q.add({startMs:682,endMs:1097});
 assert.equal(q.first,undefined,'the smaller proposal reuses the same unsupported effect');
 q.add({startMs:1160,endMs:1410});
 assert.deepEqual(q.shift(),{startMs:1160,endMs:1410},'an independent reply after that sound is still eligible');
});

test('backpressure lookup skips one grouped estimate but preserves and scans all queued candidates',()=>{
 const q=new PendingTurns(),active={startMs:3634,endMs:5645},refinement={startMs:3657,endMs:6523},reply={startMs:5673,endMs:6522};
 q.add(refinement);assert.deepEqual(q.firstOtherAudio(active),refinement);
 assert.equal(q.firstOtherAudio(active,candidate=>candidate===refinement),undefined);
 q.add(reply);assert.deepEqual(q.firstOtherAudio(active,candidate=>candidate===refinement),reply);
 assert.deepEqual([q.shift(),q.shift()],[refinement,reply],'a hold exemption never suppresses a later review');
});
