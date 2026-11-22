import test from 'node:test';
import assert from 'node:assert/strict';
import {StreamingSentences} from '../src/streaming-sentences';
import {streamingTranscriptSegments} from '../src/transcript-segments';
import {encodePcmWav} from '../src/sentence-confirmation';

test('split multiple sentences within one recognizer row using timed words',()=>{
 const segments=streamingTranscriptSegments([{start:0,end:5,text:'Hello. How are you?',words:[{word:'Hello',start:.3,end:1,probability:.9},{word:'.',start:1,end:1,probability:.9},{word:' How are you',start:1.4,end:3,probability:.9},{word:'?',start:3,end:3,probability:.9}]}],5000);
 assert.deepEqual(segments.map(s=>[s.startMs,s.endMs,s.text]),[[300,1000,'Hello.'],[1400,3000,'How are you?']]);
 assert.deepEqual(streamingTranscriptSegments([{start:0,end:5,text:'One. Two.'}],5000),[],'do not invent boundaries without timed words');
 assert.deepEqual(streamingTranscriptSegments([{start:0,end:2,text:'(gentle music)',words:[{word:'(gentle music)',start:0,end:2,probability:.95}]}],2000),[],'music labels are not dialogue');
});

test('ignore leading silence and map cropped recognition back to the video clock',async()=>{
 const submits:Record<string,unknown>[]=[];const accepted:{startMs:number;endMs:number}[]=[];
 const stream=new StreamingSentences(0,s=>accepted.push(s),e=>{throw e;},async(action,payload={})=>{
  if(action==='submit'){submits.push(payload);return {id:'test'};}
  if(action==='status')return {state:'done',result:{streaming:true,segments:[{startMs:1952,endMs:3000,text:'Hello there.',confidence:.95}]}};
  return {};
 });
 const frame=new Float32Array(512);
 for(let i=0;i<100;i++)stream.push(frame,(i+1)*32,0);
 assert.equal(submits.length,0,'silence must not produce a transcription or sentence');
 for(let i=100;i<200;i++)stream.push(frame,(i+1)*32,.95);
 const frames=Array.from({length:1200},(_,i)=>({atMs:i*16.875,speaker:i*16.875>=3200?0:-1,confidence:.95}));stream.observeSpeech(frames);stream.observeSpeech(frames);stream.finish({startMs:0,endMs:6400});
 for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 assert(submits.length>=2);assert(Number(submits[0].durationMs)<2500,'leading silence was sent to the recognizer');
 assert.equal(accepted.length,1);assert(accepted[0].startMs>=3000&&accepted[0].startMs<3200);
 assert(accepted[0].endMs>=4100&&accepted[0].endMs<4450);stream.stop();
});

test('music falsely flagged as speech is excluded using the confirmed first word, with onset padding',async()=>{
 const accepted:{startMs:number;endMs:number}[]=[];
 const stream=new StreamingSentences(20000,s=>accepted.push(s),e=>{throw e;},async(action)=>{
  if(action==='submit')return {id:'test'};
  if(action==='status')return {state:'done',result:{streaming:true,segments:[{startMs:15000,endMs:17400,text:'Where is he?',confidence:.93}]}};
  return {};
 });
 // Detector mistook the score for speech; the recognizer finds words much later.
 for(let i=0;i<600;i++)stream.push(new Float32Array(512),20000+(i+1)*32,.95);
 const frames=Array.from({length:1200},(_,i)=>({atMs:i*16.875,speaker:i*16.875>=15000?0:-1,confidence:.95}));stream.observeSpeech(frames);stream.observeSpeech(frames);
 stream.finish({startMs:20000,endMs:39200});
 for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 assert.equal(accepted.length,1);assert(accepted[0].startMs>=34840&&accepted[0].startMs<=35000);assert.equal(accepted[0].endMs,37400);stream.stop();
});

test('inverted recognizer token times never silently drop the start of a complete sentence',()=>{
 const words=[{word:'A complete',start:8,end:6,probability:.95},{word:' sentence.',start:8,end:10,probability:.95}];
 assert.deepEqual(streamingTranscriptSegments([{start:8,end:10,text:'A complete sentence.',words}],11000),[{startMs:8000,endMs:10000,text:'A complete sentence.',confidence:.95}]);
 assert.deepEqual(streamingTranscriptSegments([{start:8,end:10,text:'First sentence. Second sentence.',words}],11000),[],'invalid token times cannot justify treating multiple sentences as one');
 assert.deepEqual(streamingTranscriptSegments([{start:8,end:10,text:'(screaming)',words:[{word:'(',start:8,end:6,probability:.9},{word:'screaming)',start:8,end:10,probability:.9}]}],11000),[],'filter sound descriptions before token parsing loses their opening bracket');
});

test('three stable timed readings plus strong VAD recover speech under music without a speaker-model onset',async()=>{
 const accepted:{startMs:number;endMs:number}[]=[];const errors:Error[]=[];
 const stream=new StreamingSentences(10000,s=>accepted.push(s),e=>errors.push(e),async action=>action==='submit'?{id:'test'}:action==='status'?{state:'done',result:{streaming:true,segments:[{startMs:1200,endMs:2400,text:'守ろう!',confidence:.65}]}}:{},undefined,true);
 for(let i=0;i<100;i++)stream.push(new Float32Array(512),10000+(i+1)*32,.95);
 stream.finish({startMs:10000,endMs:13000});for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));
 assert.equal(errors.length,0);assert.equal(accepted.length,1);assert(accepted[0].startMs>=11040);assert(accepted[0].startMs<=11200);stream.stop();
});

test('re-align cached speech after a music lead-in when coarse word times miss the actual voice',async()=>{
 let seconds=0;const accepted:{startMs:number;endMs:number}[]=[];const errors:Error[]=[];const durations:number[]=[];
 const stream=new StreamingSentences(10000,s=>accepted.push(s),e=>errors.push(e),async(action,payload={})=>{
  if(action==='submit'){seconds=Number(payload.durationMs);durations.push(seconds);return {id:'test'};}
  if(action==='status')return {state:'done',result:{streaming:true,segments:[seconds>8000?{startMs:6000,endMs:7000,text:'Wow!',confidence:.8}:{startMs:1500,endMs:2400,text:'Wow!',confidence:.8}]}};return {};
 },undefined,true);
 for(let i=0;i<320;i++)stream.push(new Float32Array(512),10000+(i+1)*32,i*32>=7200&&i*32<8200?.95:0);
 stream.markSpeechStart(0);
 const frames=Array.from({length:600},(_,i)=>({atMs:i*16.875,speaker:i*16.875>=7200&&i*16.875<8200?0:-1,confidence:.95}));stream.observeSpeech(frames);stream.observeSpeech(frames);
 stream.finish({startMs:10000,endMs:20000});for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));
 assert.equal(errors.length,0);assert.equal(accepted.length,1);assert(durations.some(n=>n<5000));assert(accepted[0].startMs>17000);stream.stop();
});

test('DTW acoustic alignment replaces coarse/inverted token timestamps without losing words',()=>{
 const rows=[{start:0,end:9,text:'Wow! Nice.',words:[{word:'Wow',start:0,end:1,probability:.95,t_dtw:420},{word:'!',start:1,end:1,probability:.95,t_dtw:480},{word:' Nice',start:6,end:4,probability:.95,t_dtw:610},{word:'.',start:7,end:8,probability:.95,t_dtw:680}]}];
 const result=streamingTranscriptSegments(rows,9000);assert.equal(result.length,2);assert.equal(result[0].startMs,4200);assert.equal(result[0].endMs,4960);assert.equal(result[1].startMs,6100);assert.equal(result[0].timing,'aligned');
});

test('speaker-model end is a hint and cannot truncate an aligned complete sentence',async()=>{
 const accepted:{startMs:number;endMs:number}[]=[];
 const stream=new StreamingSentences(0,s=>accepted.push(s),e=>{throw e;},async action=>action==='submit'?{id:'test'}:action==='status'?{state:'done',result:{streaming:true,segments:[{startMs:300,endMs:2300,text:'A complete sentence.',confidence:.95,timing:'aligned'}]}}:{},undefined,true);
 for(let i=0;i<100;i++)stream.push(new Float32Array(512).fill(.05),(i+1)*32,.95);
 stream.finish({startMs:0,endMs:1600},false);for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));
 assert.equal(accepted.length,1);assert.equal(accepted[0].endMs,2300);stream.stop();
});

test('unchanged final audio is transcribed once, not repeatedly while the video waits',async()=>{
 let submits=0;const accepted:unknown[]=[];
 const stream=new StreamingSentences(0,s=>accepted.push(s),e=>{throw e;},async action=>action==='submit'?(submits++,{id:'test'}):action==='status'?{state:'done',result:{streaming:true,segments:[{startMs:200,endMs:2000,text:'Clear words.',confidence:.95,timing:'aligned'}]}}:{},undefined,true);
 for(let i=0;i<100;i++)stream.push(new Float32Array(512).fill(.04),(i+1)*32,.95);stream.finish({startMs:0,endMs:3000});
 for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));assert.equal(submits,1);assert.equal(accepted.length,1);stream.stop();
});

test('an uncertain closed turn can keep listening and confirm with later context',async()=>{
 let pass=0,reopened=0;const accepted:unknown[]=[];
 const stream=new StreamingSentences(0,s=>accepted.push(s),()=>{reopened++;stream.reopen();},async action=>action==='submit'?(pass++,{id:'test'}):action==='status'?{state:'done',result:{streaming:true,segments:[pass===1?{startMs:100,endMs:1800,text:'An unclear fragment',confidence:.2}:{startMs:100,endMs:3300,text:'A complete sentence.',confidence:.95,timing:'aligned'}]}}:{},undefined,true);
 for(let i=0;i<80;i++)stream.push(new Float32Array(512).fill(.04),(i+1)*32,.95);stream.finish({startMs:0,endMs:2500},false);
 for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));assert.equal(reopened,1);assert.equal(accepted.length,0);
 for(let i=80;i<130;i++)stream.push(new Float32Array(512).fill(.04),(i+1)*32,.95);stream.finish({startMs:0,endMs:4000},false);
 for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));assert.equal(accepted.length,1);assert.equal(reopened,1);stream.stop();
});

test('unvoiced uncertain intro is re-decoded around the earliest aligned reply, not a later speaker-model hit',async()=>{
 let duration=0;const accepted:{startMs:number;endMs:number}[]=[];const errors:Error[]=[];
 const stream=new StreamingSentences(0,s=>accepted.push(s),e=>errors.push(e),async(action,payload={})=>{
  if(action==='submit'){duration=Number(payload.durationMs);return {id:'test'};}
  if(action==='status')return {state:'done',result:{streaming:true,segments:duration===14400?[
   {startMs:6000,endMs:8000,text:'Uncertain sound',confidence:.3,timing:'aligned'},
   {startMs:8400,endMs:9600,text:'Hello!',confidence:.95,timing:'aligned'},
   {startMs:12500,endMs:13500,text:'Later voice.',confidence:.95,timing:'aligned'}
  ]:[{startMs:8400-(14400-duration),endMs:9600-(14400-duration),text:'Hello!',confidence:.95,timing:'aligned'}]}};return {};
 },undefined,true);
 stream.markSpeechStart(0);
 for(let i=0;i<450;i++)stream.push(new Float32Array(512).fill(.04),(i+1)*32,0);
 stream.finish({startMs:0,endMs:14400},false);for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));
 assert.equal(errors.length,0);assert.equal(accepted.length,1);assert(accepted[0].startMs>=8180&&accepted[0].startMs<=8400);assert(accepted[0].endMs<10000);stream.stop();
});

test('moderate-confidence aligned words cannot turn a musical lead-in into a loop start',async()=>{
 let duration=0;const accepted:{startMs:number;endMs:number}[]=[];const errors:Error[]=[];
 const stream=new StreamingSentences(0,s=>accepted.push(s),e=>errors.push(e),async(action,payload={})=>{
  if(action==='submit'){duration=Number(payload.durationMs);return {id:'test'};}
  if(action==='status')return {state:'done',result:{streaming:true,segments:[duration>9000?
   {startMs:6000,endMs:10000,text:'Unclear music and words',confidence:.65,timing:'aligned'}:
   {startMs:2700,endMs:4000,text:'Welcome!',confidence:.95,timing:'aligned'}]}};return {};
 },undefined,true);
 stream.markSpeechStart(0);
 for(let i=0;i<350;i++)stream.push(new Float32Array(512).fill(.04),(i+1)*32,0);
 stream.finish({startMs:0,endMs:11200},false);for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));
 assert.equal(errors.length,0);assert.equal(accepted.length,1);assert(accepted[0].startMs>=8100&&accepted[0].startMs<=8400);stream.stop();
});

test('a long music hypothesis is cropped at a later speaker candidate before skipping that dialogue',async()=>{
 let duration=0;const accepted:{startMs:number;endMs:number}[]=[];const errors:Error[]=[];const submitted:number[]=[];
 const stream=new StreamingSentences(14000,s=>accepted.push(s),e=>errors.push(e),async(action,payload={})=>{
  if(action==='submit'){duration=Number(payload.durationMs);submitted.push(duration);return {id:'test'};}
  if(action==='status')return {state:'done',result:{streaming:true,segments:[duration>7000?
   {startMs:1500,endMs:7000,text:'♪~',confidence:.99,timing:'aligned'}:
   {startMs:1300,endMs:2300,text:'Wow!',confidence:.95,timing:'aligned'}]}};return {};
 },undefined,true);
 stream.markSpeechStart(0);
 for(let i=0;i<350;i++)stream.push(new Float32Array(512).fill(.04),14000+(i+1)*32,0);
 stream.finish({startMs:21200,endMs:24800},false);for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));
 assert.equal(errors.length,0);assert.equal(accepted.length,1);assert(accepted[0].startMs>=21900&&accepted[0].startMs<22500);assert(submitted.some(n=>n<5000));stream.stop();
});

test('punctuation and stable ASR rows cannot trigger replay before a pause or speaker boundary',async()=>{
 const accepted:{text:string;endMs:number}[]=[];
 const stream=new StreamingSentences(0,s=>accepted.push(s),e=>{throw e;},async action=>action==='submit'?{id:'test'}:action==='status'?{state:'done',result:{streaming:true,language:'japanese',segments:[{startMs:100,endMs:600,text:'今日は。',confidence:.95,timing:'aligned'},{startMs:750,endMs:2200,text:'もう終わったよ。',confidence:.95,timing:'aligned'}]}}:{});
 for(let i=0;i<100;i++)stream.push(new Float32Array(512).fill(.04),(i+1)*32,.95);
 for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));assert.equal(accepted.length,0);
 stream.finish({startMs:0,endMs:2300,reason:'turn-end'},false);for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));
 assert.equal(accepted.length,1);assert(accepted[0].text.includes('今日は'));assert(accepted[0].text.includes('もう終わったよ'));assert.equal(accepted[0].endMs,2200);stream.stop();
});

test('empty transcription over corroborated speech asks for context instead of skipping the voice as music',async()=>{
 const errors:Error[]=[];const accepted:unknown[]=[];
 const stream=new StreamingSentences(0,s=>accepted.push(s),e=>errors.push(e),async action=>action==='submit'?{id:'test'}:action==='status'?{state:'done',result:{streaming:true,segments:[]}}:{},undefined,true);
 for(let i=0;i<100;i++)stream.push(new Float32Array(512).fill(.04),(i+1)*32,i<60?.95:.01);
 const frames=Array.from({length:190},(_,i)=>({atMs:i*16.875,speaker:i<110?0:-1,confidence:.95}));stream.observeSpeech(frames);stream.observeSpeech(frames);
 stream.finish({startMs:0,endMs:3000},false);for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));
 assert.equal(accepted.length,0);assert.equal(errors.length,1);assert.equal(errors[0].name,'UncertainDialogue');assert.equal(errors[0].message,'这句对白尚未确认。');stream.stop();
});

test('a quiet aligned interjection is retained when the following words have corroborated voice',async()=>{
 const accepted:{startMs:number;text:string}[]=[];const errors:Error[]=[];
 const stream=new StreamingSentences(53015,s=>accepted.push(s),e=>errors.push(e),async action=>action==='submit'?{id:'test'}:action==='status'?{state:'done',result:{streaming:true,segments:[{startMs:680,endMs:3140,text:'えっ! すごい! もう勉強?',confidence:.569,timing:'aligned',words:[{startMs:680,endMs:840,text:'えっ!'},{startMs:1620,endMs:2160,text:'すごい!'},{startMs:2280,endMs:3140,text:'もう勉強?'}]}]}}:{},'japanese',true);
 for(let i=0;i<102;i++)stream.push(new Float32Array(512).fill(.04),53015+(i+1)*32,i*32>=1500?.95:0);
 const frames=Array.from({length:195},(_,i)=>({atMs:i*16.875,speaker:i*16.875>=1500?0:-1,confidence:.95}));stream.observeSpeech(frames);stream.observeSpeech(frames);
 stream.finish({startMs:53015,endMs:56255});for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));
 assert.equal(errors.length,0);assert.equal(accepted.length,1);assert(accepted[0].startMs<53700,'retain the interjection, do not jump to the clear later words');assert(accepted[0].text.startsWith('えっ'));stream.stop();
});

test('moderate aligned speech missed by classifiers needs matching words and timing from a second audio window',async()=>{
 let duration=0,submits=0;const accepted:{startMs:number}[]=[],errors:Error[]=[];
 const stream=new StreamingSentences(0,s=>accepted.push(s),e=>errors.push(e),async(action,payload={})=>{
  if(action==='submit'){submits++;duration=Number(payload.durationMs);return {id:'test'};}
  const shift=3264-duration;
  if(action==='status')return {state:'done',result:{streaming:true,segments:[{startMs:680-shift,endMs:3140-shift,text:'えっ! すごい! もう勉強?',confidence:.569,timing:'aligned',words:[{startMs:680-shift,endMs:840-shift,text:'えっ!'},{startMs:1620-shift,endMs:2160-shift,text:'すごい!'},{startMs:2280-shift,endMs:3140-shift,text:'もう勉強?'}]}]}};return {};
 },'japanese',true);
 for(let i=0;i<102;i++)stream.push(new Float32Array(512).fill(.04),(i+1)*32,0);stream.markSpeechStart(0);stream.finish({startMs:0,endMs:3264});
 for(let i=0;i<25;i++)await new Promise(r=>setImmediate(r));assert.equal(errors.length,0);assert.equal(submits,2);assert.equal(accepted.length,1);assert(accepted[0].startMs<680);stream.stop();
});

test('speaker annotation is not the first spoken word and cannot anchor a loop in the music lead-in',()=>{
 const words=[['(',8],['レ',28],['ン',28],[')',28],['えっ',96],['?',184],['すごい',188],['!',236]].map(([word,t_dtw])=>({word:String(word),t_dtw:Number(t_dtw),start:0,end:1,probability:.9}));
 const rows=streamingTranscriptSegments([{start:0,end:3,text:'(レン)えっ?すごい!',words}],3000);
 assert.equal(rows[0].text,'えっ?');assert.equal(rows[0].startMs,960);
 assert.equal(rows[0].words?.[0].text,'えっ');assert.equal(rows[1].text,'すごい!');
 const spoken=streamingTranscriptSegments([{start:0,end:3,text:'Hello (again).',words:[{word:'Hello (again).',start:.2,end:2,probability:.9}]}],3000);
 assert.equal(spoken[0].text,'Hello (again).','keep parentheses inside spoken text');
});

test('recropping uncertain opening retains its audio instead of jumping to a confident later word',async()=>{
 const durations:number[]=[];const accepted:any[]=[];const errors:Error[]=[];
 const stream=new StreamingSentences(0,s=>accepted.push(s),e=>errors.push(e),async(action,payload={})=>{
  if(action==='submit'){durations.push(Number(payload.durationMs));return {id:'test'};}
  if(action==='status')return {state:'done',result:{streaming:true,segments:[{startMs:800,endMs:1400,text:'Well,',confidence:.3,timing:'aligned'},{startMs:1900,endMs:2900,text:'there it is.',confidence:.95,timing:'aligned'}]}};
  return {};
 },undefined,true);
 for(let i=0;i<125;i++)stream.push(new Float32Array(512).fill(.05),(i+1)*32,0);
 stream.markSpeechStart(0);stream.finish({startMs:0,endMs:4000});
 for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));
 assert(durations.every(n=>n>=3200),'must retain the 800ms opening, not crop to 1550ms');
 assert.equal(accepted.length,0,'uncertain prefix is not permission to loop only its suffix');stream.stop();
});

test('real Japanese tail: independent re-decodes retain weak first word and confirm without manual next',async()=>{
 const {readFile}=await import('node:fs/promises');
 const readings=JSON.parse(await readFile(new URL('./fixtures/weak-opening-transcripts.json',import.meta.url),'utf8'));
 let submitted=0;const accepted:any[]=[];const errors:Error[]=[];
 const stream=new StreamingSentences(0,s=>accepted.push(s),e=>errors.push(e),async action=>{
  if(action==='submit'){submitted++;return {id:'tail'};}
  if(action==='status')return {state:'done',result:{streaming:true,language:'japanese',segments:readings[Math.min(submitted-1,1)].rows}};
  return {};
 },undefined,true);
 for(let i=0;i<129;i++)stream.push(new Float32Array(512).fill(.04),(i+1)*32,.01);
 stream.markSpeechStart(0);stream.finish({startMs:1620,endMs:3135,reason:'turn-end'},false);
 for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));
 assert.equal(errors.length,0);assert.equal(accepted.length,1);assert.match(accepted[0].text,/^えっ/);assert.match(accepted[0].text,/もう勉強/);
 assert(accepted[0].startMs<=820,'retain the first interjection, not just the clearer later word');assert(accepted[0].startMs>500,'do not include the whole musical lead-in');assert(submitted>=2);stream.stop();
});

test('listening for extra confirmation retains the original pause instead of merging the next speaker',async()=>{
 let extended=false;const accepted:any[]=[];const errors:Error[]=[];
 const stream=new StreamingSentences(0,s=>accepted.push(s),e=>{errors.push(e);if(!extended){extended=true;stream.reopen();for(let i=80;i<150;i++)stream.push(new Float32Array(512).fill(.04),(i+1)*32,.95);stream.finish({startMs:0,endMs:4800,reason:'turn-end'},false);}},async action=>action==='submit'?{id:'test'}:action==='status'?{state:'done',result:{streaming:true,segments:[
  {startMs:200,endMs:1800,text:'First reply.',confidence:extended?.95:.3,timing:'aligned'},
  ...(extended?[{startMs:2600,endMs:3500,text:'Another speaker.',confidence:.95,timing:'aligned'}]:[])
 ]}}:{},undefined,true);
 const frames=Array.from({length:300},(_,i)=>({atMs:i*16.875,speaker:0,confidence:.95}));stream.observeSpeech(frames);stream.observeSpeech(frames);
 for(let i=0;i<80;i++)stream.push(new Float32Array(512).fill(.04),(i+1)*32,.95);
 stream.finish({startMs:0,endMs:2200,reason:'turn-end'},false);for(let i=0;i<35;i++)await new Promise(r=>setImmediate(r));
 assert.equal(errors.length,1,'one automatic context recovery');assert.equal(accepted.length,1);assert.equal(accepted[0].text,'First reply.');assert.equal(accepted[0].endMs,1800);stream.stop();
});

test('caption continuity metadata follows the first captured sample at normal and doubled media rate',()=>{
 for(const [rate,start,end,mediaStart,prefixMs,firstValue]of [[1,12000,12400,10384,1600,13],[2,14000,14800,12368,800,38]]){
  const stream=new StreamingSentences(10000,()=>{},e=>{throw e;},async()=>({}),undefined,true);
  for(let i=0;i<100;i++)stream.push(new Float32Array(512).fill(i+1),10000+(i+1)*32*rate,0);
  const audio=stream.captionAudio({startMs:start,endMs:end});
  assert.equal(audio.mediaStartMs,mediaStart);assert.equal(audio.prefixMs,prefixMs);
  assert.equal(audio.pcm[0],firstValue,'metadata must describe the returned PCM, not the requested rounded boundary');
  stream.stop();
 }
});
