import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {runInNewContext} from 'node:vm';
import {resolveSource} from '../src/domain';

// Execute the real content controller; replace only its UI/storage boundaries.
const names:Record<string,string[]>={
 './printed-language-history':['priorPrintedLines'],'./config':['BUILD_VERSION','desktopTraining'],'../desktop/platform-captions':['biliLines'],'../desktop/player-view':['desktopPlayer','DesktopDock','desktopPage'],'./player-dock':['PlayerDock'],'./client':['extensionClient'],'./backend-status':['verifyBackend'],'./domain':['message','resolveSource'],'./player':['VideoAdapter'],'./workspace':['Workspace'],'./dom':['button','h','status','text'],'./subtitles':['preferredSubtitleTrack','readableSubtitleTracks'],'./subtitle-controls':['subtitleControls'],'./theme':['applyAppearance'],
};
const bundled=build({entryPoints:[new URL('../src/content.ts',import.meta.url).pathname],bundle:true,write:false,format:'iife',plugins:[{name:'content-boundaries',setup(b){
 b.onResolve({filter:/^\.{1,2}\//},args=>({path:args.path,namespace:'boundary'}));
 b.onLoad({filter:/.*/,namespace:'boundary'},args=>({contents:args.path.endsWith('.css')?'export default ""':names[args.path].map(name=>`export const ${name}=globalThis.__contentDeps[${JSON.stringify(args.path)}].${name};`).join('\n'),loader:'js'}));
}}]}).then(r=>r.outputFiles[0].text);
const tick=()=>new Promise<void>(r=>setImmediate(r));

class Element extends EventTarget {
 children:Element[]=[];parentElement?:Element;dataset:Record<string,string>={};style:{cssText?:string}={};shadowRoot?:Element;id='';inert=false;label='';
 classList={add(){}};constructor(readonly tag='div',private attached=false){super();}
 get isConnected():boolean{return this.attached||Boolean(this.parentElement?.isConnected);}
 append(...items:unknown[]){for(const item of items)if(item instanceof Element){item.remove();item.parentElement=this;this.children.push(item);}}
 prepend(...items:unknown[]){this.append(...items);}
 replaceChildren(...items:unknown[]){for(const child of [...this.children])child.remove();this.append(...items);}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=undefined;}
 before(item:Element){this.parentElement?.append(item);}
 insertAdjacentElement(_where:string,item:Element){this.parentElement?.append(item);}
 attachShadow(){this.shadowRoot=new Element('shadow');this.shadowRoot.parentElement=this;return this.shadowRoot;}
 getBoundingClientRect(){return {width:800,height:450};}
}
class Video extends Element {
 currentSrc='blob:first';duration=630;readyState=4;paused=true;playCalls=0;currentTime=290;textTracks=[];
 constructor(){super('video');}
 pause(){this.paused=true;}
 async play(){this.paused=false;this.playCalls++;}
}
async function setup(t:import('node:test').TestContext){
 let now=0,timerId=0;const timers=new Map<number,{at:number;interval?:number;fn:()=>void}>(),body=new Element('body',true),elements:Element[]=[body],videos:Video[]=[],watchers:{active:boolean;callback:()=>void}[]=[];
 const h=(tag:string,attrs:Record<string,any>|null={},...children:unknown[])=>{const e=new Element(tag);e.id=attrs?.id??'';elements.push(e);e.append(...children);return e;};
 const makeVideo=()=>{const container=h('player');body.append(container);const video=new Video();container.append(video);videos.push(video);return video;};
 const first=makeVideo();
 const location=new URL('https://www.bilibili.com/video/BV1js4y1c7ac/');
 const requests:{type:string;payload:any;id?:string}[]=[],clients:any[]=[],workspaces:any[]=[],docks:any[]=[];
 const clip={id:'interrupted-clip',videoKey:resolveSource(location.href).videoKey,durationMs:630000,settings:{targetDefault:2},current:1,segments:[{id:'one'},{id:'two'}],progress:{two:{count:1,target:2}}};
 let getRecord:()=>Promise<any>=async()=>structuredClone(clip),release:()=>Promise<void>=async()=>{};
 const deps:any={
  './config':{BUILD_VERSION:'test'},'../desktop/platform-captions':{},'../desktop/player-view':{},'./printed-language-history':{priorPrintedLines:()=>[]},'./backend-status':{verifyBackend:()=>{}},'./domain':{resolveSource,message:(e:Error)=>e.message},
  './theme':{applyAppearance:()=>{}},'./subtitles':{readableSubtitleTracks:()=>[],preferredSubtitleTrack:()=>undefined},'./subtitle-controls':{subtitleControls:()=>h('subtitles')},
  './dom':{h,text:(s:string)=>{const e=h('text');e.label=s;return e;},button:(s:string,run:()=>void)=>{const e=h('button');e.label=s;(e as any).run=run;return e;},status:(s:string,action?:{label:string;run:()=>void})=>{const e=h('status');e.label=s;if(action){const b=h('button');b.label=action.label;b.addEventListener('click',action.run);e.append(b);}return e;}},
  './client':{extensionClient:()=>{const c:any={clip:undefined,hello:async()=>{},call:async(type:string,payload:any,id?:string)=>{requests.push({type,payload,id});return type==='GET_RECORD'?getRecord():{clips:[structuredClone(clip)]};},dispose:()=>release()};clients.push(c);return c;}},
  './player-dock':{PlayerDock:class {constructor(readonly video:Video,host:Element){video.parentElement!.append(host);docks.push(this);}setActive(){}dispose(){}}},
  './player':{VideoAdapter:class {identity:string;initialDuration:number;disposed=false;constructor(readonly video:Video,readonly videoKey:string,_cues:any,readonly validate:()=>boolean){this.identity=video.currentSrc;this.initialDuration=video.duration;}
   get duration(){return this.video.duration*1000;}get valid(){return !this.disposed&&this.video.isConnected&&this.validate()&&this.video.currentSrc===this.identity&&Math.abs(this.video.duration-this.initialDuration)<1;}pause(){this.video.pause();}dispose(){this.disposed=true;this.pause();}}},
  './workspace':{Workspace:class {root=h('workspace');disposed=false;resumed:any;restarted=0;hard=0;constructor(readonly adapter:any,readonly client:any,readonly options:any){workspaces.push(this);}dispose(){this.disposed=true;this.adapter.pause();}async resume(value:any){this.resumed=value;this.client.clip=value;}async retryHard(){this.hard++;}async restart(){this.restarted++;}}},
 };
 const window:any={open:()=>{}};
 const context:any={__contentDeps:deps,window,location,URLSearchParams,console,Date:class extends Date{static now(){return now;}},
  chrome:{runtime:{sendMessage:async()=>({}),getURL:(s:string)=>s}},
  document:{body,querySelector:(selector:string)=>selector==='#shengge-panel'?elements.find(e=>e.id==='shengge-panel'&&e.isConnected)??null:null,querySelectorAll:(selector:string)=>selector==='video'?videos:elements.filter(e=>e.id==='shengge-panel'&&e.isConnected)},
  MutationObserver:class {record:{active:boolean;callback:()=>void};constructor(callback:()=>void){this.record={active:false,callback};watchers.push(this.record);}observe(){this.record.active=true;}disconnect(){this.record.active=false;}},
  setInterval:(fn:()=>void,ms:number)=>{const id=++timerId;timers.set(id,{at:now+ms,interval:ms,fn});return id;},
  setTimeout:(fn:()=>void,ms:number)=>{const id=++timerId;timers.set(id,{at:now+ms,fn});return id;},clearInterval:(id:number)=>timers.delete(id),clearTimeout:(id:number)=>timers.delete(id),
 };
 const flush=async()=>{await tick();await tick();};
 const mutations=()=>{for(const watcher of [...watchers])if(watcher.active)watcher.callback();};
 const advance=async(ms:number)=>{const end=now+ms;while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;if(next[1].interval)next[1].at+=next[1].interval;else timers.delete(next[0]);next[1].fn();await flush();}now=end;await flush();};
 runInNewContext(await bundled,context);await flush();assert.equal(workspaces.length,1);clients[0].clip=structuredClone(clip);
 t.after(()=>window.__shengge?.dispose());
 return {first,makeVideo,location,requests,clients,workspaces,docks,clip,window,timers,mutations,advance,flush,button:(label:string)=>elements.find(e=>e.tag==='button'&&e.label===label&&e.isConnected),setGet:(fn:()=>Promise<any>)=>getRecord=fn,setRelease:(fn:()=>Promise<void>)=>release=fn};
}

test('same-video replacement remounts automatically and restores only the exact paused practice',async t=>{
 const s=await setup(t);s.first.parentElement!.remove();const next=s.makeVideo();next.currentSrc='blob:replacement';s.mutations();await s.advance(400);
 assert.equal(s.workspaces[0].disposed,true);assert.equal(s.workspaces.length,2);assert.equal(s.docks.at(-1).video,next);
 assert.deepEqual(s.workspaces[1].resumed,s.clip);assert.equal(next.paused,true);assert.equal(next.playCalls,0);
 assert.deepEqual(s.requests.filter(r=>r.type==='GET_RECORD').map(r=>r.id),['interrupted-clip']);
});

test('same element source replacement is detected without DOM mutations and ignores restart fragments',async t=>{
 const s=await setup(t);s.location.hash='shengge=another-clip&restart=1&hard=1';s.first.currentSrc='blob:replacement';s.first.dispatchEvent(new Event('loadedmetadata'));await s.advance(400);
 assert.equal(s.workspaces.length,2);assert.equal(s.workspaces[1].resumed.id,s.clip.id);assert.equal(s.workspaces[1].restarted,0);assert.equal(s.workspaces[1].hard,0);assert.equal(s.first.paused,true);assert.equal(s.first.playCalls,0);
});

test('real episode changes never bind the previous practice or start playback',async t=>{
 const s=await setup(t);s.first.remove();const next=s.makeVideo();s.location.search='?p=2';s.mutations();await s.advance(1000);
 assert.equal(s.workspaces.length,1);assert.equal(s.workspaces[0].disposed,true);assert.equal(s.requests.filter(r=>r.type==='GET_RECORD').length,0);assert.equal(next.playCalls,0);assert.equal(s.timers.size,0);
});

test('the current-video button opens the new episode in place and ignores an old record fragment',async t=>{
 const s=await setup(t);s.location.search='?p=2';s.location.hash='shengge=interrupted-clip&restart=1';
 s.mutations();await s.flush();s.button('连接当前视频')!.dispatchEvent(new Event('click'));
 await s.flush();assert.equal(s.workspaces.length,1,'the previous source is still attached under the new URL');
 s.first.currentSrc='blob:second-episode';s.button('连接当前视频')!.dispatchEvent(new Event('click'));
 await s.flush();assert.equal(s.workspaces.length,2);assert.equal(s.workspaces[1].adapter.videoKey,resolveSource(s.location.href).videoKey);
 assert.equal(s.workspaces[1].resumed,undefined);assert.equal(s.requests.some(r=>r.type==='GET_RECORD'),false);
 assert.equal(s.first.playCalls,0);assert.equal(s.first.paused,true);
});

test('an old source in a replacement video cannot be labelled with the next episode',async t=>{
 const s=await setup(t);s.first.remove();const second=s.makeVideo();s.location.search='?p=2';s.mutations();
 s.button('连接当前视频')!.dispatchEvent(new Event('click'));await s.flush();assert.equal(s.workspaces.length,1);
 second.currentSrc='blob:next';s.button('连接当前视频')!.dispatchEvent(new Event('click'));await s.flush();
 assert.equal(s.workspaces.at(-1).adapter.identity,'blob:next');assert.equal(s.workspaces.length,2);
});

test('returning to the initial episode can reopen a fresh paused workspace on its original source',async t=>{
 const s=await setup(t);s.location.search='?p=2';s.mutations();s.location.search='';
 s.button('连接当前视频')!.dispatchEvent(new Event('click'));await s.flush();
 assert.equal(s.workspaces.length,2);assert.equal(s.workspaces.at(-1).adapter.videoKey,s.clip.videoKey);
 assert.equal(s.workspaces.at(-1).resumed,undefined);assert.equal(s.first.playCalls,0);
});

test('a third route loading during release cannot adopt audio from the second episode',async t=>{
 const s=await setup(t);let release!:()=>void;s.setRelease(()=>new Promise(r=>release=r));
 s.location.search='?p=2';s.first.currentSrc='blob:two';s.mutations();
 s.button('连接当前视频')!.dispatchEvent(new Event('click'));s.location.search='?p=3';
 release();await s.flush();assert.equal(s.workspaces.length,1);
 s.button('连接当前视频')!.dispatchEvent(new Event('click'));await s.flush();assert.equal(s.workspaces.length,1);
 s.first.currentSrc='blob:three';s.button('连接当前视频')!.dispatchEvent(new Event('click'));await s.flush();
 assert.equal(s.workspaces.length,2);assert.equal(s.workspaces.at(-1).adapter.videoKey,resolveSource(s.location.href).videoKey);
});

test('a fresh episode still ignores record links after retry or workspace reconnection',async t=>{
 const s=await setup(t);s.location.search='?p=2';s.location.hash='shengge=interrupted-clip&hard=1';
 s.first.currentSrc='blob:two';s.first.duration=Infinity;s.mutations();
 s.button('连接当前视频')!.dispatchEvent(new Event('click'));await s.flush();assert.equal(s.workspaces.length,1);
 s.first.duration=630;s.button('连接当前视频')!.dispatchEvent(new Event('click'));await s.flush();
 s.workspaces.at(-1).options.onReconnect();await s.flush();assert.equal(s.workspaces.length,3);
 assert.equal(s.requests.some(r=>r.type==='GET_RECORD'),false);assert.equal(s.first.playCalls,0);
});

test('an episode change while the saved record is loading prevents stale workspace creation',async t=>{
 const s=await setup(t);let resolve!:(value:any)=>void;s.setGet(()=>new Promise(r=>resolve=r));s.first.remove();const next=s.makeVideo();s.mutations();await s.advance(400);
 assert.equal(typeof resolve,'function');s.location.search='?p=2';resolve(s.clip);await s.flush();assert.equal(s.workspaces.length,1);assert.equal(next.playCalls,0);
});

test('another same-video replacement during a record read recovers the newest player',async t=>{
 const s=await setup(t);let resolve!:(value:any)=>void,reads=0;s.setGet(()=>++reads===1?new Promise(r=>resolve=r):Promise.resolve(structuredClone(s.clip)));
 s.first.remove();const transient=s.makeVideo();s.mutations();await s.advance(400);assert.equal(typeof resolve,'function');
 transient.parentElement!.remove();const latest=s.makeVideo();latest.currentSrc='blob:latest';resolve(s.clip);await s.flush();await s.advance(400);
 assert.equal(s.workspaces.length,2);assert.equal(s.workspaces[1].adapter.video,latest);assert.equal(s.workspaces[1].resumed.id,s.clip.id);assert.equal(latest.playCalls,0);
});

test('a fetched record for another episode cannot be restored during recovery',async t=>{
 const s=await setup(t);s.setGet(async()=>({...s.clip,videoKey:s.clip.videoKey+'-different'}));s.first.remove();const next=s.makeVideo();s.mutations();await s.advance(400);
 assert.equal(s.workspaces.length,1);assert.equal(next.playCalls,0);assert.equal(next.paused,true);
});

test('recovery waits for the old session release and cancellation prevents a late reconnect',async t=>{
 const s=await setup(t);let release!:()=>void;s.setRelease(()=>new Promise(r=>release=r));s.first.remove();const next=s.makeVideo();s.mutations();await s.advance(400);
 assert.equal(s.clients.length,1,'new owner must not race the old release');s.window.__shengge.dispose();release();await s.flush();assert.equal(s.workspaces.length,1);assert.equal(next.playCalls,0);assert.equal(s.timers.size,0);
});

test('an obsolete recovery timeout cannot remove a successfully reconnected workspace',async t=>{
 const s=await setup(t);s.first.remove();s.makeVideo();s.mutations();const timeout=[...s.timers.values()].find(timer=>!timer.interval)!;
 await s.advance(400);assert.equal(s.workspaces.length,2);timeout.fn();assert.equal(s.workspaces[1].root.isConnected,true);
});

test('ambiguous players and changed duration remain paused; metadata readiness can recover later',async t=>{
 const s=await setup(t);s.first.remove();const next=s.makeVideo(),other=s.makeVideo();s.mutations();await s.advance(800);assert.equal(s.workspaces.length,1);
 other.remove();next.duration=700;s.mutations();await s.advance(800);assert.equal(s.workspaces.length,1);
 next.duration=630;next.readyState=0;await s.advance(800);assert.equal(s.workspaces.length,1);
 next.readyState=4;s.mutations();await s.advance(400);assert.equal(s.workspaces.length,2);assert.equal(next.playCalls,0);assert.equal(next.paused,true);
});
