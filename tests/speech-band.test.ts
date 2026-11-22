import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {speechBand} from '../src/speech-band';
import {CorroboratedTurns} from '../src/corroborated-turns';
import {StreamingSentences} from '../src/streaming-sentences';

test('detector filtering attenuates low rumble without changing captured audio',()=>{
 const tone=(hz:number)=>Float32Array.from({length:16000},(_,i)=>Math.sin(2*Math.PI*hz*i/16000)*.2);
 const energy=(a:Float32Array)=>Math.sqrt(a.slice(1600).reduce((sum,v)=>sum+v*v,0)/(a.length-1600));
 const low=tone(40),voice=tone(1000),saved=voice.slice();
 assert(energy(speechBand(low))/energy(low)<.25);
 assert(energy(speechBand(voice))/energy(voice)>.9);
 assert.deepEqual(voice,saved);assert.notEqual(speechBand(voice),voice);
 assert.equal(speechBand(new Float32Array()).length,0);
});

test('actual Chrome captured 6:33 voice is recovered by independent filtered evidence',async()=>{
 const r=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/bilibili-captured-band.json.gz',import.meta.url))).toString());
 const turns=new CorroboratedTurns(),s=new StreamingSentences(0,()=>{},e=>{throw e},async()=>{throw Error('must not wait for transcript')},undefined,true);
 let n=0,found: {startMs:number;endMs:number;delay:number}|undefined;
 for(const row of r.rows){
  while((n+1)*32<=row.at){s.push(new Float32Array(512),(n+1)*32,r.ps[n]);n++;}
  s.observeSpeech(row.frames);s.observeSpeech(row.filteredFrames,true);
  for(const t of turns.observe(row.filteredFrames,row.at)){
   const b=s.acousticBoundary({...t,focused:true});
   if(b&&b.startMs<3000&&b.endMs>=5100&&b.endMs<5800){found={...b,delay:row.at-b.endMs};break;}
  }
  if(found)break;
 }
 assert(found,'recover the target including its suffix, not the following response');
 assert(found.delay>=0&&found.delay<1200);s.stop();
});

test('speaker-only effects after a long gap require text review even when confidence is high',()=>{
 const s=new StreamingSentences(0,()=>{},e=>{throw e},async()=>({}),undefined,true);
 for(let i=0;i<360;i++)s.push(new Float32Array(512).fill(.02),(i+1)*32,.01);
 const frames=(end:number)=>Array.from({length:Math.floor(end/32)},(_,i)=>({atMs:i*32,speaker:i>=210&&i<270?0:-1,confidence:.95}));
 for(const focused of [false,true]){s.observeSpeech(frames(9500),focused);s.observeSpeech(frames(9800),focused);const turn={startMs:6500,endMs:8700,reason:'turn-end' as const,focused};assert.equal(s.acousticBoundary(turn),undefined);assert(s.reviewAudio(turn),'candidate remains reviewable instead of being dropped');}
 s.stop();
});
