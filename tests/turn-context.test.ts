import test from 'node:test';
import assert from 'node:assert/strict';
import {StreamingTurns,type TurnAnalyzer,type TurnContext} from '../src/turn-model';
import {firstSpeakerTurn,type SpeakerFrame} from '../src/speaker-turns';
const tick=()=>new Promise<void>(r=>setImmediate(r));
const context=():TurnContext=>({samples:new Float32Array(64*512).fill(.1),times:Array.from({length:64},(_,i)=>10000+(i+1)*32),origin:10000,endMs:12048,rate:1});

test('neighbouring searches retain model context but never emit or vote with past speech',async()=>{
 const seed=context(),seen:any[]=[],accepted:any[]=[],observed:SpeakerFrame[][]=[];
 const model:TurnAnalyzer={dispose(){},async analyze(pcm,offset,ended){seen.push({length:pcm.length,first:pcm[0]});const frames=Array.from({length:Math.floor(pcm.length/16/32)},(_,i)=>{const atMs=offset+i*32;return {atMs,speaker:atMs<1000||atMs>=2248&&atMs<2848?0:-1,confidence:.95};});return {frames,focusedFrames:frames,decision:firstSpeakerTurn(frames,offset+pcm.length/16,ended)};}};
 const stream=new StreamingTurns(model,12048,1,t=>accepted.push(t),e=>{throw e},undefined,f=>observed.push(f),seed);
 for(let i=0;i<65;i++){stream.push(new Float32Array(512).fill(.2),12048+(i+1)*32);await tick();}
 await stream.finish();
 assert(seen[0].length>seed.samples.length);assert.equal(seen[0].first,seed.samples[0]);
 assert(accepted.length);assert(accepted.every(t=>t.startMs>=12048&&t.endMs>12700));
 assert(observed.every(f=>f.every(x=>x.atMs>=0&&x.atMs<2200)),'observations use the new capture clock and exclude history');
 const next=stream.contextThrough(12848)!;assert(next.times.every(t=>t<=12848));assert.equal(next.samples.length,next.times.length*512);assert(next.samples.includes(seed.samples[0]));
 stream.stop();assert.equal(seed.samples.length,64*512,'the next window owns its context copy');
});

test('manual jumps and playback-rate changes cannot reuse neighbouring context',async()=>{
 for(const [origin,rate]of [[15000,1],[12048,2]]){
  const first:number[]=[];const model:TurnAnalyzer={dispose(){},async analyze(pcm){first.push(pcm[0]);return {frames:[],decision:undefined};}};
  const stream=new StreamingTurns(model,origin,rate,()=>{},e=>{throw e},undefined,undefined,context());
  for(let i=0;i<40;i++){stream.push(new Float32Array(512).fill(.2),origin+(i+1)*32);await tick();}
  await stream.finish();assert(first.length);assert(first.every(x=>Math.abs(x-.2)<1e-6));stream.stop();
 }
});

test('retained audio is bounded and excludes unplayed future look-ahead',async()=>{
 const model:TurnAnalyzer={dispose(){},async analyze(){return {frames:[],decision:undefined};}};
 const stream=new StreamingTurns(model,0,1,()=>{},e=>{throw e});
 for(let i=0;i<600;i++){stream.push(new Float32Array(512).fill(i),(i+1)*32);if(i%16===0)await tick();}
 const retained=stream.contextThrough(16000)!;assert.equal(retained.times.length,312);assert.equal(retained.times.at(-1),16000);assert.equal(retained.samples.at(-1),499);assert.equal(retained.origin,6016);stream.stop();
});
