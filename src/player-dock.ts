import {playerSurface,nativeBottomControls,nativeControlCSS,nativeMenuCSS} from './site-player';
/** Mount controls inside the fullscreen element and suppress native hover chrome while connected. */
export class PlayerDock {
 private player:HTMLElement;private priorPosition:string;private changedPosition=false;
 private nativeChromeStyle=document.createElement('style');
 private abort=new AbortController();private resize:ResizeObserver;private changes:MutationObserver;private frame=0;
 constructor(readonly video:HTMLVideoElement,private host:HTMLElement){
  this.player=playerSurface(video);
  this.priorPosition=this.player.style.position;
  if(getComputedStyle(this.player).position==='static'){this.player.style.position='relative';this.changedPosition=true;}
  host.style.cssText='display:block;position:absolute;left:12px;right:12px;bottom:12px;max-width:1120px;margin:0 auto;z-index:70;isolation:isolate;pointer-events:auto;';
  this.player.append(host);
  // Scoped to this connected player. Leave advertisements and all other players alone.
  // CSS also covers native controls that YouTube replaces during fullscreen/SPA updates.
  this.nativeChromeStyle.textContent=nativeControlCSS+nativeMenuCSS;
  this.player.append(this.nativeChromeStyle);
  // Controls must not bubble into YouTube's click-to-pause and keyboard shortcuts.
  for(const event of ['click','dblclick','pointerdown','pointerup','keydown','keyup'])host.addEventListener(event,e=>e.stopPropagation(),{signal:this.abort.signal});
  this.resize=new ResizeObserver(this.schedule);this.resize.observe(this.player);this.resize.observe(host);
  const chrome=this.player.querySelector(nativeBottomControls);if(chrome)this.resize.observe(chrome);
  this.changes=new MutationObserver(this.schedule);this.changes.observe(this.player,{attributes:true,attributeFilter:['class'],childList:true,subtree:true});
  if(chrome)this.changes.observe(chrome,{attributes:true,attributeFilter:['class','style']});
  document.addEventListener('fullscreenchange',this.schedule,{signal:this.abort.signal});
  this.layout();
 }
 setActive(active:boolean){this.player.toggleAttribute('data-shengge-controls',active);this.schedule();}
 private schedule=()=>{if(this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=0;this.layout();});};
 private layout(){
  const playerRect=this.player.getBoundingClientRect();let bottom=12;
  if(!this.player.classList.contains('ytp-autohide'))for(const chrome of this.player.querySelectorAll<HTMLElement>(nativeBottomControls)){
   const r=chrome.getBoundingClientRect(),style=getComputedStyle(chrome);
   if(r.width>0&&r.height>0&&r.top>playerRect.top&&r.top<playerRect.bottom&&style.display!=='none'&&style.visibility!=='hidden')bottom=Math.max(bottom,playerRect.bottom-r.top+8);
  }
  const value=bottom+'px';if(this.host.style.bottom!==value)this.host.style.bottom=value;
  const available=Math.max(48,this.player.clientHeight-bottom-12);
  this.host.style.setProperty('--dock-max-height',available+'px');
  const root=this.host.shadowRoot?.querySelector<HTMLElement>('.player-dock');
  if(root)root.classList.toggle('dock-scroll',root.scrollHeight>available);
 }
 dispose(){this.player.removeAttribute('data-shengge-controls');this.nativeChromeStyle.remove();this.abort.abort();this.resize.disconnect();this.changes.disconnect();cancelAnimationFrame(this.frame);if(this.changedPosition&&this.player.style.position==='relative')this.player.style.position=this.priorPosition;}
}
