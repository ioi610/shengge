import {RECOGNITION_MODEL} from '../src/recognition-model';
const output=document.querySelector('#output')!,button=document.querySelector<HTMLButtonElement>('#run')!,repeat=document.querySelector<HTMLButtonElement>('#repeat')!;
let worker:Worker|undefined;let shared:Int32Array|undefined;let file='recognition.wav';
function log(value:any){output.textContent+='\n'+JSON.stringify(value,null,2);}
async function run(){repeat.disabled=true;const audio=await(await fetch('./'+file)).arrayBuffer();if(shared)Atomics.store(shared,0,0);worker!.postMessage({type:'run',id:file,audio,durationMs:Math.round((audio.byteLength-44)/32),language:file==='jfk.wav'?'en':'ja'},[audio]);}
(document.querySelector('#sample') as HTMLSelectElement).onchange=e=>{file=(e.target as HTMLSelectElement).value;};
repeat.onclick=()=>void run();
button.onclick=()=>{worker?.terminate();shared=undefined;button.disabled=true;repeat.disabled=true;output.textContent='';worker=new Worker('./recognition-worker.js',{type:'module'});worker.onmessage=async({data})=>{
 if(data.type==='progress'){document.querySelector('#progress')!.textContent=`${data.progress.stage} ${Math.round(data.progress.loaded/RECOGNITION_MODEL.bytes*100)}%`;return;}
 if(data.type==='memory'){shared=new Int32Array(data.buffer,data.pointer,1);return;}
 if(data.type==='diagnostic'){document.querySelector('#diagnostic')!.textContent+=data.line+'\n';return;}
 log(data);
 if(data.type==='ready')await run();
 if(data.type==='result'||data.type==='error'){button.disabled=false;repeat.disabled=data.type==='error';}
 };worker.onerror=e=>{log({error:e.message});button.disabled=false;};worker.postMessage({type:'prepare',qaModelUrl:new URLSearchParams(location.search).has('localModel')?new URL('./model.bin',location.href).href:undefined});};
