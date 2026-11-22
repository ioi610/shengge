import test from 'node:test';import assert from 'node:assert/strict';
import {NativeMediaGaps} from '../src/native-media-gaps';
const ranges=(pairs:number[][])=>({length:pairs.length,start:(i:number)=>pairs[i][0]/1000,end:(i:number)=>pairs[i][1]/1000});
const real=ranges([[470694,489755.667],[489987.868,560784]]);
test('the observed Bilibili buffered gap can be matched during a later replay only',()=>{
 const gaps=new NativeMediaGaps();assert.equal(gaps.matches(real,489337.280,489987.868),false);
 gaps.observe(real,489293,489987.868);assert.equal(gaps.matches(real,489337.280,489987.868),true);
 assert.equal(new NativeMediaGaps().matches(real,489337.280,489987.868),false,'another video or connection has no evidence');
});
test('continuous buffered media, unknown gaps and invalid ranges do not create exceptions for user seeks',()=>{
 for(const buffer of [undefined,ranges([[470694,560784]]),ranges([[470694,488000],[489987.868,560784]]),ranges([[470694,489755.667],[490100,560784]])]){
  const gaps=new NativeMediaGaps();gaps.observe(buffer,489293,489987.868);assert.equal(gaps.matches(real,489337.280,489987.868),false);
 }
});
test('a remembered gap does not authorize a new endpoint, long jump, backwards seek or changed buffer gap',()=>{
 const gaps=new NativeMediaGaps();gaps.observe(real,489293,489987.868);
 for(const [from,to]of [[489337,490100],[487000,489987.868],[489987.868,489337],[489600,489987.868],[NaN,489987.868],[489337,Infinity]])assert.equal(gaps.matches(real,from,to),false);
 assert.equal(gaps.matches(ranges([[470694,489500],[489987.868,560784]]),489337,489987.868),false);
});

test('the 09:35 native gap can correct earlier on replay while still requiring the identical hole',()=>{
 const b=ranges([[550336.53,575265],[575799,624988.683]]),g=new NativeMediaGaps();
 assert.equal(g.matches(b,574716.483,575799),false);
 g.observe(b,575170.228,575799);
 assert.equal(g.matches(b,574716.483,575799),true);
 assert.equal(g.matches(b,574913.788,575799),true);
 assert.equal(g.matches(b,574400,575799),false);
 assert.equal(g.matches(b,574716.483,575990),false);
 assert.equal(g.matches(ranges([[550336,575050],[575799,624988]]),574716.483,575799),false);
});
test('a decoder jump at the saved sentence start gets one backward lead-in and cannot count on its own',()=>{
 const b=ranges([[555816,575265],[575799,630831]]),g=new NativeMediaGaps(),start=574037;
 assert.equal(g.rememberShortStart(b,574058,575799,start),true);
 assert.equal(g.rememberShortStart(b,574058,575799,start),false);
 assert.equal(g.replayStart(b,start,576442),572437);
 assert.equal(g.replayStart(b,start,575000),start);
 assert.equal(g.replayStart(b,574100,576442),574100);
 assert.equal(g.matches(b,574058,575799),false);
 assert.equal(g.matches(b,574927,575799),true);
 assert.equal(g.matches(b,574675,575799),true);
 assert.equal(g.matches(b,574058,575799),false);
 assert.equal(g.matches(b,574927,576099),false);
});
