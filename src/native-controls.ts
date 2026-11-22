import {desktopTraining} from './config';
import {compactButton} from './compact-controls';
import {h} from './dom';
import {playerSurface} from './site-player';
import type {VolumeChange} from './page-volume';

/** Proxies keep native handlers/menus in their original DOM; no cloned platform controls. */
export class NativeControls {
 readonly root=h('div',{class:'native-controls',role:'group','aria-label':'原平台播放器控制'});
 private surface:HTMLElement;private abort=new AbortController();private resize:ResizeObserver;
 private menu?:HTMLElement;private anchor?:HTMLButtonElement;private nativeTrigger?:HTMLElement;
 private ancestors:HTMLElement[]=[];private controls:{control:HTMLButtonElement;selector:string}[]=[];private changes:MutationObserver;private frame=0;private menuIsYoutube=false;
 constructor(private video:HTMLVideoElement){
  this.surface=playerSurface(video);
  const signal=this.abort.signal;
  const youtube=Boolean(video.closest('#movie_player'));
  let pending:VolumeChange|undefined,busy=false;
  const volumeError=h('span',{role:'alert',hidden:true,class:'small'});
  const changeVolume=async(change:VolumeChange)=>{
   pending={...pending,...change};if(busy)return;busy=true;
   try{while(pending&&!signal.aborted){const next=pending;pending=undefined;
    if(youtube){const response=await chrome.runtime.sendMessage({type:'PAGE_VOLUME',mediaSrc:video.currentSrc,change:next});if(!response?.ok)throw new Error('音量调整失败，请重新加载声格并刷新视频页。');}
    else {if(next.volume!==undefined)video.volume=next.volume/100;if(next.muted!==undefined)video.muted=next.muted;else if(next.volume===0)video.muted=true;}
    volumeError.hidden=true;
   }}catch(e){pending=undefined;if(!signal.aborted){volumeError.textContent=(e as Error).message;volumeError.hidden=false;}}
   finally{busy=false;if(!signal.aborted)syncVolume();}
  };
  const mute=compactButton('volume','静音',()=>{void changeVolume({muted:!video.muted});});
  const volume=h('input',{type:'range',min:0,max:100,step:1,value:Math.round(video.volume*100),'aria-label':'音量',class:'native-volume'});
  const syncVolume=()=>{if(!busy)volume.value=String(Math.round(video.volume*100));mute.setAttribute('aria-label',video.muted?'取消静音':'静音');mute.setAttribute('data-tooltip',video.muted?'取消静音':'静音');mute.setAttribute('aria-pressed',String(video.muted));volume.setAttribute('aria-valuetext',`${Math.round(video.volume*100)}%${video.muted?'，已静音':''}`);};
  volume.addEventListener('input',()=>{void changeVolume({volume:Number(volume.value)});},{signal});
  video.addEventListener('volumechange',syncVolume,{signal});syncVolume();if(!desktopTraining)this.root.append(mute,volume,volumeError);
  const actions: {icon:Parameters<typeof compactButton>[0];label:string;selector:string;menu?:string}[]=youtube?[
   {icon:'siteCaptions',label:'原平台字幕',selector:'.ytp-subtitles-button'},
   {icon:'settings',label:'YouTube 设置（清晰度等）',selector:'.ytp-settings-button',menu:'.ytp-settings-menu'},
   {icon:'wide',label:'剧场模式',selector:'.ytp-size-button'},
   {icon:'pip',label:'迷你播放器',selector:'.ytp-miniplayer-button'},
   {icon:'fullscreen',label:'全屏／退出全屏',selector:'.ytp-fullscreen-button'},
  ]:[
   {icon:'quality',label:'清晰度',selector:'.bpx-player-ctrl-quality',menu:'.bpx-player-ctrl-quality-menu'},
   {icon:'settings',label:'B站播放器设置',selector:'.bpx-player-ctrl-setting',menu:'.bpx-player-ctrl-setting-box'},
   {icon:'siteCaptions',label:'原平台字幕',selector:'.bpx-player-ctrl-subtitle'},
   {icon:'episodes',label:'选集',selector:'.bpx-player-ctrl-eplist',menu:'.bpx-player-ctrl-eplist-menu-wrap'},
   {icon:'pip',label:'画中画',selector:'.bpx-player-ctrl-pip'},
   {icon:'wide',label:'宽屏模式',selector:'.bpx-player-ctrl-wide'},
   {icon:'webscreen',label:'网页全屏',selector:'.bpx-player-ctrl-web'},
   {icon:'fullscreen',label:'全屏／退出全屏',selector:'.bpx-player-ctrl-full'},
  ];
  for(const action of actions){
   const control=compactButton(action.icon,action.label,()=>{
    const target=this.surface.querySelector<HTMLElement>(action.selector);if(!target)return;
    if(action.menu){
     if(this.anchor===control){this.closeMenu();return;}
     this.closeMenu();if(youtube)target.click();
     const menu=this.surface.querySelector<HTMLElement>(action.menu);if(menu)this.openMenu(menu,control,target,youtube);
    }else{this.closeMenu();target.click();}
   },action.menu?{'aria-haspopup':'true','aria-expanded':'false'}:{});
   this.controls.push({control,selector:action.selector});this.root.append(control);
  }
  this.syncControls();
  this.changes=new MutationObserver(()=>{if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.syncControls();});});
  this.changes.observe(this.surface,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','disabled','aria-disabled']});
  // Native popup interaction stays inside the native player, away from our click-to-play handling.
  document.addEventListener('pointerdown',e=>{if(this.menu&&!e.composedPath().includes(this.menu)&&!e.composedPath().includes(this.anchor!))this.closeMenu();},{capture:true,signal});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.menu){e.preventDefault();e.stopPropagation();const anchor=this.anchor;this.closeMenu();anchor?.focus();}},{capture:true,signal});
  document.addEventListener('fullscreenchange',()=>this.closeMenu(),{signal});
  window.addEventListener('scroll',()=>this.positionMenu(),{capture:true,signal});
  this.resize=new ResizeObserver(()=>this.positionMenu());this.resize.observe(this.surface);this.resize.observe(this.root);
 }
 private syncControls(){for(const {control,selector}of this.controls){const native=this.surface.querySelector<HTMLElement>(selector);control.hidden=!native||getComputedStyle(native).display==='none';control.disabled=!!native&&(native.hasAttribute('disabled')||native.getAttribute('aria-disabled')==='true');}}
 private openMenu(menu:HTMLElement,anchor:HTMLButtonElement,trigger:HTMLElement,youtube:boolean){
  this.menu=menu;this.anchor=anchor;this.nativeTrigger=trigger;this.menuIsYoutube=youtube;
  menu.setAttribute('data-shengge-native-menu','');anchor.setAttribute('aria-expanded','true');
  for(let parent=menu.parentElement;parent&&parent!==this.surface;parent=parent.parentElement){parent.setAttribute('data-shengge-menu-ancestor','');this.ancestors.push(parent);}
  menu.addEventListener('click',this.menuChoice);this.resize.observe(menu);this.positionMenu();
 }
 private positionMenu(){
  if(!this.menu||!this.anchor)return;
  const p=this.surface.getBoundingClientRect(),a=this.anchor.getBoundingClientRect();
  const maxHeight=Math.max(80,a.top-p.top-12);
  this.menu.style.setProperty('--sg-native-height',maxHeight+'px');
  this.menu.style.setProperty('--sg-native-width',Math.max(120,p.width-16)+'px');
  const r=this.menu.getBoundingClientRect();
  this.menu.style.setProperty('--sg-native-left',Math.max(p.left+8,Math.min(a.right-r.width,p.right-r.width-8))+'px');
  this.menu.style.setProperty('--sg-native-top',Math.max(p.top+8,a.top-r.height-8)+'px');
 }
 private menuChoice=(event:MouseEvent)=>{if((event.target as Element).closest('[role=menuitemradio],.bpx-player-ctrl-quality-menu-item,.bpx-player-ctrl-eplist-multi-menu-item')){const menu=this.menu;queueMicrotask(()=>{if(this.menu===menu)this.closeMenu();});}};
 private closeMenu(){
  if(!this.menu)return;
  this.menu.removeEventListener('click',this.menuChoice);this.resize.unobserve(this.menu);this.menu.removeAttribute('data-shengge-native-menu');
  for(const key of ['height','width','left','top'])this.menu.style.removeProperty('--sg-native-'+key);
  for(const parent of this.ancestors)parent.removeAttribute('data-shengge-menu-ancestor');this.ancestors=[];
  this.anchor?.setAttribute('aria-expanded','false');
  if(this.menuIsYoutube&&this.nativeTrigger?.getAttribute('aria-expanded')==='true')this.nativeTrigger.click();
  this.menu=undefined;this.anchor=undefined;this.nativeTrigger=undefined;
 }
 dispose(){this.closeMenu();this.changes.disconnect();cancelAnimationFrame(this.frame);this.abort.abort();this.resize.disconnect();this.root.remove();}
}
