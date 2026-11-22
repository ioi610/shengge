import test from 'node:test';
import assert from 'node:assert/strict';
import {findNextDialogue,NonDialogue} from '../src/dialogue-search';
import {StreamingSentences} from '../src/streaming-sentences';

test('music and effects automatically continue to dialogue while preserving captured look-ahead',async()=>{
 let position=1000,runs=0,skips=0;const seeks:number[]=[];
 const result=await findNextDialogue({signal:new AbortController().signal,position:()=>position,duration:()=>20000,seek:async n=>{seeks.push(n);position=n;},searching:()=>skips++,detect:async()=>{runs++;if(runs===1){position=6000;throw new NonDialogue(4800);}if(runs===2){position=8500;throw new NonDialogue(7500);}return {startMs:8100,endMs:9800};}});
 assert.deepEqual(seeks,[4800,7500]);assert.equal(skips,2);assert.equal(runs,3);assert.deepEqual(result,{startMs:8100,endMs:9800});
});
test('music through end of video finishes normally without seeking back to the start',async()=>{
 let seeks=0,position=1000;assert.equal(await findNextDialogue({signal:new AbortController().signal,position:()=>position,duration:()=>4000,seek:async()=>{seeks++;},searching:()=>{},detect:async()=>{position=4000;throw new NonDialogue(4000);}}),undefined);assert.equal(seeks,0);
});
test('cancellation while continuing cannot start another capture',async()=>{
 const controller=new AbortController();let runs=0,position=1000;
 await assert.rejects(findNextDialogue({signal:controller.signal,position:()=>position,duration:()=>4000,seek:async()=>controller.abort(),searching:()=>{},detect:async()=>{runs++;position=2500;throw new NonDialogue(2000);}}),{name:'AbortError'});assert.equal(runs,1);
});
test('ASR errors and uncertain speech remain errors instead of being auto-skipped',async()=>{
 for(const error of [new Error('recognition unavailable'),new Error('unstable sentence')])await assert.rejects(findNextDialogue({signal:new AbortController().signal,position:()=>0,duration:()=>4000,seek:async()=>assert.fail('must not skip'),searching:()=>assert.fail('must not skip'),detect:async()=>{throw error;}}),error);
});
test('a stalled detector pauses instead of inventing forward seeks through unseen footage',async()=>{
 let runs=0;
 await assert.rejects(findNextDialogue({signal:new AbortController().signal,position:()=>0,duration:()=>500,seek:async()=>assert.fail('no forward seek'),searching:()=>{},detect:async()=>{runs++;throw new NonDialogue(10000);}}),/未跳过/);
 assert.equal(runs,1);
});
test('future recognition timestamps cannot skip unplayed music or empty scenes',async()=>{
 let position=0,runs=0;const controller=new AbortController();
 await assert.rejects(findNextDialogue({signal:controller.signal,position:()=>position,duration:()=>20000,seek:async()=>assert.fail('continue at the actual frame'),searching:()=>{},detect:async()=>{if(runs++===0){position=1000;throw new NonDialogue(19000,20000);}assert.equal(position,1000);controller.abort();throw new DOMException('paused','AbortError');}}),{name:'AbortError'});
 assert.equal(runs,2);
});
test('final silence and stable music labels produce a typed continuation, never a saved sentence',async()=>{
 for(const probability of [0,.95]){
  const errors:Error[]=[];
  const stream=new StreamingSentences(10000,()=>assert.fail('no sentence'),e=>errors.push(e),async action=>action==='submit'?{id:'test'}:action==='status'?{state:'done',result:{streaming:true,segments:[{startMs:0,endMs:2400,text:'♪~',confidence:.9}]}}:{},undefined,true);
  for(let i=0;i<80;i++)stream.push(new Float32Array(512),10000+(i+1)*32,probability);
  stream.finish({startMs:10000,endMs:12400});for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));
  assert.equal(errors.length,1);assert(errors[0] instanceof NonDialogue);assert.equal(errors[0].resumeAt,12400);stream.stop();
 }
});
test('failed ASR transport reports once and cannot turn into a music skip',async()=>{
 const errors:Error[]=[];let calls=0;const failure=new Error('offline');
 const stream=new StreamingSentences(0,()=>assert.fail(),e=>errors.push(e),async()=>{calls++;throw failure;},undefined,true);
 for(let i=0;i<80;i++)stream.push(new Float32Array(512),(i+1)*32,.95);
 stream.finish({startMs:0,endMs:2500});for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));
 assert.equal(calls,1);assert.deepEqual(errors,[failure]);stream.stop();
});

test('a disappearing uncertain spoken hypothesis is not silently reclassified as music',async()=>{
 let reads=0;const errors:Error[]=[];
 const stream=new StreamingSentences(0,()=>assert.fail(),e=>errors.push(e),async action=>action==='submit'?{id:'test'}:action==='status'?{state:'done',result:{streaming:true,segments:++reads===1?[{startMs:0,endMs:2000,text:'uncertain words',confidence:.2}]:[]}}:{},undefined,true);
 for(let i=0;i<80;i++)stream.push(new Float32Array(512),(i+1)*32,.95);
 stream.finish({startMs:0,endMs:2500});for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));
 assert.equal(errors.length,1);assert(!(errors[0] instanceof NonDialogue));stream.stop();
});

test('music recovery retains onset context before a provisional word instead of seeking into its first syllable',async()=>{
 let reads=0;const errors:Error[]=[];
 const stream=new StreamingSentences(10000,()=>assert.fail(),e=>errors.push(e),async action=>action==='submit'?{id:'test'}:action==='status'?{state:'done',result:{streaming:true,segments:++reads===1?[{startMs:1500,endMs:2200,text:'Perhaps words!',confidence:.7}]:[{startMs:0,endMs:2500,text:'♪~',confidence:.55}]}}:{});
 for(let i=0;i<80;i++)stream.push(new Float32Array(512),10000+(i+1)*32,.95);
 for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 for(let i=80;i<120;i++)stream.push(new Float32Array(512),10000+(i+1)*32,.95);
 for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 stream.finish({startMs:10000,endMs:13840});for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));
 assert.equal(errors.length,1);assert(errors[0] instanceof NonDialogue);assert.equal(errors[0].resumeAt,10700);stream.stop();
});

test('the same rejected sound window is rechecked once, not replayed in 100ms increments forever',async()=>{
 let position=50000,calls=0;const seeks:number[]=[];
 const result=await findNextDialogue({signal:new AbortController().signal,position:()=>position,duration:()=>94000,seek:async n=>{position=n;seeks.push(n);},searching:()=>{},detect:async()=>{
  calls++;if(calls<=2){position=59000;throw new NonDialogue(50500,58000);}
  assert(position>=58000);return {startMs:65000,endMs:67000};
 }});
 assert.deepEqual(seeks,[50500,58000]);assert.equal(calls,3);assert.deepEqual(result,{startMs:65000,endMs:67000});
});
