import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewedTurn} from '../src/uncertain-turn';
import {StreamingSentences} from '../src/streaming-sentences';
import type {TextSentence} from '../src/sentence-confirmation';

const row:TextSentence={startMs:320,endMs:1900,text:'ニンニクカラメで',confidence:.8,timing:'aligned',words:[{startMs:320,endMs:600,text:'ニンニク'},{startMs:1600,endMs:1900,text:'カラメで'}]};
test('a timed transcript corroborates a weak candidate and keeps its quiet final words',()=>{
 const result=reviewedTurn({segments:[row],language:'ja'},{startMs:300,endMs:900},2600);
 assert(result);assert.equal(result.startMs,120);assert.equal(result.endMs,2220);assert.equal(result.text,row.text);
});
test('review rejects unaligned, weak, clipped, malformed, musical and unrelated transcripts',()=>{
 for(const bad of [{...row,timing:undefined},{...row,confidence:.3},{...row,endMs:2550},{...row,startMs:NaN},{...row,text:'♪ music ♪'},{...row,text:'because'},{...row,startMs:1800,endMs:2100},{...row,words:[{startMs:500,endMs:500,text:'invented'}]}]){
  assert.equal(reviewedTurn({segments:[bad]},{startMs:300,endMs:900},2600),undefined);
 }
});
test('moderate repeated speaker evidence requests review, never authorizes fast playback',()=>{
 const s=new StreamingSentences(0,()=>{},()=>{},async()=>({}),undefined,true);
 for(let i=0;i<125;i++)s.push(new Float32Array(512).fill(.05),(i+1)*32,.02);
 const f=Array.from({length:235},(_,i)=>({atMs:i*16.875,speaker:i*16.875>=1000&&i*16.875<2100?0:-1,confidence:.65}));
 s.observeSpeech(f);assert.equal(s.reviewAudio({startMs:900,endMs:2100}),undefined);
 s.observeSpeech(f);assert.equal(s.acousticBoundary({startMs:900,endMs:2100}),undefined);
 const audio=s.reviewAudio({startMs:900,endMs:2100});assert(audio);assert(audio.pcm.length<=192000);assert(audio.toMedia(audio.candidate.startMs)<=900);
 s.stop();
});

test('real 1:38 Bilibili evidence rejected by the fast path is retained for short review',async()=>{
 const {readFile}=await import('node:fs/promises'),{gunzipSync}=await import('node:zlib');
 const e=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/bilibili-quiet-turn.json.gz',import.meta.url))).toString());
 const s=new StreamingSentences(e.from*1000,()=>{},()=>{},async()=>({}),undefined,true);
 e.ps.forEach((p:number,i:number)=>s.push(new Float32Array(512).fill(.05),e.from*1000+(i+1)*32,p));
 for(const o of e.observations)s.observeSpeech(o.frames);
 assert.equal(s.acousticBoundary(e.turn),undefined);const audio=s.reviewAudio(e.turn);assert(audio,'do not silently discard this real weak turn');assert(audio.pcm.length<=192000);s.stop();
});

test('a low-confidence prefix row cannot hide an aligned row for the candidate',()=>{
 const noise={...row,startMs:0,endMs:100,text:'uncertain sound',confidence:.1};
 assert.equal(reviewedTurn({segments:[noise,row]},{startMs:300,endMs:900},2600)?.text,row.text);
});

test('text review must not extend a speaker-change boundary into the reply',()=>{
 assert.equal(reviewedTurn({segments:[row]},{startMs:300,endMs:900,reason:'speaker-change'},2600),undefined);
 const short={...row,endMs:850,words:[{startMs:320,endMs:850,text:'はい'}]};
 assert.equal(reviewedTurn({segments:[short]},{startMs:300,endMs:900,reason:'speaker-change'},2600)?.endMs,900);
});

test('decoder repetition artifacts do not become subtitles or reviewed dialogue',async()=>{
 const {isDialogueText}=await import('../src/sentence-confirmation');
 assert.equal(isDialogueText('んんんんんんんんんん'),false);assert.equal(isDialogueText('あ'),true);assert.equal(isDialogueText('大丈夫、大丈夫'),true);
});

test('one humming token cannot authorize a long weak sound but short spoken replies remain eligible',()=>{
 const hum={...row,text:'んー',startMs:500,endMs:800,words:[{startMs:500,endMs:800,text:'ん'}]};
 assert.equal(reviewedTurn({segments:[hum]},{startMs:300,endMs:2400},3000),undefined);
 assert(reviewedTurn({segments:[hum]},{startMs:300,endMs:900},1500));
});

test('borderline speaker scores may request text review but cannot authorize a fast loop',async()=>{
 const {SpeechOnset}=await import('../src/speech-onset');const s=new SpeechOnset();for(let i=0;i<100;i++)s.push(.02);
 const f=Array.from({length:180},(_,i)=>({atMs:i*16.875,speaker:0,confidence:.5}));s.observe(f);s.observe(f);
 assert.equal(s.acousticStart(0,2000),undefined);assert.equal(s.canReview(0,2000),true);
});

test('unknown-language review needs matching text, language and aligned timing in a second crop',async()=>{
 const {agreeingReview}=await import('../src/uncertain-turn');const a={startMs:320,endMs:1900,text:'大丈夫。',language:'japanese',confidence:.8};
 assert(agreeingReview(a,{...a,startMs:192,endMs:1772,text:'大丈夫！'},128));
 assert.equal(agreeingReview({...a,language:'auto'},{...a,language:'auto'},0),undefined);
 assert.equal(agreeingReview(a,{...a,language:'hindi'},0),undefined);assert.equal(agreeingReview(a,{...a,text:'別の言葉'},0),undefined);assert.equal(agreeingReview(a,{...a,startMs:900},0),undefined);
});

test('sound annotations cannot become dialogue or authorize review, while spoken sound words remain valid',async()=>{
 const {isDialogueText}=await import('../src/sentence-confirmation');
 for(const text of ['*growls*','*makes a noise*','*Scream*','*growls*\n*makes a noise*','（笑）','[music] (laughs)','[music [loud]]']){
  assert.equal(isDialogueText(text),false,text);
  assert.equal(reviewedTurn({segments:[{...row,text}]},{startMs:300,endMs:900},2600),undefined);
 }
 for(const text of ['I heard a scream.','あっ!','これは（笑）面白い','*I* said hello.'])assert.equal(isDialogueText(text),true,text);
});
