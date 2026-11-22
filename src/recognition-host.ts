import type {ModelProgress} from './recognition-model';
import {RECOGNITION_MODEL} from './recognition-model';
type Job={owner:string;id:string;state:'running'|'done'|'error';result?:unknown;error?:string;audio?:ArrayBuffer;durationMs:number;language:string;cancelled?:boolean;at:number};
/** Lives in an extension-owned offscreen document, not the suspendable service worker. */
export class RecognitionHost {
 constructor(private makeWorker:()=>Worker=()=>new Worker(chrome.runtime.getURL('recognition-worker.js'),{type:'module'})){}
 private worker?:Worker;private cancelFlag?:Int32Array;private active?:Job;private queue:Job[]=[];private jobs=new Map<string,Job>();private idleTimer?:ReturnType<typeof setTimeout>;private cancelTimer?:ReturnType<typeof setTimeout>;
 private state:'idle'|'loading'|'ready'|'error'='idle';private error='';private progress?:ModelProgress;
 private prepare(){
  if(this.state==='loading'||this.state==='ready'){this.idle();return;}clearTimeout(this.idleTimer);this.worker?.terminate();this.cancelFlag=undefined;this.state='loading';this.error='';this.progress=undefined;
  const worker=this.worker=this.makeWorker();
  worker.onmessage=({data})=>{
   if(this.worker!==worker)return;
   if(data.type==='progress')this.progress=data.progress;
   if(data.type==='memory')this.cancelFlag=new Int32Array(data.buffer,data.pointer,1);
   if(data.type==='ready'){this.state='ready';this.progress={stage:'ready',loaded:RECOGNITION_MODEL.bytes,total:RECOGNITION_MODEL.bytes};this.pump();this.idle();}
   if(data.type==='error')this.fail(data.error);
   if(data.type==='result'){const job=this.jobs.get(data.id);if(job&&!job.cancelled){job.state=data.error?'error':'done';job.result=data.result;job.error=data.error?'浏览器识别失败，请重试。':undefined;job.at=Date.now();}if(this.active?.id===data.id){clearTimeout(this.cancelTimer);this.active=undefined;}this.pump();this.idle();}
  };
  worker.onerror=()=>{if(this.worker===worker)this.fail('浏览器识别线程退出，请重试；内存不足时请关闭其他大型页面。');};
  worker.postMessage({type:'prepare'});
 }
 private fail(error:string){clearTimeout(this.cancelTimer);this.error=error;this.state='error';for(const job of this.jobs.values())if(job.state==='running'){job.state='error';job.error=error;}this.queue=[];this.active=undefined;this.worker?.terminate();this.worker=undefined;this.cancelFlag=undefined;}
 private idle(){clearTimeout(this.idleTimer);if(this.state==='ready'&&!this.active&&!this.queue.length)this.idleTimer=setTimeout(()=>{this.worker?.terminate();this.worker=undefined;this.cancelFlag=undefined;this.state='idle';},180000);}
 private pump(){
  if(this.active||this.state!=='ready'||!this.worker||!this.cancelFlag)return;
  const job=this.queue.shift();if(!job)return;this.active=job;Atomics.store(this.cancelFlag,0,0);const audio=job.audio!;job.audio=undefined;
  this.worker.postMessage({type:'run',id:job.id,audio,durationMs:job.durationMs,language:job.language},[audio]);
 }
 request(action:string,payload:any,owner:string){
  for(const [id,job]of this.jobs)if(job.state!=='running'&&Date.now()-job.at>600000)this.jobs.delete(id);
  if(action==='prepare'){
   // A refreshed document cannot keep polling its old job. Release only jobs
   // belonging to the same tab's previous document, never another video tab.
   const tab=owner.match(/^(\d+):/)?.[1];
   if(tab)for(const job of [...this.jobs.values()])if(job.owner!==owner&&job.owner.startsWith(tab+':'))this.request('cancel',{id:job.id},job.owner);
   this.prepare();return this.health();
  }
  if(action==='health')return this.health();
  if(action==='submit'){
   if(this.state!=='ready')throw new Error('识别模型尚未就绪，请先完成模型准备。');
   if(this.queue.length||this.active&&!this.active.cancelled)throw new Error('另一个视频正在识别，请先暂停后重试。');
   if(typeof payload.audio!=='string'||payload.audio.length>3_000_000||!Number.isInteger(payload.durationMs)||payload.durationMs<1000||payload.durationMs>60000||payload.language!==undefined&&!/^[a-z]{2,20}$/.test(payload.language))throw new Error('音频请求无效。');
   const bytes=Uint8Array.from(atob(payload.audio),c=>c.charCodeAt(0));const id=crypto.randomUUID();
   const job:Job={id,owner,state:'running',audio:bytes.buffer,durationMs:payload.durationMs,language:payload.language??'auto',at:Date.now()};this.jobs.set(id,job);this.queue.push(job);clearTimeout(this.idleTimer);this.pump();return {id};
  }
  const job=this.jobs.get(payload.id);if(!job||job.owner!==owner)throw new Error('识别任务已结束，请重新开始。');
  if(action==='status')return {state:job.state,result:job.result,error:job.error};
  if(action==='cancel'){job.cancelled=true;this.jobs.delete(job.id);this.queue=this.queue.filter(j=>j!==job);if(this.active===job&&this.cancelFlag){
    Atomics.store(this.cancelFlag,0,1);clearTimeout(this.cancelTimer);
    // A hung GPU dispatch may never reach the cooperative cancellation check.
    // Bound its cleanup, retain queued work, and ignore the obsolete worker.
    const worker=this.worker;this.cancelTimer=setTimeout(()=>{
     if(this.active!==job||this.worker!==worker)return;
     this.worker?.terminate();this.worker=undefined;this.cancelFlag=undefined;this.active=undefined;this.state='idle';
     if(this.queue.length)this.prepare();
    },3000);
   }this.idle();return {ok:true};}
  throw new Error('识别请求无效。');
 }
 private health(){return {streaming:this.state==='ready',state:this.state,model:'Whisper small · 扩展内离线识别',progress:this.progress,error:this.error||undefined};}
 dispose(){clearTimeout(this.idleTimer);clearTimeout(this.cancelTimer);this.worker?.terminate();this.worker=undefined;this.cancelFlag=undefined;this.jobs.clear();this.queue=[];this.active=undefined;this.state='idle';}
}
