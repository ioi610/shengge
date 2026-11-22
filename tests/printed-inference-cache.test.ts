import test from 'node:test';
import assert from 'node:assert/strict';
import {PrintedInferenceCache} from '../src/printed-inference-cache';

test('only identical sampled pixels share an inference, including in-flight work',async()=>{
 const c=new PrintedInferenceCache<number>();
 let calls=0;
 const run=()=>Promise.resolve(++calls);
 const read=(a:number[])=>c.read(Float32Array.from(a),run);
 const a=read([1,1,0,-1]), b=read([1,1,0,-1]);
 assert.equal(a,b);
 assert.equal(await a,1);assert.equal(await read([1,1,0,1]),2);
 assert.equal(await read([1,1,0]),3);assert.equal(await read([1,1,0,-1]),1);
 await read([4]);await read([5]);assert.equal(await read([1,1,0,1]),6);
 c.clear();assert.equal(await read([5]),7);
});
test('a transient failed inference can be retried on the same frame',async()=>{
 const c=new PrintedInferenceCache<number>(),pixels=new Float32Array([1,0]);
 await assert.rejects(c.read(pixels,async()=>{throw Error('model stopped');}));
 assert.equal(await c.read(pixels,async()=>42),42);
});
