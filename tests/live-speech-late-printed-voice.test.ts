import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {MicVAD} from '@ricky0123/vad-web';
import {LiveSpeech} from '../src/live-speech';
import {VideoAdapter} from '../src/player';
import {StreamingTurns,type SpeakerWindow} from '../src/turn-model';
import {StreamingSentences} from '../src/streaming-sentences';
import {BackgroundCaptions} from '../src/background-captions';
import type {SpeakerFrame} from '../src/speaker-turns';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
class Video extends EventTarget{
 duration=200;currentSrc='blob:late-print';playbackRate=1;paused=true;seeking=false;isConnected=true;ended=false;readyState=4;error=null;
 position=100;seeks:number[]=[];frame?:VideoFrameRequestCallback;
 get currentTime(){return this.position;}set currentTime(value:number){this.seeks.push(value);this.position=value;}
 pause(){this.paused=true;}async play(){this.paused=false;}
 requestVideoFrameCallback(callback:VideoFrameRequestCallback){this.frame=callback;return 1;}cancelVideoFrameCallback(){this.frame=undefined;}
}
const strong=[300,332,364].map(atMs=>({atMs,speaker:0,confidence:.9}));
const retrospective=[...strong,...Array.from({length:18},(_,i)=>({atMs:900+i*32,speaker:-1,confidence:0}))];
const window=(end=101500):SpeakerWindow=>({startMs:end-10000,endMs:end,ended:false,clockAligned:true});
async function setup(t:TestContext,language:'ja'|'en'|'unknown'='ja'){
 let cleanup=async()=>{};t.after(()=>cleanup());t.mock.method(console,'debug',()=>{});
 class Context{sampleRate=16000;state='suspended';async resume(){this.state='running';}async close(){this.state='closed';}}
 for(const [key,value]of Object.entries({AudioContext:Context,document:Object.assign(new EventTarget(),{hidden:false,querySelector:()=>null,createElement:()=>({})}),window:new EventTarget(),location:new URL('https://example.test/')})){
  const prior=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true});t.after(()=>{if(prior)Object.defineProperty(globalThis,key,prior);else Reflect.deleteProperty(globalThis,key);});
 }
 t.mock.method(MicVAD,'new',async()=>({processFrame:async()=>{},start:async()=>{},pause:async()=>{},destroy:async()=>{}} as unknown as MicVAD));
 let tracker!:StreamingTurns;
 t.mock.method(StreamingTurns.prototype,'push',function(this:StreamingTurns){tracker=this;});
 t.mock.method(StreamingTurns.prototype,'finish',async()=>{});
 t.mock.method(StreamingSentences.prototype,'push',()=>{});
 t.mock.method(StreamingSentences.prototype,'audioFor',()=>new Float32Array(16000).fill(.1));
 const decode=t.mock.method(BackgroundCaptions.prototype,'transcribe',async()=>undefined);
 const video=new Video(),adapter=new VideoAdapter(video as unknown as HTMLVideoElement,'bilibili:late-print');
 const speech=new LiveSpeech(adapter,async()=>({}),{analyze:async()=>({decision:undefined,frames:[]}),dispose:()=>{}});
 if(language!=='unknown')(speech as any).original.confirmFromPrintedSpeech();
 let reading:any={text:'少し待ってください',confidence:.99,min:.99};(speech as any).visualReader={read:async()=>reading,dispose:()=>{}};
 const controller=new AbortController();let settled=false;
 const pending=speech.detect(controller.signal).finally(()=>{settled=true;});void pending.catch(()=>{});
 cleanup=async()=>{controller.abort();await pending.catch(()=>{});speech.dispose();adapter.dispose();};await tick();
 video.position=100.032;(speech as any).frame(0,new Float32Array(512),100032,performance.now());
 for(const at of [100.2,100.45,100.7,101.25]){
  if(at===101.25)reading=undefined;
  video.position=at;video.frame!(0,{mediaTime:at} as VideoFrameCallbackMetadata);await tick();
 }
 assert.ok(tracker);assert.equal(settled,false);
 if(language==='en')speech.useLanguage('en');
 const feed=async(frames:SpeakerFrame[],proof=window(),position=proof.endMs)=>{
  video.position=position/1000;(tracker as any).observe(frames,false,proof);await tick();
 };
 return {speech,video,adapter,controller,pending,feed,tracker,decode,settled:()=>settled};
}
test('a closed Japanese print is reconsidered when legitimate trailing speaker evidence arrives later',async t=>{
 const s=await setup(t);assert.equal(s.decode.mock.callCount(),1);
 await s.feed(strong);assert.equal(s.settled(),true,'closed print must not wait forever for another printed line');
 const result=await s.pending;assert.equal(result?.text,'少し待ってください');assert.equal(result?.startMs,100050);assert.equal(result?.endMs,100820);
 assert.deepEqual(s.video.seeks,[]);assert.equal(s.decode.mock.callCount(),1,'no added ASR');
});
test('retrospective full-window sound still needs two independently shifted windows',async t=>{
 const s=await setup(t);await s.feed(retrospective);assert.equal(s.settled(),false);
 await s.feed(retrospective);assert.equal(s.settled(),false,'same PCM is not an independent witness');
 await s.feed(retrospective,window(101756));assert.equal(s.settled(),true);assert.equal((await s.pending)?.text,'少し待ってください');assert.deepEqual(s.video.seeks,[]);
});
for(const reason of ['unknown','dub','forced-ja','expired','wrong-clock','missing-clock','future-window','ended','other-sound','duplicate-bin','focused','seek','cut','paused','hidden','abort'] as const){
 test(`late printed voice cannot cross ${reason}`,async t=>{
  const s=await setup(t,reason==='unknown'?'unknown':reason==='dub'?'en':'ja');
  if(reason==='seek')s.video.seeking=true;
  if(reason==='cut')s.video.currentSrc='blob:other-video';
  if(reason==='forced-ja')s.speech.useLanguage('ja');
  if(reason==='paused')s.video.paused=true;
  if(reason==='hidden')(document as any).hidden=true;
  if(reason==='abort'){s.controller.abort();await assert.rejects(s.pending,{name:'AbortError'});}
  const frames=reason==='other-sound'?strong.map(f=>({...f,atMs:f.atMs+2000})):reason==='duplicate-bin'?Array(3).fill(strong[0]):strong;
  const proof=reason==='wrong-clock'?{...window(),clockAligned:false}:reason==='missing-clock'?{...window(),clockAligned:undefined as any}:reason==='ended'?{...window(),ended:true}:reason==='expired'?window(104701):reason==='future-window'?window(102000):window();
  if(reason==='focused'){s.video.position=101.5;(s.tracker as any).observe(frames,true,proof);await tick();}
  else await s.feed(frames,proof,reason==='future-window'?101500:proof.endMs);
  if(reason!=='abort')assert.equal(s.settled(),false);
  assert.deepEqual(s.video.seeks,[]);
 });
}
test('a later committed acoustic boundary is not combined with late earlier printed speech',async t=>{
 const s=await setup(t);
 t.mock.method(StreamingSentences.prototype,'acousticBoundary',()=>({startMs:102000,endMs:102700}));
 (s.tracker as any).accept({startMs:102000,endMs:102700,reason:'turn-end'});await tick();
 const result=await s.pending;await s.feed(strong);
 assert.equal(await s.pending,result);assert.equal(result?.endMs,102700);assert.notEqual(result?.text,'少し待ってください');assert.deepEqual(s.video.seeks,[]);
});
