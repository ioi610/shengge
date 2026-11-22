import test from 'node:test';import assert from 'node:assert/strict';
import {waitForStableMedia,captureDiscontinuity,smallForwardCorrection} from '../src/recognition-resume';
import {CapturedFrames} from '../src/captured-frames';
class Media extends EventTarget {readyState=2;seeking=true;error:unknown=null;}
test('buffer/seek recovery waits for usable audio and needs no manual continue',async()=>{
 const v=new Media();let resumed=false;const p=waitForStableMedia(v as unknown as HTMLMediaElement,new AbortController().signal).then(()=>resumed=true);
 v.dispatchEvent(new Event('canplay'));await Promise.resolve();assert.equal(resumed,false);
 v.seeking=false;v.readyState=3;v.dispatchEvent(new Event('seeked'));await p;assert.equal(resumed,true);
});
test('explicit pause cancels automatic recovery and errors remain real media errors',async()=>{
 const v=new Media(),c=new AbortController();const p=waitForStableMedia(v as unknown as HTMLMediaElement,c.signal);c.abort();await assert.rejects(p,{name:'AbortError'});
 v.error={code:2};await assert.rejects(waitForStableMedia(v as unknown as HTMLMediaElement,new AbortController().signal),/视频加载失败/);
});
test('stalled network has a bounded wait instead of an infinite automatic restart',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const v=new Media();const p=waitForStableMedia(v as unknown as HTMLMediaElement,new AbortController().signal);const rejection=assert.rejects(p,/视频仍在缓冲/);t.mock.timers.tick(30000);await rejection;
});
test('VAD queue delay keeps both ingress clocks, so normal playback is not a jump',async()=>{
 let media=1000,wall=2000,release!:()=>void;const seen:{media:number;wall:number}[]=[];
 const q=new CapturedFrames(()=>true,()=>media,async(_frame,_owner,time,received)=>{if(time===1000)await new Promise<void>(r=>release=r);seen.push({media:time,wall:received});},()=>wall);
 const a=q.push(new Float32Array(512));await new Promise(r=>setImmediate(r));media=1600;wall=2600;const b=q.push(new Float32Array(512));wall=9000;release();await Promise.all([a,b]);
 assert.deepEqual(seen,[{media:1000,wall:2000},{media:1600,wall:2600}]);assert.equal(captureDiscontinuity(1600,1000,2600,2000,1),false);
 assert.equal(captureDiscontinuity(10000,1000,2600,2000,1),true);assert.equal(captureDiscontinuity(500,1000,2600,2000,1),true);
});

test('original-site 6:21 correction is bounded separately from the 8:58 -> 10:11 skip',()=>{
 assert.equal(smallForwardCorrection(381179,380565,2250,2236,1),true);
 assert.equal(smallForwardCorrection(381211,380565,2282,2236,1),true);
 assert.equal(smallForwardCorrection(611011,538449,2523,2000,1),false);
 assert.equal(smallForwardCorrection(382565,380565,2250,2236,1),false);
 assert.equal(smallForwardCorrection(380400,380565,2250,2236,1),false);
 assert.equal(smallForwardCorrection(381179,380565,4000,2236,1),false);
 assert.equal(smallForwardCorrection(381179,NaN,2250,2236,1),false);
});
