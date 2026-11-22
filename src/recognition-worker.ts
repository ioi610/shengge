import {verifiedModel,RECOGNITION_MODEL} from './recognition-model';
import {decodeRecognitionWav} from './recognition-audio';
import {streamingTranscriptSegments} from './transcript-segments';
declare const __SHENGGE_QA__:boolean;
let engine:any;let loading:Promise<void>|undefined;let abort=new AbortController();
const send=(data:any)=>self.postMessage(data);
async function prepare(qaModelUrl?:string){
 if(engine){send({type:'ready'});return;}
 return loading??=(async()=>{
  if(!self.crossOriginIsolated)throw new Error('浏览器未启用扩展识别所需的隔离环境，请重新加载扩展。');
  if(typeof (WebAssembly as any).Suspending!=='function')throw new Error('请更新桌面 Chrome 后使用离线识别。');
  const gpu=(navigator as any).gpu;
  if(!gpu||!await gpu.requestAdapter())throw new Error('当前浏览器没有可用的 WebGPU。请使用支持图形加速的桌面 Chrome；已有字幕和练习记录仍可使用。');
  const spec=__SHENGGE_QA__&&qaModelUrl?{...RECOGNITION_MODEL,url:qaModelUrl,cache:'shengge-whisper-qa'}:RECOGNITION_MODEL;
  const model=await verifiedModel(progress=>send({type:'progress',progress}),abort.signal,spec);
  const {default:create}=await import(new URL('./asr/shengge-asr.mjs',import.meta.url).href);
  const instance=await create({print:()=>{},printErr:(line:string)=>{if(__SHENGGE_QA__)send({type:'diagnostic',line});},onAbort:()=>send({type:'error',error:'识别引擎退出，请重试；内存不足时请关闭其他大型页面。'})});
  instance.FS.writeFile('/model.bin',new Uint8Array(model));let ok=false;try{ok=await instance.init('/model.bin');}finally{instance.FS.unlink('/model.bin');}
  if(!ok)throw new Error('浏览器识别模型加载失败，可能内存不足。');engine=instance;
  send({type:'memory',buffer:engine.HEAPU8.buffer,pointer:engine.cancelPointer()});send({type:'ready'});
 })().catch(error=>{loading=undefined;send({type:'error',error:String(error?.message??error)});});
}
self.onmessage=async({data})=>{
 if(data.type==='prepare'){void prepare(data.qaModelUrl);return;}
 if(data.type!=='run')return;const started=performance.now();
 try{if(!engine)throw new Error('识别模型尚未就绪。');const pcm=decodeRecognitionWav(new Uint8Array(data.audio),data.durationMs);const raw=JSON.parse(await engine.transcribe(pcm,data.language??'auto',Math.min(4,navigator.hardwareConcurrency||2)));const result={streaming:true,language:raw.language??'auto',segments:streamingTranscriptSegments(raw.segments??[],data.durationMs),warnings:[]};send({type:'result',id:data.id,result,elapsedMs:performance.now()-started});}
 catch(error){send({type:'result',id:data.id,error:String((error as Error)?.message??error),elapsedMs:performance.now()-started});}
};
