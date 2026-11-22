import type {AsrTransport} from './local-asr-client';
import type {ModelProgress} from './recognition-model';
export function preparationMessage(p?:ModelProgress){
 if(p?.stage==='downloading')return `首次下载离线模型 · ${Math.floor(p.loaded/p.total*100)}%（约190 MB，仅需一次）`;
 if(p?.stage==='verifying')return '正在校验离线模型';
 if(p?.stage==='loading')return '正在载入离线模型';
 return '正在检查离线模型';
}
export async function prepareRecognition(transport:AsrTransport,signal:AbortSignal,progress:(message:string)=>void){
 signal.throwIfAborted();let health=await transport('prepare');
 while(!health?.streaming){
  signal.throwIfAborted();if(health?.state==='error')throw new Error(health.error??'离线识别未能启动，请重试。');progress(preparationMessage(health?.progress));
  await new Promise<void>((resolve,reject)=>{const done=()=>{signal.removeEventListener('abort',abort);resolve();};const timer=setTimeout(done,300);const abort=()=>{clearTimeout(timer);reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
  signal.throwIfAborted();health=await transport('health');
 }
 signal.throwIfAborted();
}
