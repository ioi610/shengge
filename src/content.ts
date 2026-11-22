import {biliLines} from '../desktop/platform-captions';
import {priorPrintedLines} from './printed-language-history';
import {desktopPlayer,DesktopDock,desktopPage} from '../desktop/player-view';
import {BUILD_VERSION,desktopTraining} from './config';
import {PlayerDock} from './player-dock';
import {extensionClient} from './client';
import {verifyBackend} from './backend-status';
import {message, resolveSource} from './domain';
import {VideoAdapter} from './player';
import {Workspace} from './workspace';
import {button, h, status, text} from './dom';
import {preferredSubtitleTrack, readableSubtitleTracks} from './subtitles';
import {subtitleControls} from './subtitle-controls';
import css from './style.css';
import {applyAppearance} from './theme';
const global=window as unknown as {__shengge?:{dispose:()=>void;settled?:()=>Promise<void>}};
const prior=global.__shengge;prior?.dispose();
if(!prior&&document.querySelector('#shengge-panel')){
 // Reloading an extension invalidates its old isolated world but leaves its DOM.
 // Do not mount a second engine beside a controller whose cleanup is unreachable.
 document.querySelector('#shengge-update-notice')?.remove();
 document.querySelectorAll<HTMLElement>('#shengge-panel').forEach(panel=>panel.inert=true);
 const notice=h('div',{id:'shengge-update-notice'});const scope=notice.attachShadow({mode:'open'});scope.append(h('style',null,css),h('div',{class:'sg injected'},status('声格已更新，请刷新视频页后再点击工具栏声格，以清除旧播放器控制。已保存的进度会保留。',{label:'刷新视频页',run:()=>location.reload()},true)));
 document.querySelector('#shengge-panel')!.before(notice);
}else{
const host=h('div',{id:'shengge-panel',style:'display:block;position:relative;z-index:1;isolation:isolate'});
host.dataset.shenggeVersion=BUILD_VERSION;
const shadow=host.attachShadow({mode:'open'});shadow.append(h('style',null,css));
const root=h('div',{class:'sg injected'});shadow.append(root);
let dock:PlayerDock|DesktopDock|undefined;
let workspace:Workspace|undefined,adapter:VideoAdapter|undefined,observer:MutationObserver|undefined;
let activeClient:ReturnType<typeof extensionClient>|undefined,releasing:Promise<void>=Promise.resolve();
let unwatch:(()=>void)|undefined;
let subtitleWatch:AbortController|undefined;
type Recovery={videoKey:string;durationMs:number;clipId?:string};
type EpisodeSource={videoKey:string;src?:string};
let disposed=false,generation=0,connection:Promise<void>=prior?.settled?.()??Promise.resolve();
applyAppearance(root);
function stop(){subtitleWatch?.abort();subtitleWatch=undefined;dock?.setActive(false);observer?.disconnect();unwatch?.();unwatch=undefined;workspace?.dispose();workspace=undefined;adapter?.dispose();adapter=undefined;const client=activeClient;activeClient=undefined;if(client)releasing=Promise.all([releasing,client.dispose()]).then(()=>{}).catch(()=>{});}
function dispose(){disposed=true;generation++;stop();dock?.dispose();host.remove();if(global.__shengge?.dispose===dispose)delete global.__shengge;}
global.__shengge={dispose,settled:()=>Promise.all([connection,releasing]).then(()=>{})};
const visibleVideos=()=>Array.from(document.querySelectorAll<HTMLVideoElement>('video')).filter(v=>v.isConnected&&v.getBoundingClientRect().width>100&&v.getBoundingClientRect().height>50);
function showHost(){
 if(host.isConnected)return;
 dock?.dispose();dock=undefined;host.style.cssText='display:block;position:relative;z-index:1;isolation:isolate';document.body.append(host);
}
function offerCurrent(message:string,previous:EpisodeSource,attempt:number){
 showHost();
 const open=()=>{
  if(disposed||attempt!==generation)return;
  let key:string;
  try{key=resolveSource(location.href).videoKey;}catch{root.replaceChildren(status('视频来源已变化，声格已暂停。',undefined,true),button('关闭',dispose,'text'));return;}
  const videos=visibleVideos(),video=videos.length===1?videos[0]:undefined;
  if(!video||video.readyState<1||!Number.isFinite(video.duration)||video.duration<=0||!video.currentSrc||key!==previous.videoKey&&video.currentSrc===previous.src){
   offerCurrent('请等当前视频载入后再连接。',previous,attempt);return;
  }
  void connect(video,undefined,undefined,{videoKey:key,src:video.currentSrc});
 };
 root.replaceChildren(status(message,{label:'连接当前视频',run:open},true),button('关闭',dispose,'text'));
}
function recover(recovery:Recovery){
 const previous={videoKey:recovery.videoKey,src:adapter?.identity};
 const attempt=++generation;stop();
 showHost();
 root.replaceChildren(status('播放器更新中，正在重新连接…'),button('关闭',dispose,'text'));
 let candidate:{video:HTMLVideoElement;src:string;duration:number;since:number}|undefined;
 const abandon=(message:string,changedEpisode=false)=>{
  if(disposed||attempt!==generation)return;
  unwatch?.();unwatch=undefined;
  if(changedEpisode)offerCurrent(message,previous,attempt);
  else root.replaceChildren(status(message,undefined,true),button('关闭',dispose,'text'));
 };
 const check=()=>{
  if(disposed||attempt!==generation)return;
  try{if(resolveSource(location.href).videoKey!==recovery.videoKey){abandon('已切换视频。',true);return;}}catch{abandon('视频来源已变化，声格已暂停。');return;}
  const videos=visibleVideos(),video=videos.length===1?videos[0]:undefined;
  if(!video||!video.currentSrc||video.readyState<1||!Number.isFinite(video.duration)||video.duration<=0||Math.abs(video.duration*1000-recovery.durationMs)>=1000||document.querySelector('.ad-showing,.ad-interrupting')){candidate=undefined;return;}
  // Bilibili can replace the node before updating its source/route. Require a
  // stable unique player, and recheck the video key after asynchronous reads.
  if(candidate?.video!==video||candidate.src!==video.currentSrc||candidate.duration!==video.duration){candidate={video,src:video.currentSrc,duration:video.duration,since:Date.now()};return;}
  if(Date.now()-candidate.since>=400)void connect(video,undefined,recovery);
 };
 const poll=setInterval(check,200),timeout=setTimeout(()=>abandon('播放器尚未稳定，声格保持暂停。请在视频载入后重新点击工具栏的声格。'),15000);
 observer=new MutationObserver(check);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
 unwatch=()=>{clearInterval(poll);clearTimeout(timeout);observer?.disconnect();};check();
}
function connect(video:HTMLVideoElement,chosenTrack?:TextTrack|null,recovery?:Recovery,freshEpisode?:EpisodeSource){
 if(dock?.video!==video){dock?.dispose();dock=desktopTraining?new DesktopDock(video,host):new PlayerDock(video,host);root.classList.add('player-dock');}
 const attempt=++generation;stop();root.replaceChildren(status('正在连接播放器…'));
 const released=releasing;
 // A replacement waits for the old connect/acquire to finish, while all old UI
 // callbacks are invalidated immediately. Two clicks cannot mount two engines.
 connection=connection.catch(()=>{}).then(()=>released).then(async()=>{
  if(disposed||attempt!==generation)return;
   const alive=()=>!disposed&&host.isConnected&&attempt===generation;
  try{
   const source=resolveSource(location.href);
   if(freshEpisode&&(!video.isConnected||source.videoKey!==freshEpisode.videoKey||video.currentSrc!==freshEpisode.src)){
    offerCurrent('播放器已更换。',freshEpisode,attempt);return;
   }
   if(recovery&&source.videoKey!==recovery.videoKey)throw new Error('视频已切换，声格保持暂停。');
   if(!Number.isFinite(video.duration)||video.duration<=0)throw new Error('请先播放正片，读取视频时长后再连接。直播暂不支持。');
   const durationMs=video.duration*1000;
   if(recovery&&Math.abs(durationMs-recovery.durationMs)>=1000)throw new Error('视频时长已变化，未恢复上一段练习。');
   if(document.querySelector('.ad-showing,.ad-interrupting'))throw new Error('请等待广告结束，再点击声格。');
   const currentSrc=video.currentSrc;if(!currentSrc)throw new Error('播放器尚未就绪，请先播放视频。');
   const tracks=readableSubtitleTracks(video.textTracks);
   const subtitle=chosenTrack===null?undefined:chosenTrack?tracks.find(item=>item.track===chosenTrack):preferredSubtitleTrack(tracks);
   if(chosenTrack&&!subtitle)throw new Error('所选字幕已不可读取，请在原站选择字幕后重新点击声格。');
   const key='lines:'+source.videoKey;
   const saved=desktopTraining?(await chrome.storage.local.get(key))[key]:undefined;
   const cues=Array.isArray(saved)&&saved.length?saved:subtitle?.cues??[];
   const selected=new VideoAdapter(video,source.videoKey,cues,()=>{try{return alive()&&resolveSource(location.href).videoKey===source.videoKey&&video.currentSrc===currentSrc;}catch{return false;}});
   adapter=selected;selected.pause();
   const connected=()=>{
    if(disposed||attempt!==generation)return false;
    if(selected.valid)return true;
    if(source.platform==='bilibili'){recover({videoKey:source.videoKey,durationMs,clipId:activeClient?.clip?.id??recovery?.clipId});return false;}
    throw new Error('视频或播放器已变化，请重新连接。');
   };
   verifyBackend(await chrome.runtime.sendMessage({type:'BACKEND_STATUS'}));if(!connected())return;
   const client=extensionClient();activeClient=client;await client.hello();if(!connected())return;
   const fragment=new URLSearchParams(location.hash.slice(1)),target=recovery?recovery.clipId:freshEpisode?undefined:fragment.get('shengge');
   const clips=target?[await client.call('GET_RECORD',{},target)]:
    (await client.call('LIST_RECORDS',{limit:source.videoKey.startsWith('bilibili:')?4:1,videoKey:source.videoKey})).clips;
   const priorClip=clips[0];
   if(!connected())return;
   if(recovery&&target&&(!priorClip||priorClip.videoKey!==recovery.videoKey||Math.abs(priorClip.durationMs-durationMs)>=1000))throw new Error('已保存练习与当前视频不一致，未恢复旧练习。');
   const w=new Workspace(selected,client,{external:true,savedClips:desktopTraining?clips:undefined,printedHistory:priorPrintedLines(clips,source.videoKey,selected.duration),targetDefault:priorClip?.settings.targetDefault,onRecords:()=>desktopTraining?desktopPage('records'):window.open(chrome.runtime.getURL('index.html#records'),'_blank'),onExit:desktopTraining?()=>desktopPage('home'):dispose,onReconnect:()=>{void connect(video,undefined,undefined,freshEpisode);}});
   workspace=w;root.replaceChildren(w.root);dock?.setActive(true);if(desktopTraining){
    desktopPlayer().bind(w);
    if(!target&&!cues.length&&chosenTrack!==null){
     subtitleWatch=new AbortController();
     const {signal}=subtitleWatch;
     const read=()=>{
      if(signal.aborted||workspace!==w||selected.cues.length||w.desktopState().active)return;
      const track=preferredSubtitleTrack(readableSubtitleTracks(video.textTracks));
      if(track)void w.setDesktopLines(track.cues,false).catch(()=>{});
     };
     const observe=(track:TextTrack)=>{
      if(!['captions','subtitles'].includes(track.kind))return;
      if(track.mode==='disabled')track.mode='hidden';
      track.addEventListener('cuechange',read,{signal});
     };
     for(const track of Array.from(video.textTracks))observe(track);
     video.textTracks.addEventListener('addtrack',event=>{if(event.track instanceof TextTrack)observe(event.track);read();},{signal});
     video.addEventListener('load',read,{capture:true,signal});read();
    }
    if(!target&&!cues.length&&chosenTrack!==null&&source.platform==='bilibili'){
     void biliLines(source.videoKey,AbortSignal.timeout(8000)).then(lines=>{
      if(lines.length&&alive()&&workspace===w&&!selected.cues.length&&!w.desktopState().active)
       return w.setDesktopLines(lines.map((line,i)=>({...line,id:'platform-'+i,revision:1,source:'platform'})),false);
     }).catch(()=>{});
    }
   }
   const subtitles=subtitleControls(tracks,subtitle,track=>void connect(video,track,undefined,freshEpisode));
   if(tracks.length)w.root.prepend(subtitles);
   // Ordinary toolbar launches use the current frame. A replacement may only
   // restore the exact interrupted clip; it never starts or restarts playback.
   const clip=target?priorClip:undefined;
   if(!connected())return;
   if(clip&&clip.videoKey===source.videoKey){await w.resume(clip);if(!connected())return;if(!recovery){if(fragment.get('hard')==='1')await w.retryHard();else if(fragment.get('restart')==='1')await w.restart();}}
   if(!connected())return;
   const changed=()=>{if(disposed||attempt!==generation)return;if(!selected.valid){if(source.platform==='bilibili'){recover({videoKey:source.videoKey,durationMs,clipId:client.clip?.id});return;}generation++;stop();root.replaceChildren(status('视频或播放器已变化。请重新点击工具栏的声格。',undefined,true),button('关闭',dispose,'text'));}};
   observer=new MutationObserver(changed);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
   for(const event of ['emptied','loadedmetadata','durationchange'])video.addEventListener(event,changed);
   unwatch=()=>{for(const event of ['emptied','loadedmetadata','durationchange'])video.removeEventListener(event,changed);};changed();
  }catch(e){if(!alive())return;stop();if(freshEpisode)offerCurrent(message(e),freshEpisode,attempt);else root.replaceChildren(status(message(e),{label:'重试连接',run:()=>void connect(video)},true),button('关闭',dispose,'text'));}
 });
 return connection;
}
const videos=visibleVideos();
const player=document.querySelector('#player')??videos[0]?.parentElement;
if(player)player.insertAdjacentElement('afterend',host);else document.body.append(host);
if(videos.length===1)void connect(videos[0]);
else if(videos.length>1){root.append(text('选择当前要练习的播放器：'));videos.forEach((video,i)=>root.append(button(`播放器 ${i+1} · ${Math.round(video.getBoundingClientRect().width)}px`,()=>void connect(video),'soft')));}
else root.append(status('未找到可控制的视频。请先打开视频并播放正片。'),button('关闭',dispose,'text'));
}
