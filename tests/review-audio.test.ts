import test from 'node:test';import assert from 'node:assert/strict';
import {StreamingSentences} from '../src/streaming-sentences';

test('a delayed review retains the candidate tail without swallowing a later louder reply',()=>{
 const s=new StreamingSentences(0,()=>{},e=>{throw e;},async()=>({}),'japanese',true);
 try{
  for(let i=0;i<190;i++)s.push(new Float32Array(512).fill(i*32<3500?.05:.9),(i+1)*32,.5);
  const evidence=Array.from({length:180},(_,i)=>({atMs:i*16,speaker:i*16>=800&&i*16<2200?0:-1,confidence:.8}));
  s.observeSpeech(evidence);s.observeSpeech(evidence);
  const review=s.reviewAudio({startMs:1000,endMs:2000});assert(review);
  assert(review.pcm.length/16>=2800);assert(review.pcm.length/16<=3040);assert(Math.max(...review.pcm)<.06,'later reply must not enter an old candidate review');
  assert(review.toMedia(0)<=80,'review includes the replay lead-in rather than forcing a second decode');
  assert(review.toMedia(review.pcm.length/16)>=2900,'retain approximately 960ms of quiet ending');
 }finally{s.stop();}
});

test('subtitle audio retains only captured closing context without extending the replay interval',()=>{
 const s=new StreamingSentences(10000,()=>{},e=>{throw e;},async()=>({}),'ja',true);
 try{
  for(let i=0;i<100;i++)s.push(new Float32Array(512).fill(i),(i+1)*32+10000,.5);
  const turn={startMs:11024,endMs:13008};const a=s.captionAudio(turn);
  assert(a.prefixMs>0);assert(a.suffixMs>0&&a.suffixMs<=320);assert.equal(a.pcm.at(-1),99,'cannot invent unplayed future audio');
  assert.equal(a.pcm.length/16-a.prefixMs-a.suffixMs,s.audioFor(turn).length/16);
  assert.deepEqual(turn,{startMs:11024,endMs:13008});
 }finally{s.stop();}
});
