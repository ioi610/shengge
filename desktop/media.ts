import { VideoAdapter } from '../src/player';
import { readSubtitleCues } from '../src/subtitles';
import { resolveSource } from '../src/domain';

import {biliLines} from './platform-captions';
let catalogKey='';
let catalog:Awaited<ReturnType<typeof biliLines>>=[];
let catalogRequest:AbortController|undefined;
function requestCatalog(key:string){
 if(key===catalogKey)return;
 catalogKey=key;catalog=[];catalogRequest?.abort();
 const controller=catalogRequest=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),10000);
 void biliLines(key,controller.signal).then(rows=>{if(catalogKey===key)catalog=rows;})
   .catch(()=>{}).finally(()=>clearTimeout(timeout));
}
type Command = { op: string; key: string; run?: string; from?: number; to?: number; tracks?: boolean };
let adapter: VideoAdapter | undefined;
let generation = 0;
let result = {run:'', state:'idle'};
let timer = 0;
let clearRange:(()=>void)|undefined;

let theater = true;
const focusStyle = document.createElement('style');
focusStyle.textContent = `
html[data-sg-screen] {background:black!important;overflow:hidden!important}
html[data-sg-screen] body * {visibility:hidden!important}
html[data-sg-screen] [data-sg-video] {visibility:visible!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;object-fit:contain!important;background:black!important;z-index:2147483647!important}
html[data-sg-screen] :has([data-sg-video]) {transform:none!important;contain:none!important;clip-path:none!important;overflow:visible!important}
html[data-sg-screen] video::cue {color:transparent;background:transparent}`;
document.head.append(focusStyle);

function cancel(state='idle') {
  generation++;clearRange?.();clearRange=undefined;
  clearInterval(timer);timer=0;
  adapter?.cancelSeek();
  result = {...result,state};
}
function currentKey(){
  if(location.protocol==='file:') return 'demo:cafe';
  try{return resolveSource(location.href).videoKey;}catch{return '';}
}
function bind(key:string) {
  if(currentKey()!==key) {
    cancel('interrupted');adapter?.dispose();adapter=undefined;
    document.documentElement.removeAttribute('data-sg-screen');
    throw new Error('原站已切换视频，请重新导入当前视频链接。');
  }
  const chosen = Array.from(document.querySelectorAll('video'))
    .filter(v=>v.readyState>=1 && Number.isFinite(v.duration) && v.duration>0)
    .sort((a,b)=>b.videoWidth*b.videoHeight-a.videoWidth*a.videoHeight)[0];
  if(adapter && (!adapter.valid || adapter.video!==chosen)){
    cancel('interrupted');adapter.video.removeAttribute('data-sg-video');adapter.dispose();adapter=undefined;
  }
  if(chosen && !adapter){
    const src=chosen.currentSrc;
    adapter=new VideoAdapter(chosen,key,[],()=>chosen.isConnected && chosen.currentSrc===src && currentKey()===key);
    chosen.setAttribute('data-sg-video','');
  }
  document.documentElement.toggleAttribute('data-sg-screen',Boolean(theater && adapter && !adapter.ad));
  return adapter;
}

async function command(c:Command){
  if(c.op==='site')theater=!theater;
  if(c.op==='range')theater=true;
  const a=bind(c.key);
  if(!a || a.ad) return {ready:false,site:!theater};
  const v=a.video;
  if(c.op==='seek'){
    if(!Number.isFinite(c.from))throw new Error('时间无效');
    cancel();await a.seek(Math.min(a.duration,Math.max(0,c.from!)));
  } else if(c.op==='toggle'){
    cancel(); if(v.paused) await a.play(); else a.pause();
  } else if(c.op==='stop'){
    cancel();a.pause();
  } else if(c.op==='range'){
    const from=c.from!,to=c.to!;
    if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to<=from||to>a.duration+50)throw new Error('对白时间超出视频范围');
    cancel();const ticket=generation;
    await a.seek(from);
    if(ticket!==generation)throw new Error('已切换片段');
    result={run:c.run!,state:'playing'};
    // Use seek events for external repositioning. WebKit can briefly report
    // the old presentation time even after seeked and play() have resolved.
    const onSeek=()=>{
      if(ticket===generation && !a.seekingControlled){a.pause();cancel('interrupted');}
    };
    let startedAt=performance.now();
    const end=()=>{
      if(ticket!==generation)return;
      const position=a.position;
      if(!a.valid || a.ad){
        a.pause();cancel('interrupted');
      } else if(!v.seeking && ((position>=to-15 && position<=from+(performance.now()-startedAt)*Math.max(1,v.playbackRate)+400) || v.ended)){
        a.pause();cancel('finished');
      } else if(v.paused && !v.seeking && !a.seekingControlled){
        cancel('interrupted');
      }

    };
    await a.play();
    if(ticket===generation){
      startedAt=performance.now();v.addEventListener('seeking',onSeek);
      clearRange=()=>v.removeEventListener('seeking',onSeek);
      timer=window.setInterval(end,20);
    }
  }
  let cues:typeof catalog=[];
  if(c.tracks){
    requestCatalog(c.key);
    const tracks=Array.from(v.textTracks).filter(t=>['captions','subtitles'].includes(t.kind));
    const track=tracks.find(t=>t.mode==='showing')??tracks.find(t=>t.mode==='hidden')??tracks[0];
    if(track){
      if(track.mode==='disabled')track.mode='hidden';
      cues=readSubtitleCues(track).slice(0,5000).map(({startMs,endMs,text})=>({startMs,endMs,text}));
    }
  }
  return {ready:true,duration:a.duration,position:Math.round(a.position),paused:v.paused,title:document.title,site:!theater,result,cues:cues?.length?cues:c.tracks?catalog:[]};
}
Object.assign(globalThis,{shenggeMedia:command});
