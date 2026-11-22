/** CPU speaker inference has its own worker. It must never share the page's
 * animation thread or queue behind the much slower text decoder. */
export class TurnHost {
 private worker?:Worker;private sequence=0;private idle?:ReturnType<typeof setTimeout>;
 private jobs=new Map<number,{owner:string;resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 constructor(private makeWorker:()=>Worker=()=>new Worker(chrome.runtime.getURL('turn-worker.js'),{type:'module'})){}
 private prepare(){
  clearTimeout(this.idle);if(this.worker)return;
  const worker=this.worker=this.makeWorker();
  worker.onmessage=({data})=>{if(this.worker!==worker)return;const job=this.jobs.get(data.id);if(!job)return;clearTimeout(job.timer);this.jobs.delete(data.id);data.error?job.reject(new Error(data.error)):job.resolve(data.result);this.scheduleIdle();};
  worker.onerror=()=>{if(this.worker===worker)this.dispose();};
 }
 private scheduleIdle(){clearTimeout(this.idle);if(!this.jobs.size)this.idle=setTimeout(()=>this.dispose(),180000);}
 request(action:string,payload:any,owner:string):Promise<any>{
  if(action==='turn-release'){for(const [id,job]of this.jobs)if(job.owner===owner){clearTimeout(job.timer);job.reject(new DOMException('已暂停','AbortError'));this.jobs.delete(id);}this.scheduleIdle();return Promise.resolve({});}
  if(action==='turn-prepare'){this.prepare();this.scheduleIdle();return Promise.resolve({});}
  if(action!=='turn-analyze'||typeof payload.samples!=='string'||payload.samples.length>860000||!Number.isFinite(payload.offsetMs)||payload.offsetMs<0||typeof payload.ended!=='boolean')return Promise.reject(new Error('说话人请求无效。'));
  if(this.jobs.size>=3||[...this.jobs.values()].some(j=>j.owner===owner))return Promise.reject(new Error('说话人检测请求过多。'));
  const bytes=Uint8Array.from(atob(payload.samples),c=>c.charCodeAt(0));if(bytes.length<64000||bytes.length>640000||bytes.length%4)return Promise.reject(new Error('音频长度无效。'));
  this.prepare();const id=++this.sequence;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.jobs.delete(id);reject(new Error('说话人检测超时。'));this.dispose();},10000);this.jobs.set(id,{owner,resolve,reject,timer});this.worker!.postMessage({id,samples:bytes.buffer,offsetMs:payload.offsetMs,ended:payload.ended},[bytes.buffer]);});
 }
 dispose(){clearTimeout(this.idle);this.worker?.terminate();this.worker=undefined;for(const job of this.jobs.values()){clearTimeout(job.timer);job.reject(new Error('说话人检测线程已结束。'));}this.jobs.clear();}
}
