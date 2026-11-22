import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeechOnset} from '../src/speech-onset';
function fixture(isVoice:(ms:number)=>boolean,vad:(ms:number)=>number=(ms:number)=>isVoice(ms)? .95:.02){
 const onset=new SpeechOnset();for(let i=0;i<300;i++)onset.push(vad(i*32));
 const frames=Array.from({length:570},(_,i)=>({atMs:i*16.875,speaker:isVoice(i*16.875)?0:-1,confidence:.95}));
 return {onset,frames};
}
test('skip previous tail and instrumental lead-in even with VAD music false positives',()=>{
 const {onset,frames}=fixture(ms=>ms<80||ms>=3600&&ms<6000,()=>.95);
 onset.observe(frames);assert.equal(onset.resolve(0,6000),undefined,'one acoustic hypothesis cannot establish onset');
 onset.observe(frames);const start=onset.resolve(0,6000)!;assert(start>=3480&&start<=3600);
});
test('keep beginning across natural pauses; do not select the last speech island',()=>{
 const {onset,frames}=fixture(ms=>ms>=1000&&ms<2500||ms>=3100&&ms<5000);onset.observe(frames);onset.observe(frames);
 const start=onset.resolve(1000,5000)!;assert(start>=870&&start<=1000);
});
test('reject music without corroborating voice and retain onset at recording start',()=>{
 const noise=fixture(()=>false,()=>.95);noise.onset.observe(noise.frames);noise.onset.observe(noise.frames);assert.equal(noise.onset.resolve(0,5000),undefined);
 const voice=fixture(ms=>ms<2000);voice.onset.observe(voice.frames);voice.onset.observe(voice.frames);assert.equal(voice.onset.resolve(0,2000),0);
});

test('stable high-confidence timed words and strong VAD retain a shout missed by the speaker model',()=>{
 const {onset,frames}=fixture(()=>false,()=>.95);onset.observe(frames);onset.observe(frames);
 assert.equal(onset.resolve(3000,5000),undefined);
 const start=onset.resolve(3000,5000,true)!;assert(start>=2840&&start<=3000,'timed word bounds exclude the music introduction');
 const quiet=fixture(()=>false,()=>.1);quiet.onset.observe(quiet.frames);quiet.onset.observe(quiet.frames);assert.equal(quiet.onset.resolve(3000,5000,true),undefined,'text alone never establishes voice');
});

test('audio-aligned onset rejects silent PCM and only pads the actual word anchor',async()=>{
 const {alignedSpeechOnset}=await import('../src/speech-onset');
 assert.equal(alignedSpeechOnset(new Float32Array(48000),1000,2000),undefined);
 const samples=new Float32Array(48000);samples.fill(.05,16000,32000);assert.equal(alignedSpeechOnset(samples,1000,2000),800);
});

test('confirmed first word never moves forward to a later easy-to-detect word',()=>{
 const {onset,frames}=fixture(ms=>ms>=1800&&ms<3500);onset.observe(frames);onset.observe(frames);
 assert(onset.resolve(1000,3500)!>1600,'legacy search reproduces the clipped opening');
 assert.equal(onset.wordStart(1000,3500),undefined,'retry alignment instead of looping a suffix');
});
test('recover the beginning of a continuous utterance when the token anchor is late',()=>{
 const {onset,frames}=fixture(ms=>ms>=1000&&ms<3500);onset.observe(frames);onset.observe(frames);
 const start=onset.wordStart(1800,3500)!;assert(start>=880&&start<=1000);
});
test('backtracking cannot cross a sustained gap into the previous sentence',()=>{
 const {onset,frames}=fixture(ms=>ms>=200&&ms<900||ms>=1500&&ms<3500);onset.observe(frames);onset.observe(frames);
 const start=onset.wordStart(1800,3500)!;assert(start>=1350&&start<=1500);
});

test('aligned words plus repeated speaker evidence preserve a stylised voice that VAD misses',()=>{
 const {onset,frames}=fixture(ms=>ms>=1000&&ms<3500,()=>.05);onset.observe(frames);onset.observe(frames);
 assert.equal(onset.wordStart(1600,3500),undefined);
 const start=onset.wordStart(1600,3500,false,true)!;assert(start>=880&&start<=1000);
});
