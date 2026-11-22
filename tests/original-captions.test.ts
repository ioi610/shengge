import test from 'node:test';import assert from 'node:assert/strict';import {OriginalCaptions,captionInRange,type CaptionContext} from '../src/original-captions';import {BackgroundCaptions} from '../src/background-captions';
const tick=()=>new Promise(r=>setImmediate(r));
async function startupCapture(){
 const {readFile}=await import('node:fs/promises'),{gunzipSync}=await import('node:zlib');
 const fixture=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/bilibili-caption-startup.json.gz',import.meta.url))).toString());
 const pcm=(value:string)=>{const bytes=Buffer.from(value,'base64');return new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));};
 return {previous:pcm(fixture.previous),current:pcm(fixture.current),expectedOffsetMs:fixture.expectedOffsetMs as number,matchedOffsetSamples:fixture.matchedOffsetSamples as number};
}
test('early short replies are backfilled after language evidence, without copying context',async()=>{
 const calls:any[]=[];const q=new OriginalCaptions({transcribe:async(pcm:Float32Array,language?:string)=>{calls.push({samples:pcm.length,language});return {language:'japanese',segments:[{startMs:0,endMs:800,text:'こんにちは。',confidence:.95},{startMs:1200,endMs:2900,text:'日本語の続きです。',confidence:.95}]};},enqueue:async()=>undefined} as unknown as BackgroundCaptions);
 const first=q.enqueue(new Float32Array(16000));await tick();assert.equal(calls.length,0);
 const second=q.enqueue(new Float32Array(32000));assert.equal((await first)?.text,'こんにちは。');assert.equal((await second)?.text,'日本語の続きです。');assert.equal(calls[0].samples,51200);assert.equal(q.language,undefined);q.observe('日本語の会話が続いています。','japanese');assert.equal(q.language,'ja');q.dispose();
});
test('changing language settles queued promises and fences stale transcriptions',async()=>{
 let release!:(x:any)=>void;const calls:string[]=[];const q=new OriginalCaptions({transcribe:async(_pcm:Float32Array,language?:string)=>{calls.push(language!);return new Promise(r=>release=r);}} as unknown as BackgroundCaptions);
 q.setLanguage('ja');const pending=q.enqueue(new Float32Array(16000));q.setLanguage('en');assert.equal(await pending,undefined);release({language:'japanese',segments:[{startMs:0,endMs:800,text:'古い日本語',confidence:.9}]});await tick();assert.deepEqual(calls,['ja']);assert.equal(q.language,'en');q.dispose();
});
test('a context transcript only publishes words belonging to the requested turn',()=>{
 const transcript={language:'japanese',segments:[{startMs:0,endMs:2500,text:'前の文次の文',confidence:.9,words:[{startMs:0,endMs:600,text:'前の文'},{startMs:1500,endMs:2200,text:'次の文'}]}]};
 assert.equal(captionInRange(transcript,1200,2600)?.text,'次の文');assert.equal(captionInRange(transcript,0,1000)?.text,'前の文');assert.equal(captionInRange({...transcript,segments:[{...transcript.segments[0],words:undefined}]},1200,2600),undefined);
});
test('uncertain early sounds do not lock English and disposal resolves waiting work',async()=>{
 const q=new OriginalCaptions({transcribe:async()=>({language:'english',segments:[{startMs:0,endMs:1000,text:'Hmm.',confidence:.9}]})} as unknown as BackgroundCaptions);
 const first=q.enqueue(new Float32Array(48000));await tick();assert.equal(q.language,undefined);q.dispose();assert.equal(await first,undefined);
});
test('invalid word timing and low-confidence output cannot become captions',()=>{
 assert.equal(captionInRange({segments:[{startMs:0,endMs:900,text:'fake',confidence:.2}]},0,1000),undefined);
 assert.equal(captionInRange({segments:[{startMs:0,endMs:900,text:'fake',confidence:.9,words:[{startMs:500,endMs:500,text:'fake'}]}]},0,1000),undefined);
});
test('verified review publishes immediately and completed context does not trigger duplicate decode',async()=>{
 const calls:number[]=[];const q=new OriginalCaptions({transcribe:async(pcm:Float32Array)=>{calls.push(pcm.length);return {language:'japanese',segments:[{startMs:200,endMs:1500,text:'続きの日本語',confidence:.9}]};},enqueue:async()=>undefined} as unknown as BackgroundCaptions);
 q.setLanguage('ja');const caption={text:'アクセサリー',language:'japanese',confidence:.9};
 assert.deepEqual(await q.enqueue(new Float32Array(16000),caption),caption);assert.equal(calls.length,0);
 assert.equal((await q.enqueue(new Float32Array(32000)))?.text,'続きの日本語');assert.deepEqual(calls,[32000]);q.dispose();
});
test('short Korean guesses stay unpublished until a full Japanese utterance supplies language evidence',async()=>{
 let runs=0;const q=new OriginalCaptions({transcribe:async()=>++runs===1?{language:'korean',segments:[{startMs:0,endMs:1000,text:'아! 어',confidence:.9},{startMs:1700,endMs:2500,text:'뭐야?',confidence:.9}]}:{language:'japanese',segments:[{startMs:0,endMs:1000,text:'ああ!',confidence:.9},{startMs:1700,endMs:2500,text:'お前…',confidence:.9},{startMs:3400,endMs:7000,text:'危ないやつだったのか! 違う! わけがあるんだ!',confidence:.9}]},enqueue:async()=>{throw Error('must not lock a short Korean guess');}} as unknown as BackgroundCaptions);
 let firstPublished=false;const first=q.enqueue(new Float32Array(24000)).then(v=>{firstPublished=true;return v;});const second=q.enqueue(new Float32Array(24000));await tick();assert.equal(firstPublished,false);assert.equal(q.language,undefined);
 const third=q.enqueue(new Float32Array(64000));assert.equal((await first)?.language,'japanese');assert.equal((await second)?.text,'お前…');assert.equal((await third)?.language,'japanese');q.dispose();
});
test('live context preserves natural spacing and excludes lead-in words from each caption',async()=>{
 const calls:number[]=[];const q=new OriginalCaptions({transcribe:async(pcm:Float32Array)=>{calls.push(pcm.length);assert.equal(pcm[31999],1);assert.equal(pcm[32000],2);return {language:'japanese',segments:[{startMs:0,endMs:4800,text:'前の声最初の日本語です間の声次の日本語です',confidence:.9,words:[{startMs:0,endMs:200,text:'前の声'},{startMs:600,endMs:1800,text:'最初の日本語です'},{startMs:2000,endMs:2200,text:'間の声'},{startMs:2500,endMs:4800,text:'次の日本語です'}]}]};},enqueue:async()=>{throw Error('aligned natural context should not need another decode');}} as unknown as BackgroundCaptions);
 const first=q.enqueue(new Float32Array(32000).fill(1),undefined,{prefixMs:500});const second=q.enqueue(new Float32Array(48000).fill(2),undefined,{prefixMs:400});
 assert.equal((await first)?.text,'最初の日本語です');assert.equal((await second)?.text,'次の日本語です');assert.deepEqual(calls,[80000]);q.dispose();
});
test('isolated fallback excludes retained prefix audio',async()=>{
 const q=new OriginalCaptions({transcribe:async()=>({language:'japanese',segments:[]}),enqueue:async(pcm:Float32Array)=>{assert.equal(pcm.length,16000);assert.equal(pcm[0],2);return {text:'現在の文',language:'japanese',confidence:.9};}} as unknown as BackgroundCaptions);q.setLanguage('ja');const pcm=new Float32Array(24000).fill(1);pcm.fill(2,8000);assert.equal((await q.enqueue(pcm,undefined,{prefixMs:500}))?.text,'現在の文');q.dispose();
});

test('known language decodes only the unresolved turn while retaining context for early missing replies',async()=>{
 const lengths:number[]=[];const q=new OriginalCaptions({transcribe:async(pcm:Float32Array)=>{lengths.push(pcm.length);return {language:'japanese',segments:[{startMs:0,endMs:900,text:'次の文',confidence:.9}]};},enqueue:async()=>undefined} as unknown as BackgroundCaptions);
 q.setLanguage('ja');await q.enqueue(new Float32Array(16000),{text:'前の文',language:'japanese',confidence:.9});
 assert.equal((await q.enqueue(new Float32Array(32000)))?.text,'次の文');assert.deepEqual(lengths,[32000]);q.dispose();
});
test('closing audio helps decoding but words in that margin cannot leak into the subtitle',async()=>{
 const q=new OriginalCaptions({transcribe:async(pcm:Float32Array)=>{assert.equal(pcm.length,48000);return {language:'japanese',segments:[{startMs:500,endMs:2950,text:'現在の文次の声',confidence:.9,words:[{startMs:500,endMs:1000,text:'現在の文'},{startMs:2800,endMs:2950,text:'次の声'}]}]};},enqueue:async()=>undefined} as unknown as BackgroundCaptions);
 q.setLanguage('ja');assert.equal((await q.enqueue(new Float32Array(48000),undefined,{prefixMs:400,suffixMs:300}))?.text,'現在の文');q.dispose();
});

test('reliable review language releases a waiting short caption without waiting for another accepted boundary',async()=>{
 const calls:string[]=[];const q=new OriginalCaptions({transcribe:async(_pcm:Float32Array,language?:string)=>{calls.push(language!);return {language:'japanese',segments:[{startMs:0,endMs:800,text:'お前',confidence:.9}]};},enqueue:async()=>undefined} as unknown as BackgroundCaptions);
 const waiting=q.enqueue(new Float32Array(16000));
 const review={language:'japanese',segments:[{startMs:0,endMs:3000,text:'危ないやつだったのか。違う、わけがあるんだ。',confidence:.9}]};
 q.observeTranscript({...review,segments:review.segments.map(s=>({...s,confidence:.2}))});q.observeTranscript({language:'korean',segments:[{startMs:0,endMs:1000,text:'뭐야?',confidence:.99}]});assert.equal(q.language,undefined);assert.equal(calls.length,0);
 q.observeTranscript(review);assert.equal(q.language,undefined);q.observeTranscript(review);
 assert.equal((await waiting)?.text,'お前');assert.deepEqual(calls,['ja']);q.dispose();
});

test('language learned during a pending auto decode retries unresolved captions in that language',async()=>{
 let release!:(value:undefined)=>void;const calls:(string|undefined)[]=[];
 const q=new OriginalCaptions({transcribe:async(_pcm:Float32Array,language?:string)=>{calls.push(language);if(calls.length===1)return new Promise(r=>release=r);return {language:'japanese',segments:[{startMs:0,endMs:800,text:'お前',confidence:.9}]};},enqueue:async()=>undefined} as unknown as BackgroundCaptions);
 const pending=q.enqueue(new Float32Array(48000));const review={language:'japanese',segments:[{startMs:0,endMs:3000,text:'危ないやつだったのか。違う、わけがあるんだ。',confidence:.9}]};
 q.observeTranscript(review);q.observeTranscript(review);release(undefined);
 assert.equal((await pending)?.text,'お前');assert.deepEqual(calls,[undefined,'ja']);q.dispose();
});

test('a failed old caption gets new context only after the current subtitle and does not spin',async()=>{
 const calls:number[]=[];let fallbacks=0;
 const q=new OriginalCaptions({transcribe:async(pcm:Float32Array)=>{calls.push(pcm.length);return {language:'japanese',segments:pcm.length===32000?[{startMs:100,endMs:900,text:'現在の字幕',confidence:.9}]:pcm.length===51200?[{startMs:0,endMs:800,text:'回復した字幕',confidence:.9}]:[]};},enqueue:async()=>{fallbacks++;return undefined;}} as unknown as BackgroundCaptions);
 q.setLanguage('ja');const old=q.enqueue(new Float32Array(16000));await tick();
 assert.equal((await q.enqueue(new Float32Array(32000)))?.text,'現在の字幕');
 assert.equal((await old)?.text,'回復した字幕');await tick();
 assert.deepEqual(calls,[16000,32000,51200]);assert.equal(fallbacks,1);q.dispose();
});

test('known-language backlog prioritizes the latest subtitle then backfills without a retry spin',async()=>{
 let release!:(value:any)=>void;const calls:number[]=[];
 const q=new OriginalCaptions({transcribe:async(pcm:Float32Array)=>{calls.push(pcm.length);if(calls.length===1)return new Promise(r=>release=r);return {language:'japanese',segments:pcm.length>48000?[]:[{startMs:0,endMs:800,text:'届いた字幕',confidence:.9}]};},enqueue:async()=>undefined} as unknown as BackgroundCaptions);
 q.setLanguage('ja');const first=q.enqueue(new Float32Array(16000));const middle=q.enqueue(new Float32Array(32000));const newest=q.enqueue(new Float32Array(48000));
 release(undefined);assert.equal((await newest)?.text,'届いた字幕');assert.equal((await middle)?.text,'届いた字幕');await tick();
 assert.deepEqual(calls,[16000,48000,32000,102400]);q.dispose();assert.equal(await first,undefined);
});

test('a clipped small-kana suffix from retained context cannot leak into the current caption',()=>{
 const result={language:'japanese',segments:[{startMs:280,endMs:1400,text:'やっ!',confidence:.98,words:[{startMs:280,endMs:440,text:'や'},{startMs:1240,endMs:1400,text:'っ'},{startMs:1240,endMs:1400,text:'!'}]},{startMs:1240,endMs:2440,text:'なんだお前!',confidence:.94,words:[{startMs:1240,endMs:1400,text:'なんだ'},{startMs:1720,endMs:1880,text:'お'},{startMs:2000,endMs:2160,text:'前'},{startMs:2280,endMs:2440,text:'!'}]}]};
 assert.equal(captionInRange(result,800,2548)?.text,'なんだお前!');
 assert.equal(captionInRange(result,0,2548)?.text,'やっ!\nなんだお前!');
 const full={language:'japanese',segments:[{startMs:900,endMs:1100,text:'っ!',confidence:.9,words:[{startMs:900,endMs:1100,text:'っ!'}]}]};
 assert.equal(captionInRange(full,800,1200)?.text,'っ!');
});

test('one periodic language probe cannot override the established source before confirmation',async()=>{
 let calls=0;const fallbackLanguages:string[]=[];
 const q=new OriginalCaptions({transcribe:async()=>++calls===6?{language:'english',segments:[{startMs:0,endMs:900,text:'This is a different language.',confidence:.99}]}:{language:'japanese',segments:[{startMs:0,endMs:900,text:'日本語の字幕',confidence:.9}]},enqueue:async(_pcm:Float32Array,language:string)=>{fallbackLanguages.push(language);return {text:'日本語を再確認',language:'japanese',confidence:.9};}} as unknown as BackgroundCaptions);
 q.observe('これは日本語の会話が続いています。','japanese');q.observe('まだ日本語の会話が続いています。','japanese');
 for(let i=0;i<5;i++)await q.enqueue(new Float32Array(16000));
 assert.equal((await q.enqueue(new Float32Array(16000)))?.text,'日本語を再確認');assert.equal(q.language,'ja');assert.deepEqual(fallbackLanguages,['ja']);q.dispose();
});

test('reusing a review caption cannot count the same language inference twice',async()=>{
 const q=new OriginalCaptions({} as BackgroundCaptions);
 q.observe('これは日本語の会話が続いています。','japanese');q.observe('まだ日本語の会話が続いています。','japanese');
 const review={language:'english',segments:[{startMs:0,endMs:900,text:'This is a different language.',confidence:.99}]};
 q.observeTranscript(review);assert.equal(q.language,'ja');
 await q.enqueue(new Float32Array(16000),{text:review.segments[0].text,language:review.language,confidence:.99});
 assert.equal(q.language,'ja');
 q.observeTranscript({...review,segments:[{...review.segments[0],text:'Now another English sentence follows.'}]});
 assert.equal(q.language,'en');q.dispose();
});

test('multiple captions from one automatic decode supply only one language vote',async()=>{
 const result={language:'japanese',segments:[{startMs:0,endMs:1200,text:'これは日本語の会話が続いています。',confidence:.9},{startMs:1400,endMs:2600,text:'まだ日本語の会話が続いています。',confidence:.9}]};
 const q=new OriginalCaptions({transcribe:async()=>result,enqueue:async()=>undefined} as unknown as BackgroundCaptions);
 assert.equal((await q.enqueue(new Float32Array(48000)))?.text,result.segments.map(s=>s.text).join('\n'));
 assert.equal(q.language,undefined);
 q.observeTranscript({...result});assert.equal(q.language,'ja');q.dispose();
});

test('a newly confirmed language wakes an idle failed caption without new audio',async()=>{
 const calls:(string|undefined)[]=[];
 const q=new OriginalCaptions({transcribe:async(_pcm:Float32Array,language?:string)=>{calls.push(language);return {language,segments:language==='en'?[{startMs:0,endMs:900,text:'Now this caption can appear.',confidence:.9}]:[]};},enqueue:async()=>undefined} as unknown as BackgroundCaptions);
 q.observe('これは日本語の会話が続いています。','japanese');q.observe('まだ日本語の会話が続いています。','japanese');
 const pending=q.enqueue(new Float32Array(16000));await tick();assert.deepEqual(calls,['ja']);
 q.observe('This is a different language.','english');q.observe('Now another English sentence follows.','english');
 await tick();assert.deepEqual(calls,['ja','en']);assert.equal((await pending)?.text,'Now this caption can appear.');q.dispose();
});

test('a delayed decode in the old source cannot undo a newly confirmed language',async()=>{
 let release!:(value:any)=>void;const calls:(string|undefined)[]=[];
 const q=new OriginalCaptions({transcribe:async(_pcm:Float32Array,language?:string)=>{calls.push(language);return calls.length===1?new Promise(r=>release=r):{language:'english',segments:[{startMs:0,endMs:900,text:'Now this caption can appear.',confidence:.9}]};},enqueue:async()=>undefined} as unknown as BackgroundCaptions);
 q.observe('これは日本語の会話が続いています。','japanese');q.observe('まだ日本語の会話が続いています。','japanese');
 const pending=q.enqueue(new Float32Array(16000));
 q.observe('This is a different language.','english');q.observe('Now another English sentence follows.','english');
 release({language:'japanese',segments:[{startMs:0,endMs:900,text:'これは古い日本語の会話です。',confidence:.9}]});
 await tick();assert.deepEqual(calls,['ja','en']);assert.equal((await pending)?.language,'english');assert.equal(q.language,'en');q.dispose();
});

test('an isolated fallback in the old source cannot overwrite newer language evidence',async()=>{
 let release!:(value:any)=>void;const calls:(string|undefined)[]=[];
 const q=new OriginalCaptions({transcribe:async(_pcm:Float32Array,language?:string)=>{calls.push(language);return {language,segments:language==='en'?[{startMs:0,endMs:900,text:'Now this caption can appear.',confidence:.9}]:[]};},enqueue:async()=>new Promise(r=>release=r)} as unknown as BackgroundCaptions);
 q.observe('これは日本語の会話が続いています。','japanese');q.observe('まだ日本語の会話が続いています。','japanese');
 const pending=q.enqueue(new Float32Array(16000));await tick();
 q.observe('This is a different language.','english');q.observe('Now another English sentence follows.','english');
 release({text:'これは古い日本語の会話です。',language:'japanese',confidence:.9});
 await tick();assert.deepEqual(calls,['ja','en']);assert.equal((await pending)?.language,'en');assert.equal(q.language,'en');q.dispose();
});

test('mismatched unusable source-tagged output cannot start an alternating-language retry loop',async()=>{
 const calls:(string|undefined)[]=[];let fallbacks=0,settled=false;
 const q=new OriginalCaptions({transcribe:async(_pcm:Float32Array,language?:string)=>{
  calls.push(language);
  // Bound this deliberately adversarial stub so a regression fails an
  // assertion instead of leaving the test runner in an infinite microtask loop.
  if(calls.length>8)return;
  const foreign=language==='ja'?'english':'japanese';
  return {language:foreign,segments:[{startMs:1500,endMs:2400,text:foreign==='english'?'This is a different language.':'これは日本語の会話が続いています。',confidence:.9}]};
 },enqueue:async()=>{fallbacks++;return undefined;}} as unknown as BackgroundCaptions);
 q.observe('これは日本語の会話が続いています。','japanese');q.observe('まだ日本語の会話が続いています。','japanese');
 q.observe('This is a different language.','english');
 const pending=q.enqueue(new Float32Array(16000)).then(value=>{settled=true;return value;});
 try{await tick();assert.deepEqual(calls,['ja']);assert.equal(fallbacks,1);assert.equal(q.language,'ja');assert.equal(settled,false);}
 finally{q.dispose();await pending;}
});

test('continuous real captured overlap repairs startup before one decode without displaying added context',async()=>{
 const f=await startupCapture(),rate=1.25,start=100000;let calls=0;
 const q=new OriginalCaptions({transcribe:async(pcm:Float32Array)=>{
  calls++;assert.equal(pcm.length,f.current.length+6400);
  assert.deepEqual(pcm.slice(0,6400+1536),f.previous.slice(f.matchedOffsetSamples-6400,f.matchedOffsetSamples+1536));
  assert.deepEqual(pcm.slice(6400+1536),f.current.slice(1536));
  return {language:'japanese',segments:[{startMs:100,endMs:780,text:'前の文なんだお前次の文',confidence:.9,words:[{startMs:100,endMs:200,text:'前の文'},{startMs:450,endMs:700,text:'なんだお前'},{startMs:760,endMs:780,text:'次の文'}]}]};
 },enqueue:async()=>{throw Error('the repaired primary caption must not add another decode');}} as unknown as BackgroundCaptions);
 q.setLanguage('ja');
 try{
  await q.enqueue(f.previous,{text:'前の文',language:'japanese',confidence:.9},{prefixMs:0,mediaStartMs:start,rate});
  const result=await q.enqueue(f.current,undefined,{prefixMs:16,suffixMs:32,mediaStartMs:start+f.expectedOffsetMs*rate,rate,continuation:true});
  assert.equal(result?.text,'なんだお前');assert.equal(calls,1);
 }finally{q.dispose();}
});

test('an already repaired previous caption retains its shifted media-time mapping',async()=>{
 const f=await startupCapture(),start=100000,currentStart=start+f.expectedOffsetMs,calls:Float32Array[]=[];
 const q=new OriginalCaptions({transcribe:async(pcm:Float32Array)=>{
  calls.push(pcm);return {language:'japanese',segments:[{startMs:450,endMs:650,text:'現在の字幕',confidence:.9}]};
 },enqueue:async()=>undefined} as unknown as BackgroundCaptions);q.setLanguage('ja');
 try{
  await q.enqueue(f.previous,{text:'前の文',language:'japanese',confidence:.9},{prefixMs:0,mediaStartMs:start,rate:1});
  assert.equal((await q.enqueue(f.current,undefined,{prefixMs:0,mediaStartMs:currentStart,rate:1,continuation:true}))?.text,'現在の字幕');
  // Another overlapping capture begins 32 ms later, still inside the measured
  // startup-zero interval. Its stable audio is already in the repaired entry.
  const next=f.current.slice(512);
  const waiting=q.enqueue(next,undefined,{prefixMs:0,mediaStartMs:currentStart+32,rate:1,continuation:true});
  await tick();assert.equal(calls.length,2);assert.equal(calls[1].length,next.length+6400);
  assert.equal((await waiting)?.text,'現在の字幕');
 }finally{q.dispose();}
});

test('trimming retained audio to twelve seconds preserves the expected overlap location',async()=>{
 const f=await startupCapture(),rate=1.5,start=100000,previous=new Float32Array(14000*16);
 previous.set(f.previous,previous.length-f.previous.length);let calls=0;
 const q=new OriginalCaptions({transcribe:async(pcm:Float32Array)=>{
  calls++;assert.equal(pcm.length,f.current.length+6400);return {language:'japanese',segments:[{startMs:450,endMs:650,text:'現在の字幕',confidence:.9}]};
 },enqueue:async()=>undefined} as unknown as BackgroundCaptions);q.setLanguage('ja');
 try{
  await q.enqueue(previous,{text:'以前の字幕',language:'japanese',confidence:.9},{prefixMs:0,mediaStartMs:start,rate});
  const mediaStartMs=start+((previous.length-f.previous.length)/16+f.expectedOffsetMs)*rate;
  assert.equal((await q.enqueue(f.current,undefined,{prefixMs:0,mediaStartMs,rate,continuation:true}))?.text,'現在の字幕');
  assert.equal(calls,1);
 }finally{q.dispose();}
});

test('missing continuity metadata, a rate change or existing natural context leaves captured input unchanged',async()=>{
 const f=await startupCapture(),previousContext:CaptionContext={prefixMs:0,mediaStartMs:100000,rate:1};
 const currentContext:CaptionContext={prefixMs:0,mediaStartMs:100000+f.expectedOffsetMs,rate:1,continuation:true};
 const longer=new Float32Array(16000);longer.set(f.current);
 const cases:{name:string;previous?:CaptionContext;current?:CaptionContext;pcm:Float32Array}[]=[
  {name:'no continuation',previous:previousContext,current:{...currentContext,continuation:false},pcm:f.current},
  {name:'no current context',previous:previousContext,pcm:f.current},
  {name:'no previous clock',previous:{prefixMs:0,rate:1},current:currentContext,pcm:f.current},
  {name:'no current clock',previous:previousContext,current:{...currentContext,mediaStartMs:undefined},pcm:f.current},
  {name:'no current rate',previous:previousContext,current:{...currentContext,rate:undefined},pcm:f.current},
  {name:'changed rate',previous:previousContext,current:{...currentContext,rate:1.5},pcm:f.current},
  {name:'enough existing prefix',previous:previousContext,current:{...currentContext,prefixMs:400},pcm:longer},
  {name:'unrelated media position',previous:previousContext,current:{...currentContext,mediaStartMs:200000},pcm:f.current},
 ];
 for(const c of cases){let calls=0;const q=new OriginalCaptions({transcribe:async(pcm:Float32Array)=>{
  calls++;assert.deepEqual(pcm,c.pcm,c.name);const start=(c.current?.prefixMs??0)+16;
  return {language:'japanese',segments:[{startMs:start,endMs:start+80,text:'現在の字幕',confidence:.9}]};
 },enqueue:async()=>undefined} as unknown as BackgroundCaptions);q.setLanguage('ja');
  try{await q.enqueue(f.previous,{text:'以前の字幕',language:'japanese',confidence:.9},c.previous);assert.equal((await q.enqueue(c.pcm,undefined,c.current))?.text,'現在の字幕');assert.equal(calls,1,c.name);}finally{q.dispose();}
 }
});

test('unknown language and explicit source changes cannot reuse earlier startup audio',async()=>{
 const f=await startupCapture(),previousContext:CaptionContext={prefixMs:0,mediaStartMs:100000,rate:1},currentContext:CaptionContext={prefixMs:0,mediaStartMs:100000+f.expectedOffsetMs,rate:1,continuation:true};
 for(const reset of [false,true]){let calls=0;
  const q=new OriginalCaptions({transcribe:async(pcm:Float32Array)=>{calls++;assert.deepEqual(pcm,f.current);return {language:'japanese',segments:[{startMs:100,endMs:300,text:'現在の字幕',confidence:.9}]};},enqueue:async()=>undefined} as unknown as BackgroundCaptions);
  try{
   if(reset)q.setLanguage('en');
   await q.enqueue(f.previous,{text:'以前の字幕',language:'japanese',confidence:.9},previousContext);
   if(reset)q.setLanguage('ja');
   const waiting=q.enqueue(f.current,undefined,currentContext);
   if(!reset){q.observe('これは日本語の会話が続いています。','japanese');q.observe('まだ日本語の会話が続いています。','japanese');}
   assert.equal((await waiting)?.text,'現在の字幕');assert.equal(calls,1);
  }finally{q.dispose();}
 }
});

test('a verified caption never performs a continuity decode',async()=>{
 const f=await startupCapture();let calls=0;
 const q=new OriginalCaptions({transcribe:async()=>{calls++;throw Error('verified captions must not decode again');}} as unknown as BackgroundCaptions);q.setLanguage('ja');
 const caption={text:'なんだお前',language:'japanese',confidence:.9};
 try{await q.enqueue(f.previous,{text:'前の文',language:'japanese',confidence:.9},{prefixMs:0,mediaStartMs:100000,rate:1});assert.deepEqual(await q.enqueue(f.current,caption,{prefixMs:0,mediaStartMs:100000+f.expectedOffsetMs,rate:1,continuation:true}),caption);assert.equal(calls,0);}finally{q.dispose();}
});

test('independent short caption decodes confirm source and publish cached text without another ASR',async()=>{
 let calls=0,firstPublished=false;const row=(text:string,startMs:number,endMs:number)=>({text,startMs,endMs,confidence:.7,timing:'aligned' as const,words:[{text,startMs,endMs}]});
 const q=new OriginalCaptions({transcribe:async()=>({language:'japanese',segments:++calls===1?[row('なるほど',500,900)]:[row('なるほど',500,900),row('宝物なわけだ',3500,4100)]}),enqueue:async()=>{throw Error('cached complete captions need no fallback decode');}} as unknown as BackgroundCaptions);
 try{
  const first=q.enqueue(new Float32Array(48000),undefined,{prefixMs:0,suffixMs:320,mediaStartMs:10000,rate:1}).then(v=>{firstPublished=true;return v;});
  await tick();assert.equal(calls,1);assert.equal(firstPublished,false);assert.equal(q.language,undefined);
  const second=q.enqueue(new Float32Array(48000),undefined,{prefixMs:0,suffixMs:320,mediaStartMs:13000,rate:1});
  assert.equal((await first)?.text,'なるほど');assert.equal((await second)?.text,'宝物なわけだ');await tick();assert.equal(q.language,'ja');assert.equal(calls,2);
 }finally{q.dispose();}
});

test('real two-row held transcript remains provisional and rolling recalculation cannot supply a second vote',async()=>{
 const {readFile}=await import('node:fs/promises');const f=JSON.parse(await readFile(new URL('./fixtures/bilibili-short-language-hold.json',import.meta.url),'utf8'));let calls=0,published=0;
 const q=new OriginalCaptions({transcribe:async()=>{calls++;return calls===1?undefined:structuredClone(f.raw);},enqueue:async()=>{throw Error('one short vote cannot force a language fallback');}} as unknown as BackgroundCaptions);
 const first=q.enqueue(new Float32Array(2720*16),undefined,{prefixMs:0,suffixMs:320,mediaStartMs:293750,rate:1}).then(v=>{published++;return v;});
 const second=q.enqueue(new Float32Array(2176*16),undefined,{prefixMs:0,suffixMs:128,mediaStartMs:296099,rate:1}).then(v=>{published++;return v;});
 try{
  await tick();assert.equal(calls,2);assert.equal(published,0);assert.equal(q.language,undefined);
  await q.enqueue(new Float32Array(1600),{text:'うん',language:'japanese',confidence:.9},{prefixMs:0,mediaStartMs:300000,rate:1});await tick();
  assert.equal(calls,3);assert.equal(published,0);assert.equal(q.language,undefined);
 }finally{q.dispose();await Promise.all([first,second]);}
});

test('a late automatic decode cannot revive provisional Japanese after independent reviews confirm English',async()=>{
 const row=(text:string,startMs:number,endMs:number)=>({text,startMs,endMs,confidence:.7,timing:'aligned' as const,words:[{text,startMs,endMs}]});
 const calls:(string|undefined)[]=[];let release!:(value:any)=>void;
 const q=new OriginalCaptions({transcribe:async(_pcm:Float32Array,language?:string)=>{
  calls.push(language);if(calls.length===1)return {language:'japanese',segments:[row('なるほど',500,900)]};
  if(calls.length===2)return new Promise(r=>release=r);
  return {language:'english',segments:[row('This is the current language.',500,900)]};
 },enqueue:async()=>undefined} as unknown as BackgroundCaptions);
 try{
  const first=q.enqueue(new Float32Array(48000),undefined,{prefixMs:0,suffixMs:320,mediaStartMs:10000,rate:1});await tick();assert.equal(q.language,undefined);
  const second=q.enqueue(new Float32Array(48000),undefined,{prefixMs:0,suffixMs:320,mediaStartMs:13000,rate:1});
  q.observeTranscript({language:'english',segments:[row('This is a different language.',0,900)]});
  q.observeTranscript({language:'english',segments:[row('Now another English sentence follows.',0,900)]});assert.equal(q.language,'en');
  release({language:'japanese',segments:[row('なるほど',500,900),row('宝物なわけだ',3500,4100)]});
  assert.equal((await second)?.language,'english');assert.equal((await first)?.language,'english');assert.equal(q.language,'en');assert.deepEqual(calls,[undefined,undefined,'en','en']);
 }finally{q.dispose();}
});

test('an independent short review confirms and publishes a waiting complete caption without another ASR',async()=>{
 let calls=0;const row=(text:string,startMs=500,endMs=900)=>({text,startMs,endMs,confidence:.7,timing:'aligned' as const,words:[{text,startMs,endMs}]});
 const q=new OriginalCaptions({transcribe:async()=>{calls++;return {language:'japanese',segments:[row('なるほど')]};},enqueue:async()=>{throw Error('review language should publish the cached caption');}} as unknown as BackgroundCaptions);
 try{
  const pending=q.enqueue(new Float32Array(48000),undefined,{prefixMs:0,suffixMs:320,mediaStartMs:10000,rate:1});await tick();assert.equal(q.language,undefined);
  q.observeTranscript({language:'japanese',segments:[row('宝物なわけだ')]},{start:0,end:3000,audioEnd:3000,mediaStartMs:14000,rate:1});
  assert.equal(q.language,'ja');assert.equal((await pending)?.text,'なるほど');assert.equal(calls,1);
 }finally{q.dispose();}
});

test('printed speech confirmation releases an already aligned first caption without re-decoding it',async()=>{
 let calls=0,published=false;
 const row={text:'見るの怖い',startMs:400,endMs:1400,confidence:.88,timing:'aligned' as const,words:[{text:'見るの怖い',startMs:400,endMs:1400}]};
 const q=new OriginalCaptions({transcribe:async()=>{calls++;return calls===1?{language:'japanese',segments:[row]}:undefined;},enqueue:async()=>undefined} as unknown as BackgroundCaptions);
 const first=q.enqueue(new Float32Array(2400*16),undefined,{prefixMs:300,suffixMs:320,mediaStartMs:5000,rate:1}).then(value=>{published=true;return value;});
 try{
  await tick();assert.equal(calls,1);assert.equal(published,false);assert.equal(q.language,undefined);
  q.confirmFromPrintedSpeech();await tick();
  assert.equal(published,true,'the complete cached subtitle becomes available as soon as its source is confirmed');
  assert.equal((await first)?.text,row.text);assert.equal(calls,1,'a second decoder failure cannot erase the cached first sentence');
 }finally{q.dispose();await first;}
});

test('printed Japanese confirmation does not release a provisional caption in another language',async()=>{
 let published=false;const languages:(string|undefined)[]=[];
 const row={text:'저기 있어',startMs:400,endMs:1400,confidence:.9,timing:'aligned' as const,words:[{text:'저기 있어',startMs:400,endMs:1400}]};
 const q=new OriginalCaptions({transcribe:async(_pcm:Float32Array,language?:string)=>{languages.push(language);return languages.length===1?{language:'korean',segments:[row]}:undefined;},enqueue:async()=>undefined} as unknown as BackgroundCaptions);
 const first=q.enqueue(new Float32Array(2400*16),undefined,{prefixMs:300,suffixMs:320,mediaStartMs:5000,rate:1}).then(value=>{published=true;return value;});
 try{
  await tick();q.confirmFromPrintedSpeech();await tick();
  assert.equal(q.language,'ja');assert.equal(published,false);assert.deepEqual(languages,[undefined,'ja']);
 }finally{q.dispose();assert.equal(await first,undefined);}
});

test('overlapping short review crops and repeated raw objects cannot become independent language votes',()=>{
 const row=(text:string,startMs=500,endMs=900)=>({text,startMs,endMs,confidence:.7,timing:'aligned' as const,words:[{text,startMs,endMs}]});
 const q=new OriginalCaptions({} as BackgroundCaptions),first={language:'japanese',segments:[row('なるほど')]};
 const range={start:0,end:3000,audioEnd:3000,mediaStartMs:10000,rate:1};
 try{
  q.observeTranscript(first,range);q.observeTranscript(first,range);assert.equal(q.language,undefined);
  q.observeTranscript({language:'japanese',segments:[row('なるほど',372,772)]},{...range,end:2872,audioEnd:2872,mediaStartMs:10128});assert.equal(q.language,undefined);
  q.observeTranscript({language:'japanese',segments:[row('宝物なわけだ')]},{...range,mediaStartMs:14000});assert.equal(q.language,'ja');
  q.observe('This is a different language.','english');q.observe('Now another English sentence follows.','english');assert.equal(q.language,'en');
  q.observeTranscript(first,range);assert.equal(q.language,'en','an already observed raw result cannot revive an earlier language');
 }finally{q.dispose();}
});


test('real closed 2.43-second first turn starts early but waits for independent later words before publication',async()=>{
 const {readFile}=await import('node:fs/promises');const f=JSON.parse(await readFile(new URL('./fixtures/bilibili-early-language.json',import.meta.url),'utf8'));
 const calls:number[]=[];let published=0;
 const q=new OriginalCaptions({transcribe:async(pcm:Float32Array,language?:string)=>{assert.equal(language,undefined);calls.push(pcm.length/16);return structuredClone(f.samples[calls.length-1].transcript);},enqueue:async()=>{throw Error('whole aligned captions do not need another decode');}} as unknown as BackgroundCaptions);
 const first=q.enqueue(new Float32Array(2432*16),undefined,{prefixMs:128,suffixMs:288,mediaStartMs:293750,rate:1}).then(v=>{published++;return v;});
 try{
  await tick();assert.deepEqual(calls,[2432]);assert.equal(q.language,undefined);assert.equal(published,0);
  const second=q.enqueue(new Float32Array(2912*16),undefined,{prefixMs:0,suffixMs:256,mediaStartMs:295798,rate:1});
  assert.equal((await first)?.text,'なるほど');
  // Preserve the actual recognizer output. This scheduling fix does not
  // pretend to repair the observed が/な particle error.
  assert.equal((await second)?.text,'宝物がわけだ');
  await tick();assert.equal(q.language,'ja');assert.deepEqual(calls,[2432,5344]);
 }finally{q.dispose();await first;}
});

test('early language probing requires a closed mapped turn and still waits on very short audio',async()=>{
 for(const context of [undefined,{prefixMs:0},{prefixMs:0,suffixMs:128},{prefixMs:0,suffixMs:0,mediaStartMs:10000,rate:1},{prefixMs:0,suffixMs:128,mediaStartMs:10000,rate:0}] as (CaptionContext|undefined)[]){
  let calls=0;const q=new OriginalCaptions({transcribe:async()=>{calls++;return undefined;}} as unknown as BackgroundCaptions);
  const pending=q.enqueue(new Float32Array(2432*16),undefined,context);await tick();assert.equal(calls,0);q.dispose();await pending;
 }
 let calls=0;const q=new OriginalCaptions({transcribe:async()=>{calls++;return undefined;}} as unknown as BackgroundCaptions);
 const pending=q.enqueue(new Float32Array(1500*16),undefined,{prefixMs:0,suffixMs:128,mediaStartMs:10000,rate:1});await tick();assert.equal(calls,0);q.dispose();await pending;
});


test('real final small kana survives the captured tail without borrowing the next word',async()=>{
 const {readFile}=await import('node:fs/promises');const f=JSON.parse(await readFile(new URL('./fixtures/bilibili-caption-small-kana-tail.json',import.meta.url),'utf8'));
 assert.equal(captionInRange(f.transcript,400,1776)?.text,'うっ、や');
 assert.equal(captionInRange(f.transcript,400,1776,2096)?.text,'うっ、やっ!');
 assert.equal(captionInRange(f.transcript,400,1776,1900)?.text,'うっ、や','no claim beyond actual captured audio');
 const changed=structuredClone(f.transcript);changed.segments[1].words.at(-2).text='前';
 assert.equal(captionInRange(changed,400,1776,2096)?.text,'うっ、や','a new lexical word is never appended as a suffix');
 const late=structuredClone(f.transcript);late.segments[1].words.at(-1).endMs=2300;
 assert.equal(captionInRange(late,400,1776,2400)?.text,'うっ、や','the real tail allowance remains bounded');
});

test('late exact audio and print agreement backfills only the accepted short caption without choosing a source language',async()=>{
 let release!:(value:any)=>void,published=false,calls=0;
 const q=new OriginalCaptions({transcribe:async()=>{calls++;return new Promise(r=>release=r);},enqueue:async()=>{throw Error('print agreement must not add another decode');}} as unknown as BackgroundCaptions);
 const context={prefixMs:320,suffixMs:320,mediaStartMs:131875,rate:1,printed:{text:'待て',confidence:.99}};
 const pending=q.enqueue(new Float32Array(2506*16),undefined,context).then(value=>{published=true;return value;});
 try{
  await tick();assert.equal(published,false);assert.equal(q.language,undefined);
  release({language:'japanese',segments:[{text:'待て！',startMs:400,endMs:1300,confidence:.8,timing:'aligned',words:[{text:'待て！',startMs:400,endMs:1300}]}]});await tick();
  assert.equal(published,true,'an accepted short turn need not wait for a different utterance to establish the global source');
  assert.equal((await pending)?.text,'待て！');assert.equal(q.language,undefined);assert.equal(calls,1);
 }finally{q.dispose();await pending;}
});

test('print cannot rescue a conflicting, clipped, unaligned or foreign short audio hypothesis',async()=>{
 const row={text:'それに',startMs:400,endMs:1300,confidence:.8,timing:'aligned' as const,words:[{text:'それに',startMs:400,endMs:1300}]};
 const base={language:'japanese',segments:[row]};
 const cases=[
  {name:'different audio words',result:{...base,segments:[{...row,text:'それで',words:[{...row.words[0],text:'それで'}]}]}},
  {name:'foreign language',result:{...base,language:'english'}},
  {name:'estimated alignment',result:{...base,segments:[{...row,timing:'estimated'}]}},
  {name:'missing words',result:{...base,segments:[{...row,words:undefined}]}},
  {name:'retained prefix word',result:{...base,segments:[{...row,startMs:100,text:'あ、それに',words:[{text:'あ、',startMs:100,endMs:200},...row.words]}]}},
  {name:'word extends outside captured audio',result:{...base,segments:[{...row,endMs:3000,words:[{...row.words[0],endMs:3000}]}]}},
  {name:'weak audio confidence',result:{...base,segments:[{...row,confidence:.59}]}},
  {name:'weak print confidence',result:base,printConfidence:.92},
  {name:'no matching print',result:base,printText:'待て'},
 ];
 for(const c of cases){let published=false;
  const q=new OriginalCaptions({transcribe:async()=>c.result,enqueue:async()=>undefined} as unknown as BackgroundCaptions);
  const context={prefixMs:320,suffixMs:320,mediaStartMs:133750,rate:1,printed:{text:c.printText??'それに',confidence:c.printConfidence??.99}};
  const pending=q.enqueue(new Float32Array(2506*16),undefined,context).then(value=>{published=true;return value;});
  try{await tick();assert.equal(published,false,c.name);assert.equal(q.language,undefined,c.name);}
  finally{q.dispose();assert.equal(await pending,undefined,c.name);}
 }
});

test('a late printed short caption cannot survive disposal or an explicit source change',async()=>{
 for(const change of ['dispose','language'] as const){let release!:(value:any)=>void;
  const q=new OriginalCaptions({transcribe:async()=>new Promise(r=>release=r),enqueue:async()=>undefined} as unknown as BackgroundCaptions);
  const context={prefixMs:320,suffixMs:320,mediaStartMs:133750,rate:1,printed:{text:'それに',confidence:.99}};
  const pending=q.enqueue(new Float32Array(2506*16),undefined,context);
  if(change==='dispose')q.dispose();else q.setLanguage('en');
  release({language:'japanese',segments:[{text:'それに',startMs:400,endMs:1300,confidence:.8,timing:'aligned',words:[{text:'それに',startMs:400,endMs:1300}]}]});
  assert.equal(await pending,undefined);await tick();assert.equal(q.language,change==='language'?'en':undefined);q.dispose();
 }
});

test('a historical print hint is distinct from later independent audio confirmation',()=>{
 const q=new OriginalCaptions({} as BackgroundCaptions);
 q.confirmFromPrintedSpeech(false);assert.equal(q.language,'ja');assert.equal(q.audioConfirmedLanguage,undefined);
 q.confirmFromPrintedSpeech();assert.equal(q.audioConfirmedLanguage,'ja');
 q.setLanguage('ja');assert.equal(q.audioConfirmedLanguage,undefined,'manual source selection is not a new audio observation');q.dispose();
});

test('restoring an earlier turn drops later PCM and fences its in-flight result while keeping earlier captions pending',async()=>{
 let release!:(result:any)=>void;const calls:number[]=[];
 const q=new OriginalCaptions({transcribe:async(pcm:Float32Array)=>{
  calls.push(pcm.length);if(calls.length===1)return new Promise(r=>release=r);
  return {language:'japanese',segments:[{text:'前の字幕',startMs:500,endMs:1500,confidence:.9}]};
 },enqueue:async()=>undefined} as unknown as BackgroundCaptions);q.setLanguage('ja');
 const first=q.enqueue(new Float32Array(48000),undefined,{prefixMs:320,suffixMs:320,mediaStartMs:10000,rate:1});
 const future=q.enqueue(new Float32Array(32000),undefined,{prefixMs:320,suffixMs:320,mediaStartMs:20000,rate:1});
 try{
  q.discardAfter(13000);assert.equal(await future,undefined);
  release({language:'english',segments:[{text:'This belongs to the later discarded window.',startMs:500,endMs:1500,confidence:.9}]});
  assert.equal((await first)?.text,'前の字幕');assert.deepEqual(calls,[48000,48000]);assert.equal(q.language,'ja');
 }finally{q.dispose();await first;}
});
