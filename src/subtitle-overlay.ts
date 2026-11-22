import {playerSurface} from './site-player';
import {h} from './dom';
export type SubtitlePosition={x:number;y:number};
const key='shengge-subtitle-position-v1';
const initial={x:.5,y:.82};
/** Keep the complete caption inside the video, including after resize/fullscreen. */
export function captionPoint(position:SubtitlePosition,width:number,height:number,boxWidth:number,boxHeight:number){
 const margin=8,xPad=Math.min(width/2,boxWidth/2+margin),yPad=Math.min(height/2,boxHeight/2+margin);
 return {x:Math.max(xPad,Math.min(width-xPad,position.x*width)),y:Math.max(yPad,Math.min(height-yPad,position.y*height))};
}
export class SubtitleOverlay {
 readonly host=h('div',{'data-shengge-subtitles':''});
 private box=h('div',{class:'subtitle',tabindex:0,role:'group','aria-label':'对白字幕，拖动或使用方向键移动',title:'拖动字幕调整位置',dir:'auto',hidden:true});
 private hint=h('div',{class:'hint',hidden:true});
 private original=h('div',{class:'original'});private translation=h('div',{class:'translation',lang:'en',hidden:true});
 private position={...initial};private abort=new AbortController();private resize:ResizeObserver;private dockChanges?:MutationObserver;private parent:HTMLElement;private priorPosition:string;private changedPosition=false;private dragging?:{id:number;dx:number;dy:number};
 constructor(private video:HTMLVideoElement){
  this.box.append(this.original,this.translation,this.hint);
  this.parent=playerSurface(video);
  this.priorPosition=this.parent.style.position;
  if(getComputedStyle(this.parent).position==='static'){this.parent.style.position='relative';this.changedPosition=true;}
  this.host.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:60;';
  const shadow=this.host.attachShadow({mode:'open'});
  shadow.append(h('style',null,`:host{font-family:-apple-system,BlinkMacSystemFont,"Noto Sans",sans-serif;color:#fff}.subtitle{box-sizing:border-box;width:max-content;position:absolute;transform:translate(-50%,-50%);margin:0;padding:7px 16px;border:1px solid transparent;border-radius:9px;background:transparent;color:#fff;text-shadow:0 1px 3px #000,1px 0 1px #000,-1px 0 1px #000,0 -1px 1px #000;font-weight:500;letter-spacing:.015em;line-height:1.45;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere;overflow:hidden;pointer-events:auto;cursor:grab;touch-action:none;user-select:none;transition:background .15s,border-color .15s,box-shadow .15s}.hint{font-size:.73em;font-weight:500}.subtitle[hidden],.hint[hidden],.translation[hidden]{display:none}.translation{font-size:.78em;opacity:.9;margin-top:4px}.subtitle:hover,.subtitle:focus-visible{background:transparent;border-color:transparent;box-shadow:none;backdrop-filter:none}.subtitle:focus-visible{outline:2px solid #aaa;outline-offset:2px}.subtitle.dragging{cursor:grabbing;background:transparent;border-color:transparent}@media(prefers-reduced-motion:reduce){.subtitle{transition:none}}`),this.box);
  try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y))this.position={x:Math.max(0,Math.min(1,saved.x)),y:Math.max(0,Math.min(1,saved.y))};}catch{}
  this.parent.append(this.host);
  const options={signal:this.abort.signal};
  this.box.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();const r=this.box.getBoundingClientRect();this.dragging={id:e.pointerId,dx:e.clientX-r.x-r.width/2,dy:e.clientY-r.y-r.height/2};this.box.setPointerCapture(e.pointerId);this.box.classList.add('dragging');},options);
  this.box.addEventListener('pointermove',e=>{if(this.dragging?.id!==e.pointerId)return;e.preventDefault();e.stopPropagation();const r=video.getBoundingClientRect();if(!r.width||!r.height)return;this.position={x:(e.clientX-r.x-this.dragging.dx)/r.width,y:(e.clientY-r.y-this.dragging.dy)/r.height};this.layout(true);},options);
  const end=(e:PointerEvent)=>{if(this.dragging?.id!==e.pointerId)return;e.stopPropagation();this.dragging=undefined;this.box.classList.remove('dragging');if(this.box.hasPointerCapture(e.pointerId))this.box.releasePointerCapture(e.pointerId);this.save();};
  this.box.addEventListener('pointerup',end,options);this.box.addEventListener('pointercancel',end,options);
  this.box.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();},options);this.box.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();},options);
  this.box.addEventListener('keydown',e=>{const moves:Record<string,number[]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};const move=moves[e.key];if(!move)return;e.preventDefault();e.stopPropagation();const r=video.getBoundingClientRect(),step=e.shiftKey?20:5;if(!r.width||!r.height)return;this.position.x+=move[0]*step/r.width;this.position.y+=move[1]*step/r.height;this.layout(true);this.save();},options);
  this.resize=new ResizeObserver(()=>this.layout());this.resize.observe(video);this.resize.observe(this.parent);this.resize.observe(this.box);
  const dock=this.parent.querySelector<HTMLElement>('#shengge-panel');if(dock){this.resize.observe(dock);this.dockChanges=new MutationObserver(()=>this.layout());this.dockChanges.observe(dock,{attributes:true,attributeFilter:['style']});}
  document.addEventListener('fullscreenchange',()=>this.layout(),options);
 }
 setText(value:string,english='',hint=''){if(this.original.textContent===value&&this.translation.textContent===english&&this.hint.textContent===hint)return;this.hint.textContent=hint;this.hint.hidden=!hint||!!value;this.original.textContent=value;this.translation.textContent=value?english:'';this.translation.hidden=!value||!english;this.box.hidden=!value&&!hint;this.host.toggleAttribute('data-caption-visible',!!value);this.layout();}
 private layout(commit=false){const r=this.video.getBoundingClientRect(),p=this.host.getBoundingClientRect();if(!r.width||!r.height)return;this.box.style.maxWidth=Math.max(1,r.width-16)+'px';this.box.style.maxHeight=Math.max(1,r.height-16)+'px';this.box.style.fontSize=Math.max(14,Math.min(32,r.width*.029))+'px';const box=this.box.getBoundingClientRect();const point=captionPoint(this.position,r.width,r.height,box.width,box.height);const dock=this.parent.querySelector<HTMLElement>('#shengge-panel')?.getBoundingClientRect();if(dock&&dock.top>r.top&&dock.top<r.bottom&&dock.width>0){point.y=Math.min(point.y,Math.max(box.height/2+8,dock.top-r.y-box.height/2-14));}this.box.style.left=r.x-p.x+point.x+'px';this.box.style.top=r.y-p.y+point.y+'px';if(commit)this.position={x:point.x/r.width,y:point.y/r.height};}
 private save(){try{localStorage.setItem(key,JSON.stringify(this.position));}catch{}}
 dispose(){this.abort.abort();this.resize.disconnect();this.dockChanges?.disconnect();this.host.remove();if(this.changedPosition&&this.parent.style.position==='relative')this.parent.style.position=this.priorPosition;}
}
