import test from 'node:test';import assert from 'node:assert/strict';
import {StreamingTurns,TurnAnalyzer} from '../src/turn-model';import {firstSpeakerTurn,SpeakerFrame} from '../src/speaker-turns';
test('a stale tail cannot anchor dialogue after a long musical gap',async()=>{
 const accepted:any[]=[];
 const model:TurnAnalyzer={dispose(){},async analyze(pcm,offset,ended){const frames:SpeakerFrame[]=Array.from({length:Math.floor(pcm.length/16/16.875)},(_,i)=>{const atMs=offset+i*16.875;return {atMs,speaker:atMs<350||atMs>=17000&&atMs<19000?0:-1,confidence:.95};});return {frames,decision:firstSpeakerTurn(frames,offset+pcm.length/16,ended)};}};
 const stream=new StreamingTurns(model,0,1,t=>accepted.push(t),e=>{throw e;});
 for(let i=0;i<680;i++){stream.push(new Float32Array(512),(i+1)*32);if(i%16===0)await new Promise(r=>setImmediate(r));}await stream.finish();stream.stop();
 const later=accepted.filter(t=>t.endMs>18000);assert(later.length);assert(later.every(t=>t.startMs>16000),'old tail must not become a 19-second sentence');
});
test('a later stable turn uses its own onset instead of an old rejected speech island',async()=>{
 const accepted:any[]=[];
 const model:TurnAnalyzer={dispose(){},async analyze(pcm,offset){return {frames:[0,17,34].map(atMs=>({atMs,speaker:0,confidence:.95})),decision:offset+pcm.length/16>=3500?{startMs:2200,endMs:3000,reason:'turn-end' as const,confidence:.95}:undefined};}};
 const stream=new StreamingTurns(model,10000,1,t=>accepted.push(t),e=>{throw e;});
 for(let i=0;i<160;i++){stream.push(new Float32Array(512),10000+(i+1)*32);if(i%16===0)await new Promise(r=>setImmediate(r));}
 await stream.finish();stream.stop();assert(accepted.length);assert(accepted.every(t=>t.startMs===12200&&t.endMs===13000));
});

test('rejecting an old reviewed turn exposes the next utterance before the ten-second window rolls',async()=>{
 const accepted:any[]=[];
 const model:TurnAnalyzer={dispose(){},async analyze(pcm,offset,ended){const frames:SpeakerFrame[]=Array.from({length:Math.floor(pcm.length/16/16.875)},(_,i)=>{const atMs=offset+i*16.875;return {atMs,speaker:atMs<600||atMs>=2500&&atMs<3500?0:-1,confidence:.95};});return {frames,decision:firstSpeakerTurn(frames,offset+pcm.length/16,ended)};}};
 const stream=new StreamingTurns(model,10000,1,t=>accepted.push(t),e=>{throw e;});
 for(let i=0;i<80;i++){stream.push(new Float32Array(512),10000+(i+1)*32);await new Promise(r=>setImmediate(r));}
 stream.ignoreBefore(10750);accepted.length=0;
 for(let i=80;i<180;i++){stream.push(new Float32Array(512),10000+(i+1)*32);await new Promise(r=>setImmediate(r));}
 await stream.finish();stream.stop();assert(accepted.length);assert(accepted.every(t=>t.startMs>12000&&t.endMs>13400));
});
