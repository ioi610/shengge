import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {MicVAD} from '@ricky0123/vad-web';
import {LiveSpeech,type LiveBoundary} from '../src/live-speech';
import {VideoAdapter} from '../src/player';
import {StreamingTurns} from '../src/turn-model';
import {StreamingSentences} from '../src/streaming-sentences';
import {BackgroundCaptions,type Transcript} from '../src/background-captions';
import type {PendingTurn} from '../src/pending-turns';

const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const accepted={startMs:100500,endMs:101500,reason:'turn-end' as const};
const printed={text:'こんにちは',confidence:.99,min:.99};
const match:Transcript={language:'japanese',segments:[{text:printed.text,startMs:0,endMs:1000,confidence:.99}]};
class Video extends EventTarget{
 duration=200;currentSrc='blob:visual-defer';playbackRate=1;paused=true;seeking=false;isConnected=true;ended=false;readyState=4;error=null;
 position=100;playCalls=0;seeks:number[]=[];frame?:VideoFrameRequestCallback;
 get currentTime(){return this.position;}set currentTime(value:number){this.seeks.push(value);this.position=value;}
 pause(){if(!this.paused){this.paused=true;this.dispatchEvent(new Event('pause'));}}
 async play(){this.playCalls++;this.paused=false;this.dispatchEvent(new Event('play'));}
 requestVideoFrameCallback(callback:VideoFrameRequestCallback){this.frame=callback;return 1;}
 cancelVideoFrameCallback(){this.frame=undefined;}
}
async function setup(t:TestContext,singleWindow=false){
 let cleanup=async()=>{};t.after(()=>cleanup());
 t.mock.method(console,'debug',()=>{});
 t.mock.timers.enable({apis:['setTimeout']});
 class Context{sampleRate=16000;state='suspended';async resume(){this.state='running';}async close(){}}
 for(const[key,value]of Object.entries({AudioContext:Context,document:Object.assign(new EventTarget(),{hidden:false,querySelector:()=>null,createElement:()=>({})}),window:new EventTarget(),location:new URL('https://example.test/')})){
  const prior=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true});
  t.after(()=>{if(prior)Object.defineProperty(globalThis,key,prior);else Reflect.deleteProperty(globalThis,key);});
 }
 t.mock.method(MicVAD,'new',async()=>({start:async()=>{},pause:async()=>{},destroy:async()=>{},processFrame:async()=>{}} as unknown as MicVAD));
 let tracker!:StreamingTurns,fast=false;
 t.mock.method(StreamingTurns.prototype,'push',function(this:StreamingTurns){tracker=this;});
 t.mock.method(StreamingTurns.prototype,'finish',async()=>{});
 t.mock.method(StreamingSentences.prototype,'acousticBoundary',(turn:PendingTurn)=>fast?{startMs:turn.startMs,endMs:turn.endMs}:undefined);
 t.mock.method(StreamingSentences.prototype,'reviewAudio',()=>({pcm:new Float32Array(32000).fill(.1),candidate:{startMs:500,endMs:1500},toMedia:(ms:number)=>100000+ms,ended:false}));
 t.mock.method(StreamingSentences.prototype,'audioFor',()=>new Float32Array(16000).fill(.1));
 t.mock.method(StreamingSentences.prototype,'captionAudio',()=>({pcm:new Float32Array(32000),prefixMs:0,suffixMs:320,mediaStartMs:100000}));
 const checks:{timeout:number;resolve:(result:Transcript|undefined)=>void}[]=[];
 t.mock.method(BackgroundCaptions.prototype,'transcribe',(_pcm:Float32Array,_language?:string,timeout=8000)=>new Promise<Transcript|undefined>(resolve=>{checks.push({timeout,resolve});}));
 t.mock.method(BackgroundCaptions.prototype,'cancelReview',()=>{});
 const video=new Video(),adapter=new VideoAdapter(video as unknown as HTMLVideoElement,'bilibili:visual-defer');
 const speech=new LiveSpeech(adapter,async()=>({}),{analyze:async()=>({decision:undefined,frames:[]}),dispose:()=>{}});
 let reading:typeof printed|undefined;
 (speech as any).visualReader={read:async()=>reading,dispose:()=>{}};
 // The boundary, not the independent caption decoder, is under test.
 t.mock.method(speech as any,'caption',async()=>undefined);
 const controller=new AbortController();let settled=false;
 const pending:Promise<LiveBoundary|undefined>=(singleWindow?(speech as any).detectWindow(controller.signal):speech.detect(controller.signal)).finally(()=>{settled=true;});void pending.catch(()=>{});
 cleanup=async()=>{controller.abort();await pending.catch(()=>{});speech.dispose();adapter.dispose();};
 await tick();(speech as any).frame(0,new Float32Array(512),adapter.position,performance.now());
 // Begin an uncertain acoustic review before the printed line closes. A fresh
 // repeated-speaker result can corroborate that same interval while the
 // slower visual validation is still pending (the production fast path).
 (tracker as any).accept(accepted);await tick();assert.equal(checks.length,1);assert.equal(checks[0].timeout,8000);
 const observe=async(at:number,shown=true)=>{reading=shown?printed:undefined;video.position=at/1000;video.frame?.(0,{mediaTime:at/1000} as VideoFrameCallbackMetadata);await tick();};
 const closePrint=async(start=100700)=>{for(const at of [start,start+250,start+500,start+1050])await observe(at,at!==start+1050);assert.equal(checks.length,2);assert.equal(checks[1].timeout,6500);};
 const accept=async(turn:PendingTurn=accepted)=>{fast=true;(tracker as any).accept(turn);await tick();};
 return {video,speech,checks,controller,pending,observe,closePrint,accept,settled:()=>settled};
}

for(const result of [undefined,{...match,segments:[{...match.segments[0],text:'別の言葉です'}]}]){
 test(`an already accepted boundary finishes when its closed-line check returns ${result?'mismatched text':'no result'}, without the four-second timer`,async t=>{
  const s=await setup(t);await s.closePrint();await s.accept();assert.equal(s.settled(),false);
  s.checks[1].resolve(result);await tick();await tick();
  assert.equal(s.settled(),true,'the completed negative check must release the accepted acoustic boundary immediately');
  const boundary=await s.pending;assert.equal(boundary?.endMs,accepted.endMs);assert.equal(boundary?.text,undefined);
  assert.equal(s.video.playCalls,1);assert.deepEqual(s.video.seeks,[]);assert.equal(s.checks.length,2);
 });
}

test('a visual check belonging to the later, nonoverlapping line never delays an earlier accepted boundary',async t=>{
 const s=await setup(t);await s.closePrint(103000);await s.accept();
 assert.equal(s.settled(),true,'a later line cannot require four extra seconds for the earlier interval');
 const boundary=await s.pending;assert.equal(boundary?.endMs,accepted.endMs);
 s.checks[1].resolve(match);await tick();assert.equal(await s.pending,boundary);assert.equal(s.speech.detectedLanguage,undefined);
 assert.equal(s.video.playCalls,1);assert.deepEqual(s.video.seeks,[]);assert.equal(s.checks.length,2);
});

test('a truly overlapping delayed check can still confirm the printed words and preserve the accepted acoustic tail',async t=>{
 const s=await setup(t);await s.closePrint();await s.accept();
 t.mock.timers.tick(2500);await tick();assert.equal(s.settled(),false);
 s.checks[1].resolve(match);const boundary=await s.pending;
 assert.equal(boundary?.text,printed.text);assert.equal(boundary?.startMs,accepted.startMs);assert.equal(boundary?.endMs,accepted.endMs);
 assert.deepEqual(s.video.seeks,[]);assert.equal(s.checks.length,2);
});

test('a separate earlier line can still finish its check before the accepted later interval is returned',async t=>{
 const s=await setup(t);await s.closePrint(100050);await s.accept({startMs:101000,endMs:102000,reason:'turn-end'});
 assert.equal(s.settled(),false);s.checks[1].resolve(match);const boundary=await s.pending;
 assert.equal(boundary?.text,printed.text);assert.equal(boundary?.startMs,100000);assert.equal(boundary?.endMs,100670);
 assert.deepEqual(s.video.seeks,[]);assert.equal(s.checks.length,2);
});

test('a failed earlier check cannot release an acoustic interval while its own stable printed line remains open',async t=>{
 const s=await setup(t);await s.closePrint(100050);
 for(const at of [101300,101550,101800])await s.observe(at);
 await s.accept();s.checks[1].resolve(undefined);await tick();await tick();
 assert.equal(s.settled(),false);t.mock.timers.tick(4000);await tick();assert.equal(s.settled(),false);
 assert.equal(s.video.paused,false);assert.deepEqual(s.video.seeks,[]);
});

test('a valid observation closing an open line releases its accepted interval when no check is pending',async t=>{
 const s=await setup(t);await s.closePrint(100050);
 for(const at of [101300,101550,101800])await s.observe(at);
 await s.accept();s.checks[1].resolve(undefined);await tick();assert.equal(s.settled(),false);
 // The next closed line is inside the existing check cooldown. No extra ASR
 // is required, and the obsolete four-second wait must not remain armed.
 await s.observe(102350,false);await tick();
 assert.equal(s.settled(),true);assert.equal((await s.pending)?.endMs,accepted.endMs);
 assert.deepEqual(s.video.seeks,[]);assert.equal(s.checks.length,2);
});

for(const cancel of ['abort','pause','hidden'] as const){
 test(`${cancel} cancels a deferred boundary before a late visual result can submit it`,async t=>{
  const s=await setup(t);await s.closePrint();await s.accept();assert.equal(s.settled(),false);
  if(cancel==='abort')s.controller.abort();
  if(cancel==='pause')s.video.pause();
  if(cancel==='hidden'){Object.assign(document,{hidden:true});document.dispatchEvent(new Event('visibilitychange'));}
  await assert.rejects(s.pending,{name:'AbortError'});
  s.checks[1].resolve(match);t.mock.timers.tick(10000);await tick();
  assert.equal(s.speech.detectedLanguage,undefined);assert.equal(s.video.paused,true);assert.equal(s.video.playCalls,1);assert.deepEqual(s.video.seeks,[]);
 });
}

test('a real seek invalidates the old deferred window before a late visual result can submit it',async t=>{
 const s=await setup(t,true);await s.closePrint();await s.accept();
 s.video.seeking=true;s.video.position=120;s.video.dispatchEvent(new Event('seeking'));
 await assert.rejects(s.pending,{name:'ResumeRecognition'});
 s.checks[1].resolve(match);t.mock.timers.tick(10000);await tick();
 assert.equal(s.speech.detectedLanguage,undefined);assert.equal(s.video.paused,true);assert.equal(s.video.playCalls,1);assert.deepEqual(s.video.seeks,[]);
});
