import test from 'node:test';import assert from 'node:assert/strict';
import {SpeechOnset} from '../src/speech-onset';
const frames=(voice:(ms:number)=>boolean,confidence=.95)=>Array.from({length:350},(_,i)=>({atMs:i*16.875,speaker:voice(i*16.875)?0:-1,confidence}));
test('a padded acoustic start preserves a weak opening instead of rejecting all later clear words',()=>{
 const s=new SpeechOnset();for(let i=0;i<150;i++)s.push(i*32>=1800&&i*32<3000?.95:0);
 const f=frames(ms=>ms>=1800&&ms<3000);s.observe(f);s.observe(f);
 assert.equal(s.wordStart(1000,3100),undefined,'strict aligned-word behavior remains unchanged');
 assert.equal(s.acousticStart(1000,3100),840,'retain the quiet prefix, never cut to the first confident vowel');
});
test('repeated strong speaker evidence can establish a stylised voice missed by VAD',()=>{
 const s=new SpeechOnset();for(let i=0;i<150;i++)s.push(.02);
 const f=frames(ms=>ms>=1000&&ms<2000);s.observe(f);
 assert.equal(s.acousticStart(900,2200),undefined,'one hypothesis is insufficient');
 s.observe(f);assert.equal(s.acousticStart(900,2200),740);
});
test('music, weak guesses, overlap and a remote later utterance cannot establish a turn',()=>{
 for(const f of [frames(()=>false),frames(()=>true,.7),frames(()=>true).map(f=>({...f,speaker:-2})),frames(ms=>ms>=2500)]){
  const s=new SpeechOnset();for(let i=0;i<150;i++)s.push(.02);s.observe(f);s.observe(f);assert.equal(s.acousticStart(0,4000),undefined);
 }
});
test('a late inference result must not extend the previous sentence across a pause into the next reply',()=>{
 const s=new SpeechOnset();for(let i=0;i<170;i++)s.push(.95);
 const f=frames(ms=>ms>=100&&ms<1000||ms>=2600&&ms<4000);s.observe(f);s.observe(f);
 const tail=s.tail(0,1100);assert(tail>=1100&&tail<1500,`tail ${tail} must not reach the next reply`);
});

test('captured Bilibili evidence retains nearby fast dialogue and reviews unsupported remote candidates',async()=>{
 const {readFile}=await import('node:fs/promises'),{gunzipSync}=await import('node:zlib'),{StreamingSentences}=await import('../src/streaming-sentences');
 const examples=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/bilibili-acoustic-evidence.json.gz',import.meta.url))).toString());
 for(const example of examples){
  assert.equal(example.oldAccepted,null,'the retained pre-fix decision rejected this real audio');
  const s=new StreamingSentences(example.from*1000,()=>{},e=>{throw e;},async()=>{throw Error('fast boundary must not wait for ASR');},undefined,true);
  example.ps.forEach((p:number,i:number)=>s.push(new Float32Array(512).fill(.02),(example.from*1000)+(i+1)*32,p));
  for(const observation of example.observations)s.observeSpeech(observation.frames);
  const result=s.acousticBoundary(example.turn);
  if(result){assert(result.startMs<=example.turn.startMs);assert(result.endMs>=example.turn.endMs);}
  else {
   assert(example.turn.startMs-example.from*1000>2500);
   // Text review needs its full 960ms quiet tail; the retained fast-path
   // fixture may stop slightly earlier than that.
   for(let i=example.ps.length;example.from*1000+i*32<example.turn.endMs+960;i++)s.push(new Float32Array(512),example.from*1000+(i+1)*32,0);
   assert(s.reviewAudio(example.turn),`remote candidate at ${example.turn.startMs} stays available for text review`);
  }
  s.stop();
 }
});

test('two fresh agreeing windows retain voice despite earlier provisional negatives',()=>{
 const s=new SpeechOnset();for(let i=0;i<180;i++)s.push(.8);
 const view=(end:number,confidence:number)=>Array.from({length:Math.floor(end/32)},(_,i)=>({atMs:i*32,speaker:i>=30&&i<=50?0:-1,confidence}));
 for(let n=0;n<10;n++)s.observe(view(1800+n*128,.4));
 s.observe(view(3200,.75));assert.equal(s.acousticStart(900,1800),undefined);
 s.observe(view(3456,.75));assert.notEqual(s.acousticStart(900,1800),undefined,'old provisional estimates must not cause repeated ASR waits after acoustic agreement');
});

test('a confirmed strong core retains the weak first word from its overlapping original candidate',async()=>{
 const {StreamingSentences}=await import('../src/streaming-sentences');
 const s=new StreamingSentences(0,()=>{},e=>{throw e},async()=>({}),undefined,true);
 for(let i=0;i<150;i++)s.push(new Float32Array(512),(i+1)*32,.02);
 const voice=frames(ms=>ms>=1800&&ms<2600);s.observeSpeech(voice);s.observeSpeech(voice);
 const t={startMs:1700,endMs:2800,reason:'turn-end' as const};
 assert(s.acousticBoundary(t)!.startMs>900,'the strong core alone would trim the quiet prefix');
 assert.equal(s.acousticBoundary({...t,leadingStartMs:900})!.startMs,900);
 assert(s.acousticBoundary({...t,leadingStartMs:0})!.startMs>900,'a remote rejected sound must not be pulled into the turn');s.stop();
});

test('primary and focused contexts cannot count as two independent witnesses for each other',async()=>{
 const {StreamingSentences}=await import('../src/streaming-sentences');
 const s=new StreamingSentences(0,()=>{},e=>{throw e},async()=>({}),undefined,true);
 for(let i=0;i<150;i++)s.push(new Float32Array(512),(i+1)*32,.01);
 const voice=frames(ms=>ms>=1000&&ms<1800),turn={startMs:900,endMs:1900};
 s.observeSpeech(voice);s.observeSpeech(voice,true);
 assert.equal(s.acousticBoundary(turn),undefined);assert.equal(s.acousticBoundary({...turn,focused:true}),undefined);
 s.observeSpeech(voice,true);assert(s.acousticBoundary({...turn,focused:true}));assert.equal(s.acousticBoundary(turn),undefined);s.stop();
});
