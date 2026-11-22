import test from 'node:test';import assert from 'node:assert/strict';import {SpeechOnset} from '../src/speech-onset';
import {StableTurns,closedSpeakerTurns} from '../src/speaker-turns';import {StreamingSentences} from '../src/streaming-sentences';
const observation=(end:number,confidence:number)=>Array.from({length:Math.floor(end/32)},(_,i)=>({atMs:i*32,speaker:i<64?0:-1,confidence}));
test('long continuation requires stronger agreement and cannot authorize remote sounds or cold starts',()=>{
 for(const confidence of [.5,.65]){const s=new SpeechOnset();for(let n=0;n<8;n++)s.observe(observation(2500+n*256,confidence));assert.equal(s.continuationStart(0,2200),undefined);}
 const s=new SpeechOnset();for(let n=0;n<3;n++)s.observe(observation(2500+n*256,.75));assert.equal(s.continuationStart(0,2200),undefined);s.observe(observation(3300,.75));assert.equal(s.continuationStart(0,2200),0);assert.equal(s.continuationStart(1000,3000),undefined);
 for(const origin of [0,5000]){const cold=new StreamingSentences(origin,()=>{},e=>{throw e},async()=>({}),undefined,true);for(let i=0;i<150;i++)cold.push(new Float32Array(512),origin+(i+1)*32,.01);for(let n=0;n<8;n++)cold.observeSpeech(observation(2500+n*256,.75));assert.equal(cold.acousticBoundary({startMs:origin,endMs:origin+2200}),undefined);cold.stop();}
});
test('actual 8.7-second continuation wait can be confirmed acoustically before the review times out',async()=>{
 const {readFile}=await import('node:fs/promises'),{gunzipSync}=await import('node:zlib');const r=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/bilibili-long-continuation.json.gz',import.meta.url))).toString());
 const s=new StreamingSentences(r.origin,()=>{},e=>{throw e},async()=>{throw Error('must not await transcription')},undefined,true,true),stable=new StableTurns();let frame=0,found:any;
 for(const o of r.observations){while(frame<r.audio.length&&r.audio[frame][0]<=o.position){const [time,p]=r.audio[frame++];s.push(new Float32Array(512),r.origin+time,p/1000);}const fs=o.frames.map(([atMs,speaker,c]:number[])=>({atMs,speaker,confidence:c/1000}));s.observeSpeech(fs);for(const t of stable.accept(closedSpeakerTurns(fs,o.position))){const b=s.acousticBoundary({...t,startMs:r.origin+t.startMs,endMs:r.origin+t.endMs});if(b&&b.startMs<=r.origin+200&&b.endMs>=r.origin+2500){found={...b,at:o.position};break;}}if(found)break;}
 assert(found,'recover the existing continuation, not a later independent reply');assert(found.at<5500,'do not wait for the eight-second decoder timeout');assert(found.endMs>=r.origin+2500,'retain the quiet ending');s.stop();
});
