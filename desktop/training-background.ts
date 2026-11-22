import '../src/background';
import {resolveSource} from '../src/domain';

const chunks=new Map<number,{id:string,parts:Map<number,string>,saving:boolean}>();
async function importHistory(id:number,url:URL){
 const m=/^#sg:([a-f0-9-]{36}):(\d+):(\d+):([A-Za-z0-9+/=]+)(?::\d+)?$/.exec(url.hash);
 if(!m)return;
 const [index,total]=[Number(m[2]),Number(m[3])];
 if(total<1||total>600||index>=total||m[4].length>48000)return;
 let batch=chunks.get(id);
 if(!batch||batch.id!==m[1]){batch={id:m[1],parts:new Map(),saving:false};chunks.set(id,batch);}
 if(batch.saving)return;
 batch.parts.set(index,m[4]);if(batch.parts.size!==total)return;
 batch.saving=true;
 try{
  const encoded=Array.from({length:total},(_,i)=>batch!.parts.get(i)).join('');
  const raw=new TextDecoder().decode(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))).join(',');
  if((await chrome.storage.local.get('legacyImportHash')).legacyImportHash===hash)return;
  const records=JSON.parse(raw);
  if(Array.isArray(records)){
   const update:Record<string,unknown>={};const recent=[];
   for(const item of records.slice(0,12)){
    try{
     const source=item.url==='demo:cafe'?{videoKey:'demo:cafe',url:'demo:cafe'}:resolveSource(item.url);
     if(source.videoKey!==item.videoKey)continue;
     recent.push({url:source.url,videoKey:source.videoKey,title:String(item.title).slice(0,500)});
     if(Array.isArray(item.lines)&&item.lines.length<=5000){
      const key='lines:'+source.videoKey;
      if(!(key in await chrome.storage.local.get(key)))update[key]=item.lines.map((v:any,i:number)=>({...v,id:'legacy-'+i,source:'platform',revision:1}));
     }
     if(item.receipt)update['legacyReceipt:'+source.videoKey]=item.receipt;
    }catch{/* Skip invalid older links. */}
   }
   update.legacyImportHash=hash;update.legacyRecent=recent;await chrome.storage.local.set(update);
  }
 }finally{chunks.delete(id);await chrome.tabs.update(id,{url:chrome.runtime.getURL('home.html')});}
}
chrome.tabs.onRemoved.addListener(id=>chunks.delete(id));
function openLauncher(id:number,value?:string){
 if(!value?.startsWith('file:'))return;
 const url=new URL(value);
 if(decodeURIComponent(url.pathname).endsWith('/声格/迁移/desktop-start.html')){void importHistory(id,url);return;}
 if(!url.pathname.endsWith('/Contents/Resources/ui/training-launch.html'))return;
 const request=decodeURIComponent(url.hash.slice(1)).replace(/~\d+$/,'');
 let destination:string;
 if(request==='home'||request==='demo'||request==='records'){
  destination=chrome.runtime.getURL(request==='home'?'home.html':request==='demo'?'practice.html':'index.html#records');
 }else{
  try{
   const source=resolveSource(request);
   const target=new URL(source.url),time=new URL(request).searchParams.get('t');
   if(time && /^\d{1,7}$/.test(time))target.searchParams.set('t',time);
   destination=target.href;
  }catch{return;}
 }
 void chrome.tabs.update(id,{url:destination}).catch(()=>{});
}
chrome.tabs.onUpdated.addListener((id,change,tab)=>openLauncher(id,change.url??tab.url));
async function findLaunchers(){
 for(const tab of await chrome.tabs.query({}))if(tab.id!==undefined)openLauncher(tab.id,tab.pendingUrl??tab.url);
}
chrome.runtime.onStartup.addListener(findLaunchers);
chrome.runtime.onInstalled.addListener(findLaunchers);
void findLaunchers();

chrome.runtime.onConnect.addListener(port=>{
 const id=port.sender?.tab?.id;
 if(port.name!=='desktop-navigation'||id===undefined||port.sender?.id!==chrome.runtime.id||port.sender.frameId!==0)return;
 port.onMessage.addListener(route=>{
  if(route!=='home'&&route!=='records')return;
  void chrome.tabs.update(id,{url:chrome.runtime.getURL(route==='home'?'home.html':'index.html#records')}).catch(()=>{});
 });
});
