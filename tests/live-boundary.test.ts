import test from 'node:test';import assert from 'node:assert/strict';import {SpeechBoundary,continueSentence} from '../src/live-boundary';
test('automatic continuation absorbs seek tolerance without overlapping the previous sentence',()=>{
 const detected={startMs:4283,endMs:6300,text:'short reply',language:'japanese'};
 assert.deepEqual(continueSentence(detected,4300),{...detected,startMs:4300});assert.equal(detected.startMs,4283);
 assert.deepEqual(continueSentence({...detected,startMs:4500},4300),{...detected,startMs:4500});
 assert.throws(()=>continueSentence({...detected,startMs:4000},4300));
 assert.throws(()=>continueSentence({...detected,endMs:4290},4300));
});
test('streaming boundary waits for a short pause, excludes silence and retains brief within-phrase gaps',()=>{
 const b=new SpeechBoundary(1000);let result;
 for(let t=1000;t<=2000;t+=32)assert.equal(b.push(t,.9),undefined);
 for(let t=2000;t<2192;t+=32)assert.equal(b.push(t,.05),undefined);
 for(let t=2192;t<2600;t+=32)assert.equal(b.push(t,.8),undefined);
 for(let t=2600;t<=3300;t+=32)result??=b.push(t,.05);
 assert(result);assert.equal(result.startMs,1000);assert(result.endMs>=2600&&result.endMs<2700);
});
test('silence and tiny clicks never fabricate a sentence; video end can close actual speech',()=>{
 const b=new SpeechBoundary(0);for(let t=0;t<1000;t+=32)assert.equal(b.push(t,0),undefined);
 b.push(1000,.9);for(let t=1032;t<2000;t+=32)assert.equal(b.push(t,0),undefined);assert.equal(b.finish(2000),undefined);
 for(let t=2200;t<2800;t+=32)b.push(t,.9);assert(b.finish(2800));
});
