import {PlayerVolume} from './player-volume';
import {formatTime,message,resolveSource,type Segment} from '../src/domain';
import {AudioSourceUnavailable} from '../src/page-audio';
import {nativeControlCSS,nativeMenuCSS,playerSurface} from '../src/site-player';
import type {Workspace} from '../src/workspace';
import css from './player-view.css';

export function desktopPage(destination:'home'|'records'){
 const port=chrome.runtime.connect({name:'desktop-navigation'});port.postMessage(destination);
}
let current:DesktopPlayer|undefined;
export function desktopPlayer(){return current??=new DesktopPlayer();}

const danmakuLayers='.bpx-player-render-dm-wrap,.bpx-player-row-dm-wrap,.bpx-player-adv-dm-wrap,.bpx-player-bas-dm-wrap,.bpx-player-cmd-dm-wrap,.bili-danmaku-x-dm-rotate,.bilibili-player-video-danmaku';
const surfaceCSS=`
[data-sg-surface] :is(.ytp-caption-segment,.ytp-caption-window-container .caption-window,.bpx-player-subtitle-panel-text,.bilibili-player-video-subtitle span),[data-sg-surface]:not([data-shengge-cue-mask]) video::cue{background:transparent!important;text-shadow:0 1px 2px #000,1px 0 1px #000,-1px 0 1px #000}
[data-sg-hide-danmaku] :is(${danmakuLayers}){display:none!important}
:is([data-sg-captions-off],[data-sg-surface]:has([data-shengge-subtitles][data-caption-visible])) :is(.ytp-caption-window-container,.bpx-player-subtitle-wrap,.bilibili-player-video-subtitle){display:none!important}
:is([data-sg-captions-off],[data-sg-surface]:has([data-shengge-subtitles][data-caption-visible])) video::cue{color:transparent!important;background:transparent!important;text-shadow:none!important}
html[data-sg-player]:not(:fullscreen){overflow:hidden!important}
html[data-sg-player]:not(:fullscreen) body{overflow:hidden!important}
html[data-sg-player]:not(:fullscreen) :is(html,body,body *):has([data-sg-surface]){transform:none!important;translate:none!important;scale:none!important;contain:none!important;filter:none!important;perspective:none!important;opacity:1!important;clip-path:none!important;isolation:auto!important;z-index:auto!important;overflow:visible!important;will-change:auto!important;container-type:normal!important}
html[data-sg-player]:not(:fullscreen) body *:not(:has([data-sg-surface])):not([data-sg-surface]):not([data-sg-surface] *){visibility:hidden!important;pointer-events:none!important}
html[data-sg-player]:not(:fullscreen) [data-sg-surface]{position:fixed!important;inset:auto!important;left:var(--sg-x)!important;top:var(--sg-y)!important;width:var(--sg-w)!important;height:var(--sg-h)!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;margin:0!important;z-index:2147483646!important;overflow:hidden!important;background:#050607!important;border-radius:12px!important}
html[data-sg-player]:not(:fullscreen) [data-sg-surface] video{object-fit:contain!important;max-width:none!important;max-height:none!important;width:100%!important;height:100%!important;left:0!important;top:0!important}
html[data-sg-player]:not(:fullscreen) [data-sg-surface] .html5-video-container{width:100%!important;height:100%!important}
`;
export class DesktopPlayer{
 readonly host=document.createElement('div');
 readonly ui=this.host.attachShadow({mode:'open'});
 readonly controls:HTMLElement;
 private slot:HTMLElement;
 private sound:PlayerVolume;
 private video?:HTMLVideoElement;
 private surface?:HTMLElement;
 private workspace?:Workspace;
 private listener=()=>this.refresh();
 private lastRows='';
 private mark?:number;
 private captions=true;
 private danmaku=false;
 private bili=false;
 private preferencesReady=false;
 private nativeObserver?:MutationObserver;
 private lastDanmakuInput?:HTMLInputElement;
 private lastYoutubeButton?:HTMLElement;
 private generation?:AbortController;
 private captureNeeded=false;
 constructor(){
  this.host.id='shengge-desktop';
  const style=document.createElement('style');style.textContent=css;this.ui.append(style);
  const container=document.createElement('div');
  container.innerHTML='<header><button class="brand" aria-label="返回视频首页">声格</button><form><input aria-label="视频链接" placeholder="粘贴视频链接"><button aria-label="打开视频">→</button></form><button class="records">学习记录</button></header><button class="native-return">返回声格播放器</button><main><section><div class="screen">正在打开视频…</div><div class="tools"><button data-op="play" aria-label="播放或暂停">▶</button><button data-op="sound" aria-label="静音">声音开</button><input class="volume" type="range" min="0" max="100" aria-label="播放器音量"><button data-mode="listen">复读</button><button data-mode="shadow">跟读</button><button data-mode="cue">接话</button><span class="spacer"></span><button data-op="captions" aria-label="字幕">字幕 开</button><button data-op="danmaku" aria-label="弹幕" hidden>弹幕 关</button><button data-op="file" title="导入 SRT / VTT">导入字幕</button><button data-op="mark">标记句首</button><button data-op="site">原站控件</button></div><input type="file" accept=".srt,.vtt" hidden><div class="actions"></div><div class="caption-source" hidden><span>暂无可读取字幕</span> <button data-op="generate">生成字幕</button></div><p class="notice" role="status"></p></section><aside><h2>对白</h2><ol></ol></aside></main>';
  this.ui.append(container);this.slot=this.ui.querySelector('.screen')!;this.controls=this.ui.querySelector('.actions')!;
  document.documentElement.append(this.host);
  const rule=document.createElement('style');rule.textContent=surfaceCSS+nativeControlCSS+nativeMenuCSS;document.documentElement.append(rule);
  this.ui.querySelector('form')!.onsubmit=e=>{e.preventDefault();try{location.assign(resolveSource(this.ui.querySelector<HTMLInputElement>('form input')!.value).url);}catch(error){this.note(message(error));}};
  this.ui.querySelector<HTMLButtonElement>('.brand')!.onclick=()=>desktopPage('home');
  this.ui.querySelector<HTMLButtonElement>('.records')!.onclick=()=>desktopPage('records');
  const site=()=>{this.host.toggleAttribute('data-native');this.layout();};
  this.ui.querySelector<HTMLButtonElement>('.native-return')!.onclick=site;
  this.ui.querySelector<HTMLButtonElement>('[data-op=site]')!.onclick=site;
  this.ui.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b=>b.onclick=()=>void this.workspace?.desktopMode(b.dataset.mode as 'listen'|'shadow'|'cue'));
  this.ui.querySelector<HTMLButtonElement>('[data-op=play]')!.onclick=()=>void this.workspace?.desktopPlayback();
  const op=(name:string)=>this.ui.querySelector<HTMLButtonElement>(`[data-op="${name}"]`)!;
  this.sound=new PlayerVolume(op('sound'),this.ui.querySelector('.volume')!,value=>this.note(value));
  op('captions').onclick=()=>{this.captions=!this.captions;this.lastYoutubeButton=undefined;this.applyPreferences();void chrome.storage.local.set({desktopCaptions:this.captions});};
  op('danmaku').onclick=()=>{this.danmaku=!this.danmaku;this.lastDanmakuInput=undefined;this.applyPreferences();void chrome.storage.local.set({desktopDanmaku:this.danmaku});};
  void chrome.storage.local.get({desktopCaptions:true,desktopDanmaku:false}).then(p=>{
   this.captions=p.desktopCaptions!==false;this.danmaku=p.desktopDanmaku===true;this.preferencesReady=true;this.applyPreferences();
  });
  op('generate').onclick=()=>void this.generateCaptions();
  const file=this.ui.querySelector<HTMLInputElement>('[type=file]')!;
  this.ui.querySelector<HTMLButtonElement>('[data-op=file]')!.onclick=()=>file.click();
  file.onchange=async()=>{const f=file.files?.[0];file.value='';if(!f)return;try{
   if(f.size>2_000_000)throw Error('请选择小于 2 MB 的字幕。');
   const {parseSubtitles}=await import('./subtitles');await this.addLines(parseSubtitles(await f.text()));
  }catch(e){this.note(message(e));}};
  this.ui.querySelector<HTMLButtonElement>('[data-op=mark]')!.onclick=async()=>{
   if(!this.video||!this.workspace)return;
   try{const now=Math.round(this.video.currentTime*1000);
    if(this.mark===undefined){this.mark=now;await this.video.play();}
    else{this.video.pause();if(now-this.mark<350)throw Error('请在一句对白结束时标记句尾。');await this.addLines([...this.workspace.adapter.cues,{id:crypto.randomUUID(),revision:1,startMs:this.mark,endMs:now,source:'manual'}]);this.mark=undefined;}
   }catch(e){this.note(message(e));}this.refresh();
  };
  new ResizeObserver(()=>this.layout()).observe(this.slot);
  this.host.addEventListener('scroll',()=>this.layout(),{passive:true});
  window.addEventListener('resize',()=>this.layout());
  this.refresh();
 }
 private async addLines(lines:Segment[]){if(!this.workspace)throw Error('请先加载正片。');this.generation?.abort();await this.workspace.setDesktopLines(lines);this.note('');this.refresh();}
 private note(value:string){this.ui.querySelector('.notice')!.textContent=value;}
 private syncNativeControls(){
  if(!this.preferencesReady||!this.surface)return;
  if(this.bili){
   const input=(this.surface.closest('.bpx-player-container')??document).querySelector<HTMLInputElement>('.bpx-player-dm-switch input[type=checkbox]');
   if(input&&input!==this.lastDanmakuInput){this.lastDanmakuInput=input;if(input.checked!==this.danmaku)input.click();}
  }else if(this.captions&&!this.workspace?.adapter.cues.some(s=>s.text)){
   const cc=this.surface.querySelector<HTMLElement>('.ytp-subtitles-button[aria-pressed]');
   if(cc&&cc!==this.lastYoutubeButton&&getComputedStyle(cc).display!=='none'&&!cc.hasAttribute('disabled')){
    this.lastYoutubeButton=cc;if(cc.getAttribute('aria-pressed')==='false')cc.click();
   }
  }
 }
 private applyPreferences(){
  this.surface?.toggleAttribute('data-sg-captions-off',!this.captions);
  this.surface?.toggleAttribute('data-sg-hide-danmaku',this.bili&&!this.danmaku);
  this.workspace?.setDesktopCaptions(this.captions);
  this.syncNativeControls();this.refresh();
 }
 private async generateCaptions(){
  if(this.generation){this.generation.abort();return;}
  if(!this.workspace)return;
  const controller=new AbortController();this.generation=controller;this.note('正在读取音轨…');this.refresh();
  try{
   await this.workspace.generateDesktopCaptions(controller.signal,value=>{if(!controller.signal.aborted)this.note(value);},this.captureNeeded);
   if(!controller.signal.aborted)this.note('字幕已生成');
  }catch(e){if(!controller.signal.aborted){
   if(e instanceof AudioSourceUnavailable){this.captureNeeded=true;this.note('需要从头播放一次以读取音轨。也可以直接导入字幕。');}
   else this.note(message(e));
  }}
  finally{if(this.generation===controller){this.generation=undefined;if(controller.signal.aborted)this.note('');this.refresh();}}
 }
 attach(video:HTMLVideoElement,controls:HTMLElement){
  this.surface?.removeAttribute('data-sg-surface');this.video=video;this.sound.bind(video);this.surface=playerSurface(video);
  this.bili=/(^|\.)bilibili\.com$/.test(location.hostname);
  this.nativeObserver?.disconnect();this.lastDanmakuInput=undefined;this.lastYoutubeButton=undefined;
  this.nativeObserver=new MutationObserver(()=>{if(this.bili?!this.lastDanmakuInput?.isConnected:!this.lastYoutubeButton?.isConnected)this.syncNativeControls();});
  this.nativeObserver.observe(this.surface.closest('.bpx-player-container')??this.surface,{childList:true,subtree:true});
  this.surface.setAttribute('data-sg-surface','');this.slot.textContent='';this.controls.replaceChildren(controls);
  this.layout();this.applyPreferences();
 }
 bind(workspace:Workspace){this.workspace?.root.removeEventListener('desktop-state',this.listener);this.workspace=workspace;workspace.root.addEventListener('desktop-state',this.listener);this.lastRows='';this.applyPreferences();}
 unbind(){this.generation?.abort();this.generation=undefined;this.captureNeeded=false;this.note('');this.workspace?.root.removeEventListener('desktop-state',this.listener);this.workspace=undefined;this.refresh();}
 detach(){this.unbind();this.sound.bind();this.nativeObserver?.disconnect();this.surface?.removeAttribute('data-sg-hide-danmaku');this.surface?.removeAttribute('data-sg-captions-off');this.video=undefined;this.surface?.removeAttribute('data-sg-surface');this.surface=undefined;this.mark=undefined;this.layout();this.refresh();}
 private layout(){
  document.documentElement.toggleAttribute('data-sg-player',!!this.surface&&!this.host.hasAttribute('data-native'));
  this.host.style.removeProperty('clip-path');
  if(!this.surface)return;
  this.surface.toggleAttribute('data-shengge-controls',!this.host.hasAttribute('data-native'));
  const r=this.slot.getBoundingClientRect();
  // The website can place the video inside its own stacking context.
  // Cut the same slot out of the shell's paint and hit-test region.
  if(!this.host.hasAttribute('data-native')){
   const x=r.left+'px',y=r.top+'px',right=r.right+'px',bottom=r.bottom+'px';
   this.host.style.setProperty('clip-path',`polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,${x} ${y},${right} ${y},${right} ${bottom},${x} ${bottom},${x} ${y})`,'important');
  }
  for(const [key,val] of Object.entries({x:r.x,y:r.y,w:r.width,h:r.height}))this.surface.style.setProperty('--sg-'+key,val+'px');
 }
 private refresh(){
  const s=this.workspace?.desktopState();
  this.ui.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b=>{b.disabled=!s||s.busy;b.setAttribute('aria-pressed',String(s?.mode===b.dataset.mode));});
  const captions=this.ui.querySelector<HTMLButtonElement>('[data-op=captions]')!,dm=this.ui.querySelector<HTMLButtonElement>('[data-op=danmaku]')!;
  for(const [button,label,on] of [[captions,'字幕',this.captions],[dm,'弹幕',this.danmaku]] as const){
   button.textContent=label+(on?' 开':' 关');button.setAttribute('aria-pressed',String(on));button.disabled=!this.surface||!this.preferencesReady;
  }
  dm.hidden=!this.bili;
  const usingNative=this.lastYoutubeButton?.isConnected===true&&this.lastYoutubeButton.getAttribute('aria-pressed')==='true';
  this.workspace?.setDesktopNativeCaptions(usingNative);
  if(s&&(s.active||s.discovering))this.generation?.abort();
  const source=this.ui.querySelector<HTMLElement>('.caption-source')!;
  source.hidden=!s||!this.captions||s.active||s.busy||s.hasCaptionText||usingNative;
  source.querySelector('span')!.textContent=this.generation?'正在生成整段字幕':s?.captionStatus??'播放时自动识别字幕';
  source.querySelector('button')!.textContent=this.generation?'取消生成':this.captureNeeded?'从头播放生成整段字幕':'生成整段字幕';
  const mark=this.ui.querySelector<HTMLButtonElement>('[data-op=mark]')!;mark.textContent=this.mark===undefined?'标记句首':'标记句尾';
  mark.disabled=!s||s.busy||!!s.active;
  this.ui.querySelector<HTMLButtonElement>('[data-op=file]')!.disabled=mark.disabled;
  const play=this.ui.querySelector<HTMLButtonElement>('[data-op=play]')!;play.disabled=!s||s.busy;play.textContent=this.video?.paused===false?'Ⅱ':'▶';
  this.ui.querySelector<HTMLButtonElement>('[data-op=site]')!.hidden=location.protocol==='chrome-extension:';
  if(!s)return;
  const key=JSON.stringify([s.mode,s.index,s.rows]);if(key===this.lastRows)return;this.lastRows=key;
  this.ui.querySelector('h2')!.textContent=s.mode==='cue'?'接话':'对白';
  const list=this.ui.querySelector('ol')!;list.replaceChildren();
  for(const [i,row] of s.rows.entries()){
   const li=document.createElement('li');if(i===s.index)li.className='current';const n=document.createElement('b');n.textContent=String(i+1).padStart(2,'0');li.append(n);
   if(!row.visible)li.append(document.createElement('i'));else{
    const txt=document.createElement('span');txt.textContent=row.text||formatTime(row.startMs);
    if(row.englishText){const en=document.createElement('small');en.textContent=row.englishText;txt.append(en);}li.append(txt);
    if(row.rating){const m=document.createElement('em');m.textContent=row.rating==='can'?'✓':row.rating==='stuck'?'↻':'–';li.append(m);}
   }list.append(li);
  }
  const active=list.querySelector<HTMLElement>('.current');if(active){const aside=this.ui.querySelector('aside')!;if(active.offsetTop-aside.scrollTop>aside.clientHeight)aside.scrollTop=active.offsetTop-aside.offsetTop-80;}
 }
}
export class DesktopDock{
 private view=desktopPlayer();
 constructor(readonly video:HTMLVideoElement,host:HTMLElement){this.view.attach(video,host);}
 setActive(active:boolean){if(!active)this.view.unbind();playerSurface(this.video).toggleAttribute('data-shengge-controls',active);}
 dispose(){this.setActive(false);this.view.detach();}
}
