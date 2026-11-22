import {Workspace} from '../src/workspace';import {VideoAdapter} from '../src/player';import {Client} from '../src/client';import {createClip} from '../src/domain';
const setup=document.querySelector<HTMLButtonElement>('#setup')!,out=document.querySelector('#output')!,area=document.querySelector('#work')!;
setup.onclick=async()=>{
 setup.disabled=true;
 const v=document.createElement('video');v.src='cafe.mp4';v.muted=true;v.preload='auto';area.append(v);await new Promise(r=>v.addEventListener('loadedmetadata',r,{once:true}));
 const clip=createClip({videoKey:'demo:cafe',url:'demo:cafe',title:'独立重试验收',durationMs:v.duration*1000,segments:[{id:'saved',revision:1,startMs:0,endMs:1000,source:'turn',onsetVerified:true,onsetVersion:3}]});
 clip.progress.saved.count=clip.progress.saved.target;clip.progress.saved.reason='target';const before=JSON.stringify(clip.progress);let submissions=0;const starts:number[]=[];let plays=0;
 v.addEventListener('playing',()=>{plays++;if(plays===1)setTimeout(()=>v.dispatchEvent(new Event('waiting')),500);else if(plays===2)setTimeout(()=>{v.currentTime=2;},300);else if(plays===3)setTimeout(()=>v.pause(),400);});
 const client=new Client(async m=>{if(m.type==='ACQUIRE_SESSION'||m.type==='RENEW_SESSION')return {ok:true,dataEpoch:1,data:{ownerId:'qa',generation:1,expiresAt:Date.now()+60000}};if(m.type==='SAVE_CHECKPOINT'){if(m.payload.current!==undefined)clip.current=m.payload.current;if(m.payload.mode)clip.mode=m.payload.mode;if(m.payload.settings)clip.settings=m.payload.settings;}return {ok:true,dataEpoch:1,data:clip};});client.clip=clip;
 const adapter=new VideoAdapter(v,'demo:cafe');const ws=new Workspace(adapter,client,{demo:true,onRecords:()=>{},onExit:()=>{},asrTransport:async action=>{
  if(action==='warmup')return {warming:false};
  if(action==='prepare'){starts.push(adapter.position);out.textContent=JSON.stringify({starts,progressUnchanged:before===JSON.stringify(clip.progress),savedSegments:clip.segments.length},null,2);return {streaming:true};}
  if(action==='submit'){submissions++;out.textContent=JSON.stringify({submissions,starts,progressUnchanged:before===JSON.stringify(clip.progress),savedSegments:clip.segments.length},null,2);throw Error('模拟识别超时：请重试识别。');}
  return {};
 }});area.replaceChildren(ws.root);await ws.resume(clip);out.textContent='就绪：点下一句，依次模拟缓冲、跳转，再主动暂停。';
};
