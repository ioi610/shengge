import {Client} from '../src/client';
import {Repository} from '../src/storage';
import {Workspace} from '../src/workspace';
import {VideoAdapter,waitForMetadata} from '../src/player';
import {uid,Segment} from '../src/domain';
const mount=document.querySelector('#work')!;const output=document.querySelector('#output')!;
let w:Workspace|undefined;let a:VideoAdapter|undefined;
document.querySelector('#load')!.addEventListener('click',()=>void (async()=>{
 w?.dispose();a?.dispose();mount.replaceChildren();
 const v=document.createElement('video');v.src='./sintel.mp4';v.preload='auto';v.style.width='min(680px,100%)';mount.append(v);await waitForMetadata(v,new AbortController().signal);
 const segments:Segment[]=[{id:'a',revision:1,startMs:12000,endMs:14300,text:'What brings you to the land of the gatekeepers?',source:'asr'},{id:'b',revision:1,startMs:18500,endMs:19800,text:"I'm searching for someone.",source:'asr'},{id:'c',revision:1,startMs:36800,endMs:38800,text:'A dangerous quest for a lone hunter.',source:'asr'}];
 const key='local:flow-'+uid();const repo=new Repository('shengge-qa-flow-'+uid(),true);const auth={binding:uid(),controller:true,videoKey:key};
 const c=new Client(async request=>{const reply=await repo.request(request,auth);if(reply.ok&&reply.data?.segments){const clip=reply.data;output.textContent=JSON.stringify({mode:clip.mode,counts:Object.values(clip.progress).map((p:any)=>[p.count,p.target]),questions:clip.questions.map((q:any)=>({revealed:q.revealed,rating:q.rating}))},null,2);}return reply;});await c.hello();await c.call('SAVE_CLIP',{videoKey:key,url:'local:flow',title:'Sintel real-video flow QA',name:'isolated flow test',durationMs:v.duration*1000,segments});await c.acquire();await c.call('SAVE_CHECKPOINT',{settings:{...c.clip!.settings,targetDefault:1,listenGapMs:0}});await c.release();
 a=new VideoAdapter(v,key,segments);w=new Workspace(a,c,{media:{title:'Sintel real-video flow QA',url:'local:flow'},onRecords:()=>{},onExit:()=>w?.dispose()});mount.append(w.root);await w.resume(c.clip!);
})().catch(error=>output.textContent=String(error)));
