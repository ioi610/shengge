import test from 'node:test';import assert from 'node:assert/strict';import {firstSpeakerTurn,StableTurn,SpeakerFrame} from '../src/speaker-turns';
const speech=(start:number,end:number,speaker:number):SpeakerFrame[]=>Array.from({length:Math.floor((end-start)/16.875)},(_,i)=>({atMs:start+i*16.875,speaker,confidence:.95}));
test('detect another speaker without a long silent gap and exclude that reply from the loop',()=>{
 const frames=[...speech(200,1200,0),...speech(1200,1400,-1),...speech(1400,1900,1)];const turn=firstSpeakerTurn(frames,1900);assert(turn);assert.equal(turn.reason,'speaker-change');assert(turn.endMs<1400);assert(turn.startMs<250);
});
test('keep a short mid-sentence pause when the same speaker continues',()=>{
 const frames=[...speech(200,1200,0),...speech(1200,1850,-1),...speech(1850,2600,0)];assert.equal(firstSpeakerTurn(frames,2800),undefined);assert(firstSpeakerTurn(frames,3600));
});
test('reject overlapping speakers, low-confidence guesses and unstable boundaries',()=>{
 assert.equal(firstSpeakerTurn([...speech(200,1200,0),...speech(1200,1700,-2)],3000),undefined);
 assert.equal(firstSpeakerTurn(speech(0,2000,0).map(f=>({...f,confidence:.4})),4000),undefined);
 const stable=new StableTurn(),turn={startMs:0,endMs:2000,reason:'speaker-change' as const,confidence:.9};assert.equal(stable.accept(turn),undefined);assert.equal(stable.accept({...turn,endMs:2500}),undefined);assert(stable.accept({...turn,endMs:2520}));
});

test('an internal sustained pause closes a sentence even if the same speaker has already resumed',()=>{
 const frames=[...speech(200,1200,0),...speech(1200,2400,-1),...speech(2400,3600,0)];
 const result=firstSpeakerTurn(frames,3800);assert(result);assert.equal(result.reason,'turn-end');assert(result.endMs<1400);
});
