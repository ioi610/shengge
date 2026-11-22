import test from 'node:test';
import assert from 'node:assert/strict';
import {CapturedFrames} from '../src/captured-frames';
test('slow inference keeps ingress timestamps and never overlaps recurrent VAD calls',async()=>{
 let clock=1000,release!:()=>void,active=0;const results:number[]=[];const owner={};
 const queue=new CapturedFrames(()=>owner,()=>clock,async(_frame,_owner,time)=>{
  assert.equal(active++,0);if(time===1000)await new Promise<void>(r=>release=r);results.push(time);active--;
 });
 const a=queue.push(new Float32Array(512));await new Promise(r=>setImmediate(r));clock=1032;const b=queue.push(new Float32Array(512));clock=2300;release();await Promise.all([a,b]);
 assert.deepEqual(results,[1000,1032]);
});
test('queued frames from a stopped search do not enter the next recognition session',async()=>{
 let owner:object|undefined={},release!:()=>void;const times:number[]=[];let clock=1000;
 const queue=new CapturedFrames(()=>owner,()=>clock,async(_frame,_owner,time)=>{if(time===1000)await new Promise<void>(r=>release=r);times.push(time);});
 const a=queue.push(new Float32Array(512));await new Promise(r=>setImmediate(r));clock=1032;const b=queue.push(new Float32Array(512));owner={};clock=5000;const c=queue.push(new Float32Array(512));release();await Promise.all([a,b,c]);assert.deepEqual(times,[1000,5000]);
});

test('closing admission preserves already captured in-flight and queued PCM for the same owner',async()=>{
 const owner={};let accepting=true,clock=1000,release!:()=>void;
 const seen:number[]=[];
 const queue=new CapturedFrames(()=>owner,()=>clock,async(_frame,_owner,time)=>{if(time===1000)await new Promise<void>(resolve=>{release=resolve;});seen.push(time);},()=>clock,()=>accepting);
 const first=queue.push(new Float32Array(512));await new Promise<void>(r=>setImmediate(r));
 clock=1032;const queued=queue.push(new Float32Array(512));
 accepting=false;clock=1064;await queue.push(new Float32Array(512));
 release();await Promise.all([first,queued,queue.drain()]);
 assert.deepEqual(seen,[1000,1032],'only PCM already accepted before the hold is drained');
 accepting=true;clock=1096;await queue.push(new Float32Array(512));assert.deepEqual(seen,[1000,1032,1096]);
});

test('revoking an owner still discards its queued PCM even when admission is separately closed',async()=>{
 let owner:object|undefined={},accepting=true,clock=1000,release!:()=>void;const seen:number[]=[];
 const queue=new CapturedFrames(()=>owner,()=>clock,async(_frame,_owner,time)=>{if(time===1000)await new Promise<void>(resolve=>{release=resolve;});seen.push(time);},()=>clock,()=>accepting);
 const first=queue.push(new Float32Array(512));await new Promise<void>(r=>setImmediate(r));clock=1032;const queued=queue.push(new Float32Array(512));
 accepting=false;owner=undefined;release();await Promise.all([first,queued,queue.drain()]);assert.deepEqual(seen,[1000]);
});
