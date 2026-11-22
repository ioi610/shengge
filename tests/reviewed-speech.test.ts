import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewedSpeech} from '../src/reviewed-speech';
import {PendingTurns} from '../src/pending-turns';
import {SpeechOnset} from '../src/speech-onset';
import {StreamingSentences} from '../src/streaming-sentences';

const frames=(from:number,to:number)=>Array.from({length:to-from+1},(_,i)=>from+i);
const noText={language:'japanese',segments:[]};
const turn=(startMs:number,endMs:number)=>({startMs,endMs,reason:'turn-end' as const});

test('focused 21.9 second candidate shapes do not repeatedly decode completed unchanged voice',()=>{
 // These bounds are the actual four proposals in focused-diagnostics.json,
 // origin=316000. The evidence is deliberately fixed to isolate scheduling;
 // the real trace does not retain all speaker observations past seven seconds.
 const first=turn(1257,3336),coarse=turn(258,3579),refined=turn(1790,3757),tail=turn(2846,3663);
 const old=new PendingTurns();old.discardReviewed(first);old.discardReviewed(coarse,4539);
 assert.equal(old.wasReviewed(refined),false,'endpoint jitter plus the timeout margin previously allowed another decode');
 old.discardReviewed(refined,4717);assert.equal(old.wasReviewed(tail),false,'the shifted start also evaded endpoint-based suppression');
 const attempts=new ReviewedSpeech();
 const evidence={frames:[...frames(45,69),...frames(91,105)],focused:false};
 attempts.remember(first,evidence,undefined,'ja');
 assert.equal(attempts.has(coarse,evidence,'ja'),false,'a timeout is not a completed negative result');
 attempts.remember(coarse,evidence,noText,'ja');
 assert.equal(attempts.has(refined,{frames:evidence.frames.filter(i=>i>=56),focused:false},'ja'),true);
 assert.equal(attempts.has(tail,{frames:frames(91,105),focused:false},'ja'),true);
 assert.equal(attempts.has(turn(1790,6000),{frames:evidence.frames.filter(i=>i>=56),focused:false},'ja'),true,'extra silence does not invent new voice evidence');
});

test('new weak voice, adjacent replies and independent islands retain their own review',()=>{
 const attempts=new ReviewedSpeech(),first=turn(1000,3200);
 attempts.remember(first,{frames:[...frames(32,40),...frames(90,99)],focused:false},noText,'ja');
 assert.equal(attempts.has(turn(2800,3200),{frames:frames(90,99),focused:false},'ja'),false,'a distinct island inside a coarse failed proposal is not the first utterance');
 assert.equal(attempts.has(turn(1300,1650),{frames:frames(41,50),focused:false},'ja'),false,'nearby independent weak speech contains new supported samples');
 assert.equal(attempts.has(first,{frames:[...frames(32,40),100],focused:false},'ja'),false,'even one newly supported bin permits a retry');
 assert.equal(attempts.has({...first,reason:'speaker-change'},{frames:frames(32,40),focused:false},'ja'),false);
});

test('different evidence paths, language or usable but poorly timed text cannot be suppressed',()=>{
 const attempts=new ReviewedSpeech(),candidate=turn(1000,1500),evidence={frames:frames(32,40),focused:false};
 attempts.remember(candidate,evidence,{language:'japanese',segments:[{startMs:0,endMs:300,text:'なんだお前',confidence:.9}]},'ja');
 assert.equal(attempts.has(candidate,evidence,'ja'),false);
 attempts.remember(candidate,evidence,noText,'ja');
 assert.equal(attempts.has(candidate,{...evidence,focused:true},'ja'),false);
 assert.equal(attempts.has(candidate,evidence,'en'),false);
 assert.equal(attempts.has(candidate,{frames:[],focused:false},'ja'),false);
});

test('review evidence uses the existing repeated moderate speaker gate and PCM clock',()=>{
 const onset=new SpeechOnset();
 const observation=(confidence:number)=>frames(10,19).map(i=>({atMs:i*32,speaker:0,confidence}));
 onset.observe(observation(.5));assert.deepEqual(onset.reviewSupport(0,1000),[]);
 onset.observe(observation(.5));assert.deepEqual(onset.reviewSupport(0,1000),frames(10,19));
 assert.equal(onset.canReview(0,1000),true);
 const stream=new StreamingSentences(10000,()=>{},e=>{throw e;},async()=>({}),undefined,true);
 try{
  for(let i=0;i<50;i++)stream.push(new Float32Array(512),(i+1)*64+10000,0);
  stream.observeSpeech(observation(.5));stream.observeSpeech(observation(.5));
  assert.deepEqual(stream.reviewEvidence(turn(10000,12000)),{frames:frames(10,19),focused:false});
  assert.deepEqual(stream.reviewEvidence({...turn(10000,12000),focused:true}),{frames:[],focused:true});
 }finally{stream.stop();}
});
