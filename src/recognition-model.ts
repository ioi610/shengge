import {desktopTraining} from './config';
export const RECOGNITION_MODEL={
 url:'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q5_1.bin',
 bytes:190085487,sha256:'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',cache:'shengge-whisper-small-q5-1-v1'
};
export type ModelProgress={stage:'checking'|'downloading'|'verifying'|'loading'|'ready';loaded:number;total:number};
export async function verifiedModel(onProgress:(p:ModelProgress)=>void,signal:AbortSignal,spec=RECOGNITION_MODEL){
 signal.throwIfAborted();
 const progress=(stage:ModelProgress['stage'],loaded=0)=>onProgress({stage,loaded,total:spec.bytes});
 const digest=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
 if(desktopTraining && spec===RECOGNITION_MODEL){
  progress('verifying');
  const response=await fetch(new URL('./asr/ggml-small-q5_1.bin',location.href),{signal});
  if(!response.ok)throw new Error('缺少桌面端语音模型，请重新安装声格。');
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength!==spec.bytes||await digest(bytes)!==spec.sha256)throw new Error('桌面端语音模型校验失败，请重新安装声格。');
  signal.throwIfAborted();progress('loading',bytes.byteLength);return bytes;
 }
 const cache=await caches.open(spec.cache);progress('checking');
 const saved=await cache.match(spec.url);
 if(saved){const bytes=await saved.arrayBuffer();if(signal.aborted)throw signal.reason;if(bytes.byteLength===spec.bytes&&await digest(bytes)===spec.sha256){progress('loading',spec.bytes);return bytes;}await cache.delete(spec.url);}
 progress('downloading');const response=await fetch(spec.url,{signal,credentials:'omit',mode:'cors'});
 if(!response.ok||!response.body)throw new Error('识别模型下载失败，请检查网络后重试。');
 const bytes=new Uint8Array(spec.bytes);const reader=response.body.getReader();let loaded=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;if(loaded+value.length>spec.bytes)throw new Error('模型文件大小不符，请重试。');bytes.set(value,loaded);loaded+=value.length;progress('downloading',loaded);}}finally{await reader.cancel().catch(()=>{});}
 if(loaded!==spec.bytes)throw new Error('模型下载不完整，请重试。');progress('verifying',loaded);
 if(await digest(bytes.buffer)!==spec.sha256)throw new Error('模型校验失败，未启用不完整模型，请重试。');if(signal.aborted)throw signal.reason;
 try{await cache.put(spec.url,new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(spec.bytes)}}));}
 catch(error){if((error as Error).name==='QuotaExceededError')throw new Error('存储空间不足，无法保存识别模型。请释放约190 MB空间后重试。');throw error;}
 progress('loading',loaded);return bytes.buffer;
}
