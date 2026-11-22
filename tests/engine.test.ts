import test from 'node:test';import assert from 'node:assert/strict';
import {Engine} from '../src/engine';import {Client} from '../src/client';import {createClip,uid} from '../src/domain';import {execute,fresh,Request,Response} from '../src/storage';import type {VideoAdapter} from '../src/player';
let clock=1000;let frames=new Map<number,FrameRequestCallback>();let nextFrame=1;
Object.defineProperty(globalThis,'performance',{value:{now:()=>clock},configurable:true});
Object.assign(globalThis,{window:new EventTarget(),document:Object.assign(new EventTarget(),{hidden:false}),requestAnimationFrame:(fn:FrameRequestCallback)=>{frames.set(nextFrame,fn);return nextFrame++;},cancelAnimationFrame:(id:number)=>frames.delete(id)});
class FakeVideo extends EventTarget {currentTime=0;readyState=4;playbackRate=1;paused=true;ended=false;isConnected=true;async play(){this.paused=false;}pause(){this.paused=true;}}
async function setup(target=20,mode:'listen'|'shadow'='listen',shadowOnly=false){
 const root=fresh();const c=createClip({videoKey:'demo:cafe',url:'demo:cafe',title:'fixture',durationMs:5000,segments:[{id:'a',revision:1,startMs:0,endMs:100,source:'manual'}]});c.settings.targetDefault=target;c.settings.listenGapMs=0;c.progress.a.target=target;c.mode=mode;root.clips[c.id]=c;
 let fail=false;let failType='COMMIT_COMPLETION';let loseAck=false;let committed=0;let held:Promise<void>|undefined;let finish:()=>void=()=>{};
 const auth={binding:uid(),controller:true,videoKey:c.videoKey};
 const transport=async(m:Request):Promise<Response>=>{if(m.type==='COMMIT_COMPLETION'&&held)await held;if(m.type===failType&&fail)return {ok:false,error:'STORAGE_FAILED'};try{const data=execute(root,m,auth);if(m.type==='COMMIT_COMPLETION'){committed++;if(loseAck){loseAck=false;throw new Error('lost');}}return {ok:true,dataEpoch:root.dataEpoch,data:structuredClone(data)};}catch(e){if((e as Error).message==='lost')throw e;return {ok:false,error:(e as any).code??'INVALID_REQUEST'};}};
 const client=new Client(transport);client.clip=structuredClone(c);await client.acquire();const video=new FakeVideo();const adapter={video,videoKey:c.videoKey,rates:[1],cues:[],valid:true,ad:false,cueSafe:true,seekingControlled:false,get position(){return video.currentTime*1000;},pause:()=>video.pause(),play:()=>video.play(),seek:async(ms:number)=>{video.currentTime=ms/1000;},setRate:(r:number)=>video.playbackRate=r} as unknown as VideoAdapter;
 const engine=new Engine(adapter,client,shadowOnly);return {engine,video,root,client,setFail:(b:boolean)=>fail=b,failOn:(type:string)=>failType=type,lose:()=>loseAck=true,commits:()=>committed,hold:()=>{held=new Promise<void>(r=>finish=r);},unhold:()=>{held=undefined;finish();}};
}
async function step(video:FakeVideo,mediaMs=100,wallMs=100){clock+=wallMs;if(!video.paused)video.currentTime+=mediaMs/1000;const pending=[...frames.entries()];frames.clear();for(const [,fn]of pending)fn(clock);for(let i=0;i<12;i++)await Promise.resolve();}
test('Bilibili cue restore seeks the first unanswered prompt instead of the last practiced sentence',async()=>{
 const f=await setup(2);try{
  const c=f.root.clips[f.client.clip!.id];
  c.segments.push({id:'b',revision:1,startMs:300,endMs:400,source:'manual'},{id:'c',revision:1,startMs:700,endMs:800,source:'manual'});
  c.progress.a.count=2;c.progress.b={count:2,target:2};c.progress.c={count:2,target:2};
  c.current=2;c.mode='cue';c.questions=[{id:'q1',cueId:'a',targetId:'b',revealed:true,rating:'can'},{id:'q2',cueId:'b',targetId:'c',revealed:false}];
  f.client.clip=structuredClone(c);f.engine.dispose(false);
  const restored=new Engine(f.engine.adapter,f.client);try{
   const before=structuredClone(c.progress);await restored.attach();
   assert.equal(restored.state,'READY');assert.equal(restored.questionIndex,1);assert.equal(f.video.currentTime,.3);assert.equal(f.video.paused,true);
   assert.deepEqual(restored.clip.progress,before);assert.equal(restored.question.revealed,false);assert.equal(restored.question.rating,undefined);
   await restored.prompt();await step(f.video);assert.equal(restored.state,'WAIT_ANSWER');assert.equal(restored.question.revealed,false);
   assert.equal(f.commits(),0);assert.deepEqual(restored.clip.progress,before);
  }finally{restored.dispose();}
 }finally{f.engine.dispose();}
});
test('A04 engine stops at exactly 20 and never begins 21st attempt',async()=>{const f=await setup();try{await f.engine.start();for(let i=0;i<25;i++)await step(f.video);assert.equal(f.engine.progress.count,20);assert.equal(f.engine.state,'PRACTICE_DONE');assert.equal(f.commits(),20);assert.equal(f.video.paused,true);}finally{f.engine.dispose();}});
test('A05 pause continues same attempt, seek interruption does not count',async()=>{const f=await setup();try{await f.engine.start();await step(f.video,40,40);f.engine.pause();await step(f.video,0,10000);assert.equal(f.engine.progress.count,0);await f.engine.resume();await step(f.video,60,60);assert.equal(f.engine.progress.count,1);f.video.dispatchEvent(new Event('seeking'));assert.equal(f.engine.state,'INTERRUPTED');assert.equal(f.engine.progress.count,1);await f.engine.resume();assert.equal(f.video.currentTime,0);}finally{f.engine.dispose();}});
test('A06 shadow last repetition still leaves gap; manual gap waits indefinitely',async()=>{const f=await setup(1,'shadow');try{await f.engine.saveSettings({...f.client.clip!.settings,shadowGap:{type:'manual'}});await f.engine.start();await step(f.video);assert.equal(f.engine.progress.count,1);assert.equal(f.engine.state,'GAP');await step(f.video,0,100000);assert.equal(f.engine.state,'GAP');await f.engine.resume();assert.equal(f.engine.state,'PRACTICE_DONE');}finally{f.engine.dispose();}});
test('A14 failed save freezes count and playback; same request retries without double count',async()=>{const f=await setup();try{f.setFail(true);await f.engine.start();await step(f.video);assert.equal(f.engine.state,'ERROR');assert.equal(f.engine.progress.count,0);assert.equal(f.video.paused,true);for(let i=0;i<5;i++)await step(f.video);assert.equal(f.commits(),0);f.setFail(false);await f.engine.retry();assert.equal(f.engine.progress.count,1);}finally{f.engine.dispose();}});
test('A14 receipt loss retries previously committed attempt, not a new attempt',async()=>{const f=await setup();try{f.lose();await f.engine.start();await step(f.video);assert.equal(f.engine.state,'ERROR');assert.equal(f.engine.progress.count,0);assert.equal(Object.values(f.root.clips)[0].progress.a.count,1);await f.engine.retry();assert.equal(f.engine.progress.count,1);assert.equal(Object.values(f.root.clips)[0].progress.a.count,1);}finally{f.engine.dispose();}});
test('buffering resumes automatically without counting silence; hiding still pauses',async()=>{const f=await setup();try{await f.engine.start();await step(f.video,30,30);f.video.readyState=2;f.video.dispatchEvent(new Event('waiting'));await step(f.video,0,5000);assert.equal(f.engine.state,'PLAYING');assert.equal(f.engine.progress.count,0);f.video.readyState=4;await step(f.video,70,70);assert.equal(f.engine.progress.count,1);assert.equal(f.engine.error,'');(globalThis.document as any).hidden=true;document.dispatchEvent(new Event('visibilitychange'));assert.equal(f.engine.state,'PAUSED');assert.equal(f.video.paused,true);}finally{(globalThis.document as any).hidden=false;f.engine.dispose();}});
test('A07 cue waits without revealing and never touches repetition counts',async()=>{const f=await setup();try{const c=f.client.clip!;const source=f.root.clips[c.id];source.segments.push({id:'b',revision:1,startMs:300,endMs:400,source:'manual'});source.progress.b={count:0,target:20};f.client.clip=structuredClone(source);await f.engine.beginQuestions();await f.engine.prompt();await step(f.video,100,100);assert.equal(f.engine.state,'WAIT_ANSWER');await step(f.video,0,30000);assert.equal(f.engine.state,'WAIT_ANSWER');assert.equal(f.engine.question.revealed,false);await f.engine.reveal();assert.equal(f.engine.question.revealed,true);await step(f.video,100,100);assert.equal(f.engine.state,'WAIT_RATING');await f.engine.rate('can');assert.equal(f.engine.clip.questions[0].rating,'can');assert.equal(f.engine.clip.progress.a.count,0);assert.equal(f.engine.clip.progress.b.count,0);}finally{f.engine.dispose();}});
test('difficult target subset stops before normal uncompleted segments',async()=>{const f=await setup(1);try{const source=f.root.clips[f.client.clip!.id];source.segments.push({id:'b',revision:1,startMs:300,endMs:400,source:'manual'});source.progress.b={count:0,target:1};f.client.clip=structuredClone(source);f.engine.practiceIds=new Set(['a']);await f.engine.start();await step(f.video);assert.equal(f.engine.state,'PRACTICE_DONE');assert.equal(f.engine.current,0);assert.equal(f.engine.clip.progress.b.count,0);}finally{f.engine.dispose();}});
test('pausing during final completion preserves the last shadow gap after receipt',async()=>{const f=await setup(1,'shadow');try{await f.engine.saveSettings({...f.client.clip!.settings,shadowGap:{type:'manual'}});f.hold();await f.engine.start();await step(f.video);assert.equal(f.engine.state,'COMMITTING');f.engine.pause();f.unhold();await step(f.video,0);assert.equal(f.engine.state,'PAUSED');await f.engine.resume();assert.equal(f.engine.state,'GAP');await f.engine.resume();assert.equal(f.engine.state,'PRACTICE_DONE');}finally{f.engine.dispose();}});
test('disposing during pending completion cannot restart playback',async()=>{const f=await setup();f.hold();await f.engine.start();await step(f.video);f.engine.dispose(false);f.unhold();await step(f.video,0);assert.equal(f.video.paused,true);assert.equal(f.commits(),1);});

test('A09 revealed unanswered cue restores paused and hides target until explicit reveal',async()=>{
 const f=await setup();try{const c=f.root.clips[f.client.clip!.id];c.segments.push({id:'b',revision:1,startMs:300,endMs:400,source:'manual'});c.progress.b={count:0,target:20};f.client.clip=structuredClone(c);await f.engine.beginQuestions();await f.engine.prompt();await step(f.video);await f.engine.reveal();await step(f.video);assert.equal(f.engine.state,'WAIT_RATING');f.engine.dispose(false);
 const restored=new Engine(f.engine.adapter,f.client);try{await restored.attach();assert.equal(restored.state,'READY');assert.equal(restored.caption,'');assert.equal(f.video.paused,true);await step(f.video,0,30000);assert.equal(restored.state,'READY');await restored.prompt();await step(f.video);assert.equal(restored.state,'WAIT_ANSWER');await restored.reveal();await step(f.video);assert.equal(restored.state,'WAIT_RATING');}finally{restored.dispose();}
 }finally{f.engine.dispose();}
});
test('stale post-commit continuation cannot advance after selecting a different sentence',async()=>{
 const f=await setup(1);try{const c=f.root.clips[f.client.clip!.id];c.segments.push({id:'b',revision:1,startMs:300,endMs:400,source:'manual'});c.progress.b={count:0,target:1};f.client.clip=structuredClone(c);f.hold();await f.engine.start();await step(f.video);f.engine.pause();f.unhold();await step(f.video,0);assert.equal(f.engine.state,'PAUSED');await f.engine.select(1);await f.engine.resume();assert.equal(f.engine.state,'PLAYING');assert.equal(f.video.currentTime,.3);await step(f.video);assert.equal(f.engine.clip.progress.b.count,1);}finally{f.engine.dispose();}
});
test('slow old play acknowledgement cannot pause the replacement playback',async()=>{
 const f=await setup();try{let resolveOld!:()=>void;const adapter=f.engine.adapter;let first=true;adapter.play=async()=>{f.video.paused=false;if(first){first=false;await new Promise<void>(r=>resolveOld=r);}};
 const old=f.engine.start();await Promise.resolve();await f.engine.start();resolveOld();await old;assert.equal(f.video.paused,false);await step(f.video);assert.equal(f.engine.progress.count,1);}finally{f.engine.dispose();}
});

test('A02 ad or replaced video prevents a boundary from committing',async()=>{
 for(const reason of ['ad','valid'] as const){const f=await setup();try{await f.engine.start();Object.assign(f.engine.adapter,{[reason]:reason==='ad'});await step(f.video);assert.equal(f.engine.state,'INTERRUPTED');assert.equal(f.engine.progress.count,0);assert.equal(f.video.paused,true);}finally{f.engine.dispose();}}
});
test('A06 fixed gap pauses its remaining time and final gap does not count again',async()=>{
 const f=await setup(1,'shadow');try{await f.engine.saveSettings({...f.client.clip!.settings,shadowGap:{type:'fixed',ms:1000}});await f.engine.start();await step(f.video);await step(f.video,0,400);f.engine.pause();await step(f.video,0,5000);await f.engine.resume();await step(f.video,0,500);assert.equal(f.engine.state,'GAP');await step(f.video,0,100);assert.equal(f.engine.state,'PRACTICE_DONE');assert.equal(f.engine.progress.count,1);}finally{f.engine.dispose();}
});
test('A09 restore falls back to current supported rate without changing counts or extra target',async()=>{
 const f=await setup();try{const c=f.root.clips[f.client.clip!.id];c.settings.rate=1.5;c.progress.a={count:6,target:25};f.client.clip=structuredClone(c);await f.engine.attach();assert.equal(f.engine.clip.settings.rate,1);assert.equal(f.engine.progress.count,6);assert.equal(f.engine.progress.target,25);assert.equal(f.video.paused,true);}finally{f.engine.dispose();}
});
test('queued pause event from a previous range does not interrupt a currently playing range',async()=>{
 const f=await setup();try{await f.engine.start();f.video.dispatchEvent(new Event('pause'));assert.equal(f.engine.state,'PLAYING');f.video.paused=true;f.video.dispatchEvent(new Event('pause'));assert.equal(f.engine.state,'PAUSED');assert.equal(f.engine.progress.count,0);}finally{f.engine.dispose();}
});
test('unavailable source and advertisement are rejected before playback, not one frame later',async()=>{
 for(const flag of ['valid','ad'] as const){const f=await setup();try{Object.assign(f.engine.adapter,{[flag]:flag==='ad'});await f.engine.start();assert.equal(f.video.paused,true);assert.equal(f.engine.state,'INTERRUPTED');assert.equal(f.engine.progress.count,0);}finally{f.engine.dispose();}}
});
test('pausing and disposing while seeking cancels outstanding adapter work',async()=>{
 const f=await setup();try{let cancelCount=0,finish!:()=>void;f.engine.adapter.seek=async()=>new Promise<void>(r=>finish=r);f.engine.adapter.cancelSeek=()=>{cancelCount++;finish?.();};const play=f.engine.start();f.engine.pause();await play;assert.equal(f.engine.state,'PAUSED');assert.equal(f.video.paused,true);assert.equal(cancelCount,1);f.engine.dispose();assert.equal(cancelCount,2);}finally{f.engine.dispose();}
});
test('expired unchanged lease renews before starting without losing progress',async()=>{
 const f=await setup();f.engine.dispose(false);f.client.owner.expiresAt=Date.now()-1;f.root.owners[f.client.clip!.videoKey].expiresAt=Date.now()-1;const e=new Engine(f.engine.adapter,f.client);try{await e.start();assert.equal(e.state,'PLAYING');assert.equal(e.reconnectRequired,false);assert.equal(e.progress.count,0);await step(f.video);assert.equal(e.progress.count,1);}finally{e.dispose();}
});
test('expired owner taken over elsewhere cannot resume or count',async()=>{
 const f=await setup();f.engine.dispose(false);f.client.owner.expiresAt=Date.now()-1;f.root.owners[f.client.clip!.videoKey].generation++;const e=new Engine(f.engine.adapter,f.client);try{await e.start();assert.equal(e.state,'INTERRUPTED');assert.equal(e.reconnectRequired,true);assert.equal(f.video.paused,true);assert.equal(e.progress.count,0);}finally{e.dispose();}
});
test('pausing an explicit start while renewal is pending prevents playback',async()=>{
 const f=await setup();f.engine.dispose(false);f.client.owner.expiresAt=Date.now()-1;const e=new Engine(f.engine.adapter,f.client);
 try{let finish!:()=>void;const renew=f.client.renew.bind(f.client);f.client.renew=async()=>{await new Promise<void>(r=>finish=r);return renew();};const starting=e.start();e.pause();finish();await starting;assert.equal(e.state,'PAUSED');assert.equal(f.video.paused,true);assert.equal(e.progress.count,0);}finally{e.dispose();}
});
test('completion receipt retry after lease expiry stays exactly once',async()=>{
 const f=await setup(1);try{f.lose();await f.engine.start();await step(f.video);assert.equal(f.engine.state,'ERROR');assert.equal(f.root.clips[f.engine.clip.id].progress.a.count,1);f.client.owner.expiresAt=Date.now()-1;f.root.owners[f.engine.clip.videoKey].expiresAt=Date.now()-1;await f.engine.retry();assert.equal(f.engine.state,'PRACTICE_DONE');assert.equal(f.engine.progress.count,1);assert.equal(f.root.clips[f.engine.clip.id].progress.a.count,1);}finally{f.engine.dispose();}
});
test('long suspension restarts current range automatically without counting the interrupted attempt',async()=>{
 const f=await setup();try{await f.engine.start();await step(f.video,30,30);await step(f.video,40,3600000);assert.equal(f.engine.state,'PLAYING');assert.equal(f.video.currentTime,0);assert.equal(f.engine.progress.count,0);await step(f.video);assert.equal(f.engine.progress.count,1);}finally{f.engine.dispose();}
});
test('hidden page and explicit pause during lease recovery cannot autoplay',async()=>{
 for(const action of ['hide','pause','dispose'] as const){const f=await setup();try{await f.engine.start();let finish!:()=>void;const renew=f.client.renew.bind(f.client);f.client.renew=async()=>{await new Promise<void>(r=>finish=r);return renew();};await step(f.video,30,3600000);assert.equal(f.video.paused,true);if(action==='hide'){(document as any).hidden=true;document.dispatchEvent(new Event('visibilitychange'));}else if(action==='pause')f.engine.pause();else f.engine.dispose(false);finish();for(let i=0;i<30;i++)await Promise.resolve();assert.equal(f.video.paused,true);assert.equal(f.engine.progress.count,0);}finally{(document as any).hidden=false;f.engine.dispose();}}
});
test('failed settings save freezes playback and retries mode plus settings atomically',async()=>{
 const f=await setup();try{f.failOn('SAVE_CHECKPOINT');f.setFail(true);await f.engine.saveSettings({...f.engine.clip.settings,listenGapMs:9000},'shadow');assert.equal(f.engine.state,'ERROR');assert.equal(f.engine.saving,true);assert.equal(f.engine.mode,'listen');assert.equal(f.engine.clip.settings.listenGapMs,0);await f.engine.start();assert.equal(f.video.paused,true);f.setFail(false);await f.engine.retry();assert.equal(f.engine.mode,'shadow');assert.equal(f.engine.clip.mode,'shadow');assert.equal(f.engine.clip.settings.listenGapMs,9000);assert.equal(f.engine.state,'READY');}finally{f.engine.dispose();}
});
test('failed sentence switch keeps the old sentence until the checkpoint is committed',async()=>{
 const f=await setup();try{const c=f.root.clips[f.engine.clip.id];c.segments.push({id:'b',revision:1,startMs:300,endMs:400,source:'manual'});c.progress.b={count:0,target:20};f.client.clip=structuredClone(c);f.failOn('SAVE_CHECKPOINT');f.setFail(true);await f.engine.select(1);assert.equal(f.engine.current,0);assert.equal(f.engine.state,'ERROR');assert.equal(f.engine.saving,true);f.setFail(false);await f.engine.retry();assert.equal(f.engine.current,1);assert.equal(f.video.currentTime,.3);assert.equal(f.engine.state,'READY');}finally{f.engine.dispose();}
});
test('automatic advancement persists the next sentence without leaving an orphan pending save',async()=>{
 const f=await setup(1);try{const c=f.root.clips[f.engine.clip.id];c.segments.push({id:'b',revision:1,startMs:300,endMs:400,source:'manual'});c.progress.b={count:0,target:1};f.client.clip=structuredClone(c);await f.engine.start();await step(f.video);assert.equal(f.engine.current,1);assert.equal(f.engine.saving,false);assert.equal(f.engine.state,'PLAYING');await step(f.video);assert.equal(f.engine.state,'PRACTICE_DONE');assert.equal(f.engine.clip.progress.a.count,1);assert.equal(f.engine.clip.progress.b.count,1);}finally{f.engine.dispose();}
});
test('question creation failure is retryable and cannot start unpersisted prompts',async()=>{
 const f=await setup();try{const c=f.root.clips[f.engine.clip.id];c.segments.push({id:'b',revision:1,startMs:300,endMs:400,source:'manual'});c.progress.b={count:0,target:20};f.client.clip=structuredClone(c);f.failOn('START_QUESTIONS');f.setFail(true);await f.engine.beginQuestions();assert.equal(f.engine.state,'ERROR');assert.equal(f.engine.mode,'listen');assert.equal(f.engine.clip.questions.length,0);await f.engine.start();assert.equal(f.video.paused,true);f.setFail(false);await f.engine.retry();assert.equal(f.engine.mode,'cue');assert.equal(f.engine.clip.questions.length,1);assert.equal(f.engine.state,'READY');}finally{f.engine.dispose();}
});
test('settings acknowledgement loss retries the same saved request without revision conflicts',async()=>{
 const f=await setup();try{const original=f.client.send.bind(f.client);let first=true;const ids:string[]=[];f.client.send=async(m)=>{const value=await original(m);if(m.type==='SAVE_CHECKPOINT'){ids.push(m.requestId);if(first){first=false;throw new Error('lost reply');}}return value;};await f.engine.saveSettings({...f.engine.clip.settings,listenGapMs:4000},'shadow');assert.equal(f.engine.saving,true);assert.equal(f.engine.state,'ERROR');assert.equal(f.root.clips[f.engine.clip.id].settings.listenGapMs,4000);await f.engine.retry();assert.equal(new Set(ids).size,1);assert.equal(f.engine.state,'READY');assert.equal(f.engine.mode,'shadow');assert.equal(f.engine.clip.settings.listenGapMs,4000);}finally{f.engine.dispose();}
});

test('difficult restart failure retains all counts; retry resets only targets and restores paused',async()=>{
 const f=await setup();try{const c=f.root.clips[f.client.clip!.id];c.segments.push({id:'b',revision:1,startMs:300,endMs:400,source:'manual'});c.progress.a.count=7;c.progress.b={count:9,target:25};c.questions=[{id:'q',cueId:'a',targetId:'b',revealed:true,rating:'stuck'}];c.mode='review';f.client.clip=structuredClone(c);f.engine.mode='review';f.failOn('RESTART_DIFFICULT');f.setFail(true);
 await f.engine.restartPractice(true);assert.equal(f.engine.state,'ERROR');assert.equal(f.engine.saving,true);assert.equal(f.engine.clip.progress.b.count,9);assert.equal(c.progress.b.count,9);
 f.setFail(false);await f.engine.retry();assert.equal(f.engine.state,'READY');assert.equal(f.engine.current,1);assert.equal(f.engine.mode,'listen');assert.deepEqual([...f.engine.practiceIds!],['b']);assert.equal(f.engine.clip.progress.a.count,7);assert.equal(f.engine.clip.progress.b.count,0);assert.equal(f.engine.clip.progress.b.target,25);assert.equal(f.video.currentTime,.3);assert.equal(f.video.paused,true);
 }finally{f.engine.dispose();}
});
test('leaving difficult practice waits for checkpoint success before clearing subset',async()=>{
 const f=await setup();try{f.engine.practiceIds=new Set(['a']);const c=f.root.clips[f.client.clip!.id];c.practiceIds=['a'];f.client.clip=structuredClone(c);f.failOn('SAVE_CHECKPOINT');f.setFail(true);await f.engine.changeMode('listen',true);assert.deepEqual([...f.engine.practiceIds],['a']);assert.deepEqual(c.practiceIds,['a']);f.setFail(false);await f.engine.retry();assert.equal(f.engine.practiceIds,undefined);assert.equal(f.engine.clip.practiceIds,undefined);}finally{f.engine.dispose();}
});
test('full restart uses retained retry and archives the previous round exactly once',async()=>{
 const f=await setup();try{const c=f.root.clips[f.client.clip!.id];c.progress.a.count=8;f.client.clip=structuredClone(c);f.failOn('RESTART_SESSION');f.setFail(true);await f.engine.restartPractice();assert.equal(f.engine.progress.count,8);f.setFail(false);await f.engine.retry();await f.engine.retry();assert.equal(f.engine.progress.count,0);assert.equal(f.engine.clip.history?.length,1);assert.equal(f.engine.clip.history?.[0].progress.a.count,8);assert.equal(f.engine.state,'READY');assert.equal(f.video.paused,true);}finally{f.engine.dispose();}
});

test('streaming discovery allows normal playback without counting it as an old repetition',async()=>{
 const f=await setup();try{await f.engine.attach();f.engine.discovering=true;await f.video.play();f.video.dispatchEvent(new Event('play'));assert.equal(f.video.paused,false);await step(f.video,300,300);assert.equal(f.engine.progress.count,0);assert.equal(f.commits(),0);f.engine.discovering=false;f.video.dispatchEvent(new Event('play'));assert.equal(f.video.paused,true);}finally{f.engine.dispose();}
});

test('recognized local captions respect subtitle visibility and cue answer hiding',async()=>{
 const f=await setup();try{
  f.client.clip!.segments[0].text='Recognized dialogue.';
  assert.equal(f.engine.caption,'Recognized dialogue.');
  f.client.clip!.segments[0].source='turn';f.client.clip!.segments[0].confidence=.7;assert.equal(f.engine.caption,'Recognized dialogue.');
  f.client.clip!.segments[0].confidence=.95;assert.equal(f.engine.caption,'Recognized dialogue.');
  f.engine.mode='cue';assert.equal(f.engine.caption,'');
  f.engine.mode='listen';f.client.clip!.settings.showJapanese=false;assert.equal(f.engine.caption,'');
  f.client.clip!.settings.showJapanese=true;f.video.currentTime=.2;assert.equal(f.engine.caption,'');
 }finally{f.engine.dispose();}
});

test('unverified legacy onset cannot start a repeat until calibration succeeds',async()=>{
 const f=await setup(3);try{let permitted=false;f.engine.prepareRepeat=()=>permitted;await f.engine.start();assert.equal(f.video.paused,true);assert.equal(f.engine.progress.count,0);
 const stored=f.root.clips[f.client.clip!.id];stored.segments[0].startMs=32;f.client.clip=structuredClone(stored);permitted=true;await f.engine.start();assert.equal(f.video.currentTime,.032);
 await step(f.video,68,68);assert.equal(f.engine.progress.count,1);assert.equal(f.video.currentTime,.032,'second repeat starts at speech onset');
 await step(f.video,68,68);assert.equal(f.engine.progress.count,2);assert.equal(f.video.currentTime,.032,'third repeat starts at speech onset');
 }finally{f.engine.dispose();}
});

test('cue rating automatically starts the next prompt, then finishes without replaying the video',async()=>{
 const f=await setup();try{const c=f.root.clips[f.client.clip!.id];for(const [id,startMs]of [['b',300],['c',600]] as const){c.segments.push({id,revision:1,startMs,endMs:startMs+100,source:'asr'});c.progress[id]={count:20,target:20,reason:'target'};}f.client.clip=structuredClone(c);
 await f.engine.beginQuestions();await f.engine.prompt();await step(f.video);assert.equal(f.engine.state,'WAIT_ANSWER');await step(f.video,0,30000);assert.equal(f.engine.state,'WAIT_ANSWER');assert.equal(f.engine.question.revealed,false);
 await f.engine.reveal();await step(f.video);await f.engine.rate('can');assert.equal(f.engine.questionIndex,1);assert.equal(f.engine.state,'PLAYING');assert.equal(f.video.currentTime,.3);await step(f.video);assert.equal(f.engine.state,'WAIT_ANSWER');assert.equal(f.engine.question.revealed,false);
 await f.engine.rate('skip');assert.equal(f.engine.mode,'done');assert.equal(f.engine.clip.mode,'done');assert.equal(f.engine.state,'PRACTICE_DONE');assert.equal(f.video.paused,true);const endedAt=f.video.currentTime;await f.engine.resume();assert.equal(f.video.currentTime,endedAt);assert.equal(f.engine.state,'PRACTICE_DONE');assert.equal(f.engine.clip.progress.b.count,20);
 }finally{f.engine.dispose();}
});
test('cue concealment stays active while waiting and is restored on explicit answer or disposal',async()=>{
 const f=await setup();const hidden:boolean[]=[];(f.engine.adapter as any).setCueHidden=(value:boolean)=>hidden.push(value);
 try{const c=f.root.clips[f.client.clip!.id];c.segments.push({id:'b',revision:1,startMs:300,endMs:400,source:'asr'});c.progress.b={count:0,target:20};f.client.clip=structuredClone(c);await f.engine.beginQuestions();await f.engine.prompt();await step(f.video);assert.equal(hidden.at(-1),true);await f.engine.reveal();assert.equal(hidden.at(-1),false);await step(f.video);await f.engine.prompt();assert.equal(hidden.at(-1),true);}finally{f.engine.dispose();assert.equal(hidden.at(-1),false);}
});

test('legacy review checkpoint resumes completed self-evaluation without autoplay',async()=>{const f=await setup();try{const c=f.root.clips[f.client.clip!.id];c.mode='review';c.questions=[{id:'q',cueId:'a',targetId:'a',revealed:true,rating:'can'}];f.client.clip=structuredClone(c);f.engine.mode='review';await f.engine.attach();assert.equal(f.engine.mode,'done');assert.equal(f.engine.clip.mode,'done');assert.equal(f.engine.state,'PRACTICE_DONE');assert.equal(f.video.paused,true);assert.equal(f.engine.clip.questions[0].rating,'can');}finally{f.engine.dispose();}});

test('shadow-only workspace migrates old controls without changing counts or ratings',async()=>{
 const f=await setup(20,'listen',true);try{const c=f.root.clips[f.client.clip!.id];c.settings.rate=.75;c.settings.nextPolicy='manual';c.settings.shadowGap={type:'manual'};c.progress.a.count=7;f.client.clip=structuredClone(c);await f.engine.attach();assert.equal(f.engine.mode,'shadow');assert.equal(f.engine.clip.mode,'shadow');assert.equal(f.engine.clip.settings.rate,1);assert.equal(f.video.playbackRate,1);assert.equal(f.engine.clip.settings.nextPolicy,'auto');assert.deepEqual(f.engine.clip.settings.shadowGap,{type:'auto'});assert.equal(f.engine.progress.count,7);await f.engine.start();await step(f.video);assert.equal(f.engine.state,'GAP');await step(f.video,0,2001);assert.equal(f.engine.state,'PLAYING');}finally{f.engine.dispose();}
});
test('automatic settings save resumes playback and retries a failed save without changing counts',async()=>{
 const f=await setup(20,'shadow',true);try{await f.engine.attach();await f.engine.start();await step(f.video,30,30);f.failOn('SAVE_CHECKPOINT');f.setFail(true);await f.engine.saveSettings({...f.engine.clip.settings,targetDefault:21},'shadow',true);assert.equal(f.engine.state,'ERROR');assert.equal(f.video.paused,true);assert.equal(f.engine.progress.count,0);f.setFail(false);await f.engine.retry();assert.equal(f.engine.state,'PLAYING');assert.equal(f.engine.clip.settings.targetDefault,21);assert.equal(f.engine.progress.count,0);await step(f.video);assert.equal(f.engine.progress.count,1);await f.engine.restartPractice();assert.equal(f.engine.mode,'shadow');assert.equal(f.engine.clip.mode,'shadow');}finally{f.engine.dispose();}
});

test('a foreground frame arriving 425 ms after the sentence retries once without credit',async()=>{
 const f=await setup(2);
 try{
  await f.engine.start();await step(f.video,60,60);await step(f.video,465,465);
  assert.equal(f.engine.state,'PLAYING');assert.equal(f.video.currentTime,0);assert.equal(f.commits(),0);
  await step(f.video);assert.equal(f.engine.progress.count,1);
  await step(f.video,525,525);assert.equal(f.engine.state,'PLAYING');
  await step(f.video,525,525);assert.equal(f.engine.state,'INTERRUPTED');assert.equal(f.commits(),1);
 }finally{f.engine.dispose();}
});

test('a continuous foreground replay retries after the observed 880 ms overrun instead of waiting indefinitely',async()=>{
 // The real range was 264355–266001 ms. The last running clock sample to pause
 // advanced 1474 ms over 1525 ms. Reproduce a delayed RAF compatible with those
 // observations (the site log did not record the engine's exact previous RAF).
 for(const last of [{media:1052,tail:1474,delay:1525},{media:1626,tail:900,delay:900}]){
  const f=await setup(2);try{
   f.root.clips[f.engine.clip.id].segments[0].endMs=1646;
   f.client.clip=structuredClone(f.root.clips[f.engine.clip.id]);
   await f.engine.start();
   for(let played=0;played<last.media;){const amount=Math.min(100,last.media-played);await step(f.video,amount,amount);played+=amount;}
   await step(f.video,last.tail,last.delay);
   assert.equal(f.engine.state,'PLAYING');assert.equal(f.video.currentTime,0);assert.equal(f.commits(),0);
   for(let i=0;i<16;i++)await step(f.video);await step(f.video,46,46);
   assert.equal(f.engine.progress.count,1,'only the fully observed retry earns credit');
  }finally{f.engine.dispose();}
 }
});

test('a delayed foreground frame inside the sentence restarts once and does not credit an unobserved traversal',async()=>{
 const f=await setup(1);try{
  f.root.clips[f.engine.clip.id].segments[0].endMs=4000;f.client.clip=structuredClone(f.root.clips[f.engine.clip.id]);
  await f.engine.start();await step(f.video,100,100);await step(f.video,1600,1600);
  assert.equal(f.engine.state,'PLAYING');assert.equal(f.video.currentTime,0);assert.equal(f.commits(),0);
  await step(f.video,1600,1600);
  assert.equal(f.engine.state,'INTERRUPTED');assert.equal(f.commits(),0,'a repeated long frame cannot loop indefinitely');
 }finally{f.engine.dispose();}
});

test('late replay recovery respects pauses, visibility, real seeks and discontinuous media clocks',async()=>{
 for(const reason of ['hide','hide-before-event','blur','pause','paused-before-event','seeking','seek-event','seek-gesture','jump','stalled','too-long'] as const){
  const f=await setup(1);try{
   await f.engine.start();await step(f.video,40,40);
   if(reason==='hide'){(document as any).hidden=true;document.dispatchEvent(new Event('visibilitychange'));}
   if(reason==='hide-before-event')(document as any).hidden=true;
   if(reason==='blur')window.dispatchEvent(new Event('blur'));
   if(reason==='pause'){f.video.pause();f.video.dispatchEvent(new Event('pause'));}
   if(reason==='paused-before-event')f.video.pause();
   if(reason==='seeking')(f.video as any).seeking=true;
   if(reason==='seek-event')f.video.dispatchEvent(new Event('seeking'));
   if(reason==='seek-gesture'){
    const event=new Event('keydown');Object.defineProperties(event,{isTrusted:{value:true},key:{value:'ArrowRight'}});document.dispatchEvent(event);
   }
   if(reason==='stalled')f.video.readyState=2;
   const delay=reason==='too-long'?5100:1400;
   await step(f.video,reason==='jump'?1900:delay,delay);
   assert.equal(f.video.paused,true,reason);assert.notEqual(f.engine.state,'PLAYING',reason);assert.equal(f.commits(),0,reason);
  }finally{(document as any).hidden=false;f.engine.dispose();}
 }
});

test('pausing, hiding or disposing during an automatic late retry cannot restart its delayed seek',async()=>{
 for(const action of ['pause','hide','dispose'] as const){
  const f=await setup();try{
   await f.engine.start();let finish!:()=>void;
   f.engine.adapter.seek=async(ms:number)=>{await new Promise<void>(resolve=>finish=resolve);f.video.currentTime=ms/1000;};
   await step(f.video,980,980);assert.equal(f.engine.state,'SEEKING');assert.equal(f.video.paused,true);
   if(action==='pause')f.engine.pause();
   if(action==='hide'){(document as any).hidden=true;document.dispatchEvent(new Event('visibilitychange'));}
   if(action==='dispose')f.engine.dispose(false);
   finish();for(let i=0;i<12;i++)await Promise.resolve();
   assert.equal(f.video.paused,true);assert.equal(f.commits(),0);
  }finally{(document as any).hidden=false;f.engine.dispose();}
 }
});

test('delayed prompt, answer and preview ranges do not enter repetition recovery',async()=>{
 for(const purpose of ['prompt','answer','preview'] as const){
  const f=await setup();try{
   if(purpose==='preview')await f.engine.preview(0,100);
   else{
    const c=f.root.clips[f.client.clip!.id];c.segments.push({id:'b',revision:1,startMs:300,endMs:400,source:'manual'});c.progress.b={count:0,target:20};
    f.client.clip=structuredClone(c);await f.engine.beginQuestions();await f.engine.prompt();
    if(purpose==='answer'){await step(f.video,100,100);await f.engine.reveal();}
   }
   await step(f.video,980,980);
   assert.equal(f.engine.state,'INTERRUPTED');assert.equal(f.video.paused,true);assert.equal(f.commits(),0);
  }finally{f.engine.dispose();}
 }
});

async function gapPlayback(observed=true,endMs=3694){
 const {NativeMediaGaps}=await import('../src/native-media-gaps');const f=await setup(2),gaps=new NativeMediaGaps();
 // Original site evidence, translated by the replay start at 487.052 s.
 const ranges={length:2,start:(i:number)=>i===0?0:2.935868,end:(i:number)=>i===0?2.703667:5};
 if(observed)gaps.observe(ranges,2241,2935.868);
 (f.engine.adapter as any).isKnownNativeGap=(from:number,to:number)=>gaps.matches(ranges,from,to);
 f.root.clips[f.engine.clip.id].segments[0].endMs=endMs;f.client.clip=structuredClone(f.root.clips[f.engine.clip.id]);
 return f;
}
test('two genuine replays cross the same observed native buffer gap and count only at the sentence end',async()=>{
 const f=await gapPlayback();try{
  await f.engine.start();
  for(let round=0;round<2;round++){
   for(let i=0;i<22;i++)await step(f.video,100,100);await step(f.video,41,41);
   f.video.currentTime=2.935868;f.video.dispatchEvent(new Event('seeking'));
   assert.equal(f.engine.state,'PLAYING');assert.equal(f.engine.progress.count,round,'native correction itself is not a completion');
   await step(f.video,0,16);for(let i=0;i<7;i++)await step(f.video,100,100);await step(f.video,58.132,59);
   assert.equal(f.engine.progress.count,round+1);
  }
  assert.equal(f.commits(),2);
 }finally{f.engine.dispose();}
});
test('a known native jump without a seeking event is checked against the same evidence by the playback clock',async()=>{
 const f=await gapPlayback();try{
  await f.engine.start();for(let i=0;i<22;i++)await step(f.video);await step(f.video,41,41);
  await step(f.video,694.868,16);assert.equal(f.engine.state,'PLAYING');assert.equal(f.engine.progress.count,0);
 }finally{f.engine.dispose();}
});
for(const action of ['unknown','paused','beyond-end','other-target','suspended'] as const){
 test(`native gap recovery cannot authorize ${action} playback`,async()=>{
  const f=await gapPlayback(action!=='unknown',action==='beyond-end'?2800:3694);try{
   await f.engine.start();for(let i=0;i<22;i++)await step(f.video);await step(f.video,41,41);
   if(action==='paused')f.engine.pause();if(action==='suspended')clock+=1500;
   f.video.currentTime=action==='other-target'?3.1:2.935868;f.video.dispatchEvent(new Event('seeking'));
   assert.equal(f.engine.state,'INTERRUPTED');assert.equal(f.engine.progress.count,0);assert.equal(f.commits(),0);
  }finally{f.engine.dispose();}
 });
}

test('a restored clip interrupts its first unknown native gap then permits a genuine retry',async()=>{
 const f=await gapPlayback(false);
 try{
  const {NativeMediaGaps}=await import('../src/native-media-gaps');
  const gaps=new NativeMediaGaps(),ranges={length:2,start:(i:number)=>i===0?0:2.935868,end:(i:number)=>i===0?2.703667:5};
  f.engine.adapter.isKnownNativeGap=(a,b)=>gaps.matches(ranges,a,b);
  f.engine.adapter.rememberNativeGap=(a,b)=>gaps.observe(ranges,a,b);
  for(let attempt=0;attempt<2;attempt++){
   await f.engine.start();for(let i=0;i<22;i++)await step(f.video,100,100);await step(f.video,41,41);
   f.video.currentTime=2.935868;f.video.dispatchEvent(new Event('seeking'));
   assert.equal(f.engine.state,attempt?'PLAYING':'INTERRUPTED');assert.equal(f.engine.progress.count,0);
  }
  await step(f.video,0,16);for(let i=0;i<7;i++)await step(f.video,100,100);await step(f.video,58.132,59);
  assert.equal(f.engine.progress.count,1);
 }finally{f.engine.dispose();}
});
