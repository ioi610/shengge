// Test-only transport: the production app and repository render against disposable QA data.
// This file is never included by scripts/build.mjs or in the extension/web release.
import {Repository, fresh, Request} from '../src/storage';
import {createClip, uid} from '../src/domain';
async function start(){
 const name='shengge-qa-records-ui-v1';
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open(name);q.onupgradeneeded=()=>{const root=fresh();const base=createClip({videoKey:'youtube:abcdefghijk',url:'https://www.youtube.com/watch?v=abcdefghijk',title:'测试夹具',durationMs:10000,segments:[{id:'a',revision:1,startMs:1000,endMs:2000,source:'manual'},{id:'b',revision:1,startMs:3000,endMs:4000,source:'manual'}]});for(let i=0;i<1000;i++){const c=structuredClone(base);c.id=`qa-${String(i).padStart(4,'0')}`;c.name=`验收片段 ${String(i).padStart(4,'0')}`;c.progress.a.count=i%20;if(i%2===0)Object.values(c.progress).forEach(p=>p.reason='early');if(i%3===0)c.questions=[{id:'q',cueId:'a',targetId:'b',revealed:true,rating:'stuck'}];root.clips[c.id]=c;}q.result.createObjectStore('state').put(root,'root');};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});db.close();
 const repo=new Repository(name);await repo.request({protocolVersion:1,requestId:uid(),type:'HELLO',payload:{}},{binding:'fixture',controller:false});
 const runtime={lastError:undefined,sendMessage(...args:any[]){const message:Request=args[args.length-2],callback=args[args.length-1];void repo.request(message,{binding:'fixture',controller:false}).then(callback);}};
 Object.defineProperty(window,'chrome',{value:{runtime},configurable:true});
 const banner=document.createElement('p');banner.textContent='独立验收 · 1000条测试记录 · 不连接真实扩展';banner.style.cssText='margin:10px;text-align:center;font-size:12px';document.body.prepend(banner);
 await import('../src/app');
}
void start().catch(e=>{document.body.textContent=String(e);});
