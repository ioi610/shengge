import {Workspace} from '../src/workspace';import {VideoAdapter,waitForMetadata} from '../src/player';import {Client} from '../src/client';import {Repository} from '../src/storage';import {RecognitionHost} from '../src/recognition-host';import {TurnHost} from '../src/turn-host';import {RemoteTurnModel} from '../src/turn-client';
const area=document.querySelector('#work')!,out=document.querySelector('#output')!,button=document.querySelector<HTMLButtonElement>('#setup')!;
button.onclick=async()=>{
 button.disabled=true;const video=document.createElement('video');video.src='./sintel.mp4';video.preload='auto';area.append(video);await waitForMetadata(video,new AbortController().signal);
 const repo=new Repository('shengge-qa-continuous-'+Date.now(),true),client=new Client(m=>repo.request(m,{binding:'qa',controller:true,videoKey:'demo:cafe'}));
 const host=new RecognitionHost(()=>new Worker('./recognition-worker.js',{type:'module'})),turns=new TurnHost(()=>new Worker('./turn-worker.js',{type:'module'}));
 const transport=async(action:string,payload:Record<string,unknown>={})=>{if(action.startsWith('turn-'))return turns.request(action,payload,'qa');if(action==='warmup'){host.request('prepare',{},'qa');return {};}return host.request(action,payload,'qa');};
 const adapter=new VideoAdapter(video,'demo:cafe'),start=performance.now();
 const ws=new Workspace(adapter,client,{demo:true,asrTransport:transport,turnAnalyzer:new RemoteTurnModel(transport),onRecords:()=>{},onExit:()=>ws.dispose()});area.replaceChildren(ws.root);
 const events:any[]=[];let previous='',frame=performance.now(),playing=false;const delays:number[]=[];
 const tick=()=>{const now=performance.now();if(playing&&!video.paused)delays.push(now-frame);playing=!video.paused;frame=now;requestAnimationFrame(tick);};requestAnimationFrame(tick);
 setInterval(()=>{
  const state={announcement:ws.root.querySelector('[data-workspace-announcement]')?.textContent,controls:ws.root.querySelector('.controls-area')?.textContent,notice:ws.root.querySelector('.status')?.textContent,warning:!!ws.root.querySelector('.status.warning'),current:client.clip?.current,segments:client.clip?.segments,progress:client.clip?.progress};
  const key=JSON.stringify(state);if(key!==previous){previous=key;events.push({wallMs:Math.round(performance.now()-start),positionMs:Math.round(adapter.position),paused:video.paused,...state});}
  const sorted=[...delays].sort((a,b)=>a-b);out.textContent=JSON.stringify({positionMs:Math.round(adapter.position),durationMs:adapter.duration,playingFrameP95Ms:Math.round(sorted[Math.floor(sorted.length*.95)]??0),playingFrameMaxMs:Math.round(sorted.at(-1)??0),playingFramesOver100ms:sorted.filter(n=>n>100).length,events},null,2);
 },500);
};
