import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MicVAD} from '@ricky0123/vad-web';
import {LiveSpeech} from '../src/live-speech';
import {VideoAdapter} from '../src/player';
import {StreamingTurns} from '../src/turn-model';
import {StreamingSentences} from '../src/streaming-sentences';
import {BackgroundCaptions} from '../src/background-captions';
import type {PendingTurn} from '../src/pending-turns';
const fixture=JSON.parse(await readFile(new URL('./fixtures/bilibili-continuous-printed-split.json',import.meta.url),'utf8'));
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
class Video extends EventTarget{
 duration=631;currentSrc='blob:continuous-print';playbackRate=1;paused=true;seeking=false;isConnected=true;ended=false;readyState=4;error=null;
 position=fixture.stored[0].startMs/1000;playCalls=0;seeks:number[]=[];frame?:VideoFrameRequestCallback;
 get currentTime(){return this.position;}set currentTime(value:number){this.seeks.push(value);this.position=value;}
 pause(){if(!this.paused){this.paused=true;this.dispatchEvent(new Event('pause'));}}
 async play(){this.playCalls++;this.paused=false;this.dispatchEvent(new Event('play'));}
 requestVideoFrameCallback(callback:VideoFrameRequestCallback){this.frame=callback;return 1;}
 cancelVideoFrameCallback(){this.frame=undefined;}
}
async function setup(t:TestContext){
 t.mock.timers.enable({apis:['setTimeout']});
 class Context{sampleRate=16000;state='suspended';async resume(){this.state='running';}async close(){}}
 for(const[key,value]of Object.entries({AudioContext:Context,document:Object.assign(new EventTarget(),{hidden:false,querySelector:()=>null,createElement:()=>({})}),window:new EventTarget(),location:new URL('https://example.test/')})){
  const prior=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true});
  t.after(()=>{if(prior)Object.defineProperty(globalThis,key,prior);else Reflect.deleteProperty(globalThis,key);});
 }
 t.mock.method(MicVAD,'new',async()=>({start:async()=>{},pause:async()=>{},destroy:async()=>{},processFrame:async()=>{}} as unknown as MicVAD));
 let tracker!:StreamingTurns;
 t.mock.method(StreamingTurns.prototype,'push',function(this:StreamingTurns){tracker=this;});
 t.mock.method(StreamingTurns.prototype,'finish',async()=>{});
 t.mock.method(StreamingSentences.prototype,'acousticBoundary',(turn:PendingTurn)=>({startMs:turn.startMs,endMs:turn.endMs}));
 t.mock.method(StreamingSentences.prototype,'captionAudio',()=>({pcm:new Float32Array(32000),prefixMs:0,suffixMs:320,mediaStartMs:12268}));
 t.mock.method(BackgroundCaptions.prototype,'transcribe',async()=>undefined);
 const video=new Video(),adapter=new VideoAdapter(video as unknown as HTMLVideoElement,'bilibili:continuous-print');
 const speech=new LiveSpeech(adapter,async()=>({}),{analyze:async()=>({decision:undefined,frames:[]}),dispose:()=>{}});speech.useLanguage('ja');
 let reading:{text:string;confidence:number;min:number}|undefined={text:fixture.text,confidence:.99,min:.99};
 (speech as any).visualReader={read:async()=>reading,dispose:()=>{}};
 const controller=new AbortController();let settled=false;
 const pending=speech.detect(controller.signal).finally(()=>{settled=true;});void pending.catch(()=>{});
 t.after(async()=>{controller.abort();await pending.catch(()=>{});speech.dispose();adapter.dispose();});
 await tick();
 // Invoke the active capture owner once to expose the actual tracker callbacks.
 (speech as any).frame(0,new Float32Array(512),adapter.position,performance.now());
 const observe=async(at:number,shown=true)=>{
  reading=shown?{text:fixture.text,confidence:.99,min:.99}:undefined;
  video.position=at/1000;video.frame?.(0,{mediaTime:at/1000} as VideoFrameCallbackMetadata);await tick();
 };
 const emit=(reason:PendingTurn['reason']='turn-end')=>(tracker as any).accept({...fixture.stored[0],reason});
 const voice=()=>{(tracker as any).observe([12500,12532,12564].map(at=>({atMs:at-fixture.stored[0].startMs,speaker:0,confidence:.95})),false);};
 for(let at=12500;at<=15500;at+=250)await observe(at);
 return {video,speech,controller,pending,observe,emit,voice,settled:()=>settled};
}

test('a still-observed printed line cannot become two full-text halves when the old four-second fallback expires',async t=>{
 const s=await setup(t);s.emit();await tick();assert.equal(s.settled(),false);
 // Wall time may advance while OCR remains fresh in media time. The fallback
 // is not independent evidence that the still-visible sentence has ended.
 t.mock.timers.tick(4000);await tick();assert.equal(s.settled(),false);
 assert.equal(s.video.paused,false);assert.deepEqual(s.video.seeks,[]);
 s.voice();await s.observe(15750);await s.observe(16000);await s.observe(16250);await s.observe(16700,false);await s.observe(16900,false);
 const boundary=await s.pending;
 assert.equal(boundary?.text,fixture.text);assert.equal(boundary!.startMs,fixture.stored[0].startMs);assert.ok(boundary!.endMs>=16370);
 assert.equal(s.video.playCalls,1);assert.deepEqual(s.video.seeks,[]);
});

test('EOF cannot attach a complete open printed line to an earlier partial acoustic interval',async t=>{
 const s=await setup(t);s.emit();await tick();
 s.video.ended=true;s.video.dispatchEvent(new Event('ended'));await tick();
 const boundary=await s.pending;
 assert.equal(boundary?.endMs,fixture.stored[0].endMs);
 assert.equal(boundary?.text,undefined);assert.ok(boundary?.caption);
 assert.deepEqual(s.video.seeks,[]);
});

test('an explicit speaker change keeps independent dialogue even while the same printed words remain on screen',async t=>{
 const s=await setup(t);s.voice();s.emit('speaker-change');await tick();
 assert.equal(s.settled(),true,'a different speaker must not wait for the shared printed row to disappear');
 const boundary=await s.pending;
 assert.equal(boundary?.endMs,fixture.stored[0].endMs);assert.equal(boundary?.text,undefined);assert.ok(boundary?.caption);
 assert.deepEqual(s.video.seeks,[]);
});

test('a later confirmed speaker change releases the earlier deferred interval instead of merging different speakers under one line',async t=>{
 const s=await setup(t);s.emit();await tick();assert.equal(s.settled(),false);
 s.voice();s.emit('speaker-change');await tick();assert.equal(s.settled(),true);
 const boundary=await s.pending;assert.equal(boundary?.endMs,fixture.stored[0].endMs);assert.equal(boundary?.text,undefined);assert.ok(boundary?.caption);
 assert.deepEqual(s.video.seeks,[]);
});

test('losing fresh observations releases the provisional interval without copying an unclosed full caption',async t=>{
 const s=await setup(t);s.emit();await tick();t.mock.timers.tick(4000);await tick();
 assert.equal(s.settled(),false);
 s.video.position=16.5;t.mock.timers.tick(155);await tick();
 const boundary=await s.pending;assert.equal(boundary?.endMs,fixture.stored[0].endMs);assert.equal(boundary?.text,undefined);assert.ok(boundary?.caption);
 assert.deepEqual(s.video.seeks,[]);
});

test('aborting the extended printed-line wait cancels its timer and cannot later submit or replay a boundary',async t=>{
 const s=await setup(t);s.emit();await tick();t.mock.timers.tick(4000);await tick();assert.equal(s.settled(),false);
 s.controller.abort();await assert.rejects(s.pending,{name:'AbortError'});
 t.mock.timers.tick(10000);await tick();assert.equal(s.video.paused,true);assert.equal(s.video.playCalls,1);assert.deepEqual(s.video.seeks,[]);
});
