import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoAdapter} from '../src/player';
let ad=false;
Object.assign(globalThis,{document:{querySelector:()=>ad?{}:null}});
class FakeVideo extends EventTarget {
 duration=10;currentSrc='blob:source';playbackRate=1;paused=true;seeking=false;isConnected=true;ended=false;position=0;throwSeek=false;playCalls=0;
 get currentTime(){return this.position;}
 set currentTime(n:number){if(this.throwSeek)throw new Error('unavailable');this.position=n;this.seeking=true;}
 pause(){this.paused=true;}
 async play(){this.playCalls++;this.paused=false;}
 finish(ms=this.position*1000){this.position=ms/1000;this.seeking=false;this.dispatchEvent(new Event('seeked'));}
}
function setup(key='youtube:abcdefghijk'){const v=new FakeVideo();return {v,a:new VideoAdapter(v as unknown as HTMLVideoElement,key)};}
test('pending seek is cancelled immediately on dispose and late seeked cannot revive it',async()=>{
 const {v,a}=setup();const rejection=assert.rejects(a.seek(2000),{code:'OPERATION_CANCELLED'});a.dispose();await rejection;v.finish();assert.equal(a.valid,false);assert.equal(a.seekingControlled,false);await assert.rejects(a.play(),{code:'CAPABILITY_LOST'});assert.equal(v.playCalls,0);
});
test('replacement seek cancels the previous operation and only its own target completes',async()=>{
 const {v,a}=setup();try{const old=assert.rejects(a.seek(2000),{code:'OPERATION_CANCELLED'});const current=a.seek(4000);await old;assert.equal(a.seekingControlled,true);v.finish(4000);await current;assert.equal(a.position,4000);}finally{a.dispose();}
});
test('source or advertisement changing during seek rejects even when the timestamp matches',async()=>{
 for(const kind of ['source','ad','element'] as const){const {v,a}=setup();try{const pending=assert.rejects(a.seek(2000),{code:'CAPABILITY_LOST'});if(kind==='source')v.currentSrc='blob:replacement';if(kind==='ad')ad=true;if(kind==='element')v.isConnected=false;v.finish(2000);await pending;assert.equal(v.playCalls,0);}finally{ad=false;a.dispose();}}
});
test('media errors and throwing seek setters fail without leaving a live request',async()=>{
 for(const event of ['error','emptied','setter']){const {v,a}=setup();try{if(event==='setter')v.throwSeek=true;const pending=assert.rejects(a.seek(2000),{code:'CAPABILITY_LOST'});if(event!=='setter')v.dispatchEvent(new Event(event));await pending;assert.equal(a.seekingControlled,false);}finally{a.dispose();}}
});
test('unknown, non-finite and out-of-range seeks are rejected before touching media',async()=>{
 const {v,a}=setup();try{for(const ms of [NaN,Infinity,-1,10001])await assert.rejects(a.seek(ms),{code:'INVALID_INTERVAL'});v.duration=NaN;await assert.rejects(a.seek(0),{code:'INVALID_INTERVAL'});assert.equal(v.currentTime,0);}finally{a.dispose();}
});
test('unrelated player stays untouched, replaced controller cannot pause or change the current player',async()=>{
 const first=setup(),other=setup('youtube:zyxwvutsrqp');const replacement=new VideoAdapter(first.v as unknown as HTMLVideoElement,'youtube:abcdefghijk');try{await replacement.play();await other.a.play();first.a.dispose();assert.equal(first.v.paused,false);assert.equal(other.v.paused,false);assert.equal(first.a.valid,false);assert.throws(()=>first.a.setRate(1),{code:'CAPABILITY_LOST'});replacement.pause();assert.equal(first.v.paused,true);assert.equal(other.v.paused,false);}finally{replacement.dispose();other.a.dispose();}
});
test('delayed acknowledgement from an obsolete play cannot pause the replacement adapter',async()=>{
 const {v,a}=setup();let finish!:()=>void;v.play=async()=>{v.paused=false;await new Promise<void>(resolve=>finish=resolve);};const old=assert.rejects(a.play(),{code:'CAPABILITY_LOST'});const replacement=new VideoAdapter(v as unknown as HTMLVideoElement,'youtube:abcdefghijk');finish();await old;assert.equal(v.paused,false);a.dispose();assert.equal(v.paused,false);replacement.dispose();
});
test('inaccurate completed seek is rejected and subsequent seek can recover',async()=>{
 const {v,a}=setup();try{const pending=assert.rejects(a.seek(2000),{code:'SEEK_TIMEOUT'});v.finish(2500);await pending;const retry=a.seek(2000);v.finish(2000);await retry;assert.equal(a.position,2000);}finally{a.dispose();}
});
test('seek timeout releases control and a later user retry can succeed',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const {v,a}=setup();try{const failed=assert.rejects(a.seek(2000),{code:'SEEK_TIMEOUT'});t.mock.timers.tick(15000);await failed;assert.equal(a.seekingControlled,false);const retry=a.seek(4000);v.finish(4000);await retry;}finally{a.dispose();t.mock.timers.reset();}
});
test('EOF to first prompt waits for a slow native buffer without replaying or requiring retry',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const {v,a}=setup();Object.assign(v,{position:10,readyState:1});let complete=false;
 try{const pending=a.seek(2000).then(()=>{complete=true;});t.mock.timers.tick(4500);await Promise.resolve();assert.equal(complete,false);assert.equal(a.seekingControlled,true);assert.equal(v.playCalls,0);v.finish();await pending;assert.equal(complete,true);assert.equal(a.position,2000);}finally{a.dispose();t.mock.timers.reset();}
});
test('ready exact target recovers a missing seeked event, but metadata alone cannot complete',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const {v,a}=setup();const media=Object.assign(v,{readyState:1});let complete=false;
 try{const pending=a.seek(2000).then(()=>{complete=true;});v.seeking=false;t.mock.timers.tick(4000);await Promise.resolve();assert.equal(complete,false);media.readyState=4;t.mock.timers.tick(100);await pending;assert.equal(complete,true);assert.equal(v.playCalls,0);}finally{a.dispose();t.mock.timers.reset();}
});
test('slow buffered seek remains cancellable and cannot survive source replacement',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const {v,a}=setup();try{const cancelled=assert.rejects(a.seek(2000),{code:'OPERATION_CANCELLED'});t.mock.timers.tick(4000);a.cancelSeek();await cancelled;const invalid=assert.rejects(a.seek(4000),{code:'CAPABILITY_LOST'});v.currentSrc='blob:replacement';t.mock.timers.tick(100);await invalid;assert.equal(v.playCalls,0);}finally{a.dispose();t.mock.timers.reset();}
});

test('metadata wait resolves cached or new metadata and aborts obsolete loads',async()=>{
 const {waitForMetadata}=await import('../src/player');const v=Object.assign(new FakeVideo(),{readyState:0,error:null});const signal=new AbortController();const pending=waitForMetadata(v as unknown as HTMLVideoElement,signal.signal);v.readyState=1;v.dispatchEvent(new Event('loadedmetadata'));await pending;await waitForMetadata(v as unknown as HTMLVideoElement,signal.signal);v.readyState=0;const cancelled=assert.rejects(waitForMetadata(v as unknown as HTMLVideoElement,signal.signal),{code:'OPERATION_CANCELLED'});signal.abort();await cancelled;v.dispatchEvent(new Event('loadedmetadata'));
});
test('metadata error and timeout release pending listeners for retry',async()=>{
 const {waitForMetadata}=await import('../src/player');const v=Object.assign(new FakeVideo(),{readyState:0,error:null});const signal=new AbortController();const failed=assert.rejects(waitForMetadata(v as unknown as HTMLVideoElement,signal.signal),{code:'MEDIA_UNAVAILABLE'});v.dispatchEvent(new Event('error'));await failed;await assert.rejects(waitForMetadata(v as unknown as HTMLVideoElement,signal.signal,5),{code:'MEDIA_TIMEOUT'});const retry=waitForMetadata(v as unknown as HTMLVideoElement,signal.signal);v.readyState=1;v.dispatchEvent(new Event('loadedmetadata'));await retry;
});

test('normal speed remains available when the site was opened at slow speed',()=>{const v=new FakeVideo();v.playbackRate=.5;const a=new VideoAdapter(v as unknown as HTMLVideoElement,'youtube:abcdefghijk');try{assert(a.rates.includes(1));a.setRate(1);assert.equal(v.playbackRate,1);}finally{a.dispose();}});
