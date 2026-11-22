import {desktopTraining} from './config';
import {Repository, Request, Authority} from './storage';
import {resolveSource} from './domain';
import {dispatchRecognition} from './recognition-dispatch';
import {dispatchPageAudio} from './page-audio';
import {backendStatus} from './backend-status';
import {dispatchPageVolume} from './page-volume';
import {currentPageSender} from './current-page-sender';
const repo=new Repository('shengge-formal-v1',false,false,desktopTraining);
const demoRepo=desktopTraining?new Repository('shengge-formal-v1',true,false,true):undefined;
function respond(m:Request,sender:chrome.runtime.MessageSender,reply:(r:any)=>void){
 let auth:Authority={binding:'',controller:false};
 const sample=desktopTraining && sender.frameId===0 && sender.url?.split('#')[0]===chrome.runtime.getURL('practice.html');
 if(sender.id===chrome.runtime.id){
  auth.binding=`${sender.tab?.id??'extension'}:${sender.frameId??0}:${sender.documentId??sender.url}`;
  if(desktopTraining&&sender.tab?.id!==undefined&&sender.frameId===0&&sender.documentId&&sender.documentLifecycle==='active')auth.activeTabFrame=sender.tab.id+':0:';
  if(sample){auth.videoKey='demo:cafe';auth.controller=true;}
  else if(sender.tab&&sender.frameId===0&&sender.url){try{auth.videoKey=resolveSource(sender.url).videoKey;auth.controller=true;}catch{}}
  else if(!sender.url?.startsWith(chrome.runtime.getURL(''))){reply({ok:false,error:'INVALID_REQUEST'});return;}
 }else{reply({ok:false,error:'INVALID_REQUEST'});return;}
 (sample?demoRepo!:repo).request(m,auth).then(reply).catch(()=>reply({ok:false,error:'STORAGE_FAILED'}));
}
chrome.runtime.onMessage.addListener((m,s,r)=>{
 if(m?.target==='ASR_OFFSCREEN')return false;
 void (async()=>{
  // Resolve the authenticated live document for every page request, including
  // storage and recognition, so an SPA episode change cannot reuse the old key.
  const sender=s.tab&&s.frameId===0&&!s.url?.startsWith(chrome.runtime.getURL(''))?await currentPageSender(s):s;
  if(m?.type==='BACKEND_STATUS')r({ok:true,data:backendStatus(sender)});
  else if(desktopTraining&&m?.type==='DESKTOP_ENABLE_SOUND'&&sender.id===chrome.runtime.id&&sender.frameId===0&&sender.tab?.id!==undefined){
   const tab=await chrome.tabs.get(sender.tab.id);
   if(tab.mutedInfo?.muted)await chrome.tabs.update(sender.tab.id,{muted:false});
   r({ok:true});
  }
  else if(m?.type==='PAGE_VOLUME')r({ok:true,data:await dispatchPageVolume(m,sender)});
  else if(m?.type==='PAGE_AUDIO')r({ok:true,data:await dispatchPageAudio(sender)});
  else if(m?.type==='LOCAL_ASR')r({ok:true,data:await dispatchRecognition(m,sender)});
  else respond(m,sender,r);
 })().catch(e=>r({ok:false,error:e.message,code:e.code}));
 return true;
});
chrome.action.onClicked.addListener(async(tab)=>{if(tab.id&&tab.url){try{resolveSource(tab.url);await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});return;}catch{}}await chrome.tabs.create({url:chrome.runtime.getURL('index.html')});});
