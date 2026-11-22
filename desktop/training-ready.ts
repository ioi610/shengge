import {desktopPlayer} from './player-view';
import {resolveSource} from '../src/domain';

// The site may create or replace its player after document_idle.
async function mountWhenReady(){
 try{resolveSource(location.href);}catch{return;}
 if(!document.documentElement)await new Promise<void>(resolve=>{
  const observer=new MutationObserver(()=>{if(document.documentElement){observer.disconnect();resolve();}});observer.observe(document,{childList:true});
 });
 desktopPlayer();
 await new Promise<void>(resolve=>{
  const timer=window.setInterval(()=>{
   const ready=Array.from(document.querySelectorAll('video')).some(v=>
    v.currentSrc && v.readyState>=1 && Number.isFinite(v.duration) && v.duration>0 &&
    v.getBoundingClientRect().width>100 && v.getBoundingClientRect().height>50);
   if(ready){clearInterval(timer);resolve();}
  },250);
 });
 const source=resolveSource(location.href);
 const recent=(await chrome.storage.local.get('recentVideos')).recentVideos??[];
 await chrome.storage.local.set({recentVideos:[{...source,title:document.title},...recent.filter((r:{videoKey:string})=>r.videoKey!==source.videoKey)].slice(0,12)});
 await import('../src/content');
}
void mountWhenReady();
