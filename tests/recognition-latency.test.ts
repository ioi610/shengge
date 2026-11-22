import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeechBoundary} from '../src/live-boundary';
import {StreamingSentences} from '../src/streaming-sentences';
import {warmCachedRecognition} from '../src/recognition-warmup';

test('lightweight pause detection closes at 960 ms without waiting for ASR or speaker inference',()=>{
 const detector=new SpeechBoundary(10000,960);
 for(let i=1;i<=50;i++)assert.equal(detector.push(10000+i*32,.95),undefined);
 // Natural brief pauses do not close the utterance.
 for(let i=51;i<80;i++)assert.equal(detector.push(10000+i*32,0),undefined);
 const result=detector.push(12560,0);
 assert(result);assert.equal(result.endMs,11680);
 assert.equal(detector.push(12592,0),undefined,'one candidate per pause');
});

test('live closed-window mode submits no speculative work and starts final ASR immediately',async()=>{
 let submits=0,release:((value:unknown)=>void)|undefined;const accepted:unknown[]=[];
 const stream=new StreamingSentences(0,s=>accepted.push(s),e=>{throw e;},async action=>{
  if(action==='submit'){submits++;return {id:'closed'};}
  if(action==='status')return new Promise(resolve=>{release=resolve;});
  return {};
 },undefined,true);
 for(let i=0;i<180;i++)stream.push(new Float32Array(512).fill(.04),(i+1)*32,.95);
 assert.equal(submits,0,'unfinished audio must not occupy the worker');
 stream.finish({startMs:0,endMs:5000,reason:'turn-end'},false);
 assert.equal(submits,1,'final audio starts without waiting for an obsolete job');
 await new Promise(r=>setImmediate(r));
 release!({state:'done',result:{streaming:true,segments:[{startMs:200,endMs:4500,text:'A complete sentence.',confidence:.95,timing:'aligned'}]}});
 for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));
 assert.equal(accepted.length,1);assert.equal(submits,1,'confirmation reuses the same decoded audio');stream.stop();
});

test('prewarming never creates a cache or downloads a missing model',async()=>{
 let prepared=0,opened=0;let present=false,entry=false;
 const storage={has:async()=>present,open:async()=>{opened++;return {match:async()=>entry?new Response('cached'):undefined};}} as unknown as CacheStorage;
 await warmCachedRecognition(()=>prepared++,storage);assert.equal(opened,0);assert.equal(prepared,0);
 present=true;await warmCachedRecognition(()=>prepared++,storage);assert.equal(prepared,0);
 entry=true;await warmCachedRecognition(()=>prepared++,storage);assert.equal(prepared,1);
});
