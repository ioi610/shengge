import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {SpeechOnset} from '../src/speech-onset';
import {StreamingSentences} from '../src/streaming-sentences';

test('recent moderate voice can veto a pause but stale or sparse evidence cannot',()=>{
 const s=new SpeechOnset();
 const frames=Array.from({length:100},(_,i)=>({atMs:i*32,speaker:i>=60?0:-1,confidence:.55}));
 s.observe(frames);assert(s.ongoingVoice(2000,3200));
 assert.equal(s.ongoingVoice(2000,3800),false,'old observations cannot hold playback indefinitely');
 s.observe(frames.map((f,i)=>({...f,speaker:i===99?0:-1})));assert.equal(s.ongoingVoice(2000,3200),false,'one isolated frame is insufficient');
 s.observe(frames.map((f,i)=>({...f,speaker:i>=90?0:-1})));assert.equal(s.ongoingVoice(1320,3200),false,'a separate later reply cannot block review of a closed earlier turn');
});
test('actual Chrome confidence dip does not close the prefix while the independent view still hears voice',async()=>{
 const rows=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/bilibili-premature-pause.json.gz',import.meta.url))).toString());
 const raw=new StreamingSentences(0,()=>{},e=>{throw e},async()=>({}),undefined,true);
 const guarded=new StreamingSentences(0,()=>{},e=>{throw e},async()=>({}),undefined,true);
 let n=0;
 for(const row of rows){
  const end=row.frames.at(-1).atMs;
  while((n+1)*32<=end+32){raw.push(new Float32Array(512),(n+1)*32,.01);guarded.push(new Float32Array(512),(n+1)*32,.01);n++;}
  raw.observeSpeech(row.frames);guarded.observeSpeech(row.frames);guarded.observeSpeech(row.focusedFrames,true);
 }
 const turn={startMs:1840,endMs:2391,reason:'turn-end' as const};
 assert(raw.acousticBoundary(turn),'reproduce the original premature fast decision');
 assert.equal(guarded.acousticBoundary(turn),undefined,'wait while the independent detector still hears the suffix');
 assert(guarded.acousticBoundary({...turn,reason:'speaker-change'}),'explicit speaker changes are not merged');
 raw.stop();guarded.stop();
});
