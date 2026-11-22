import {validCheckpoint} from './timeline-plan';
/** Extension-origin checkpoints contain timings/text only; no audio or signed URLs. */
export class AnalysisCache {
 private db?:Promise<IDBDatabase>;
 constructor(private name='shengge-analysis-v1'){}
 private open(){return this.db??=new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(this.name,1);request.onupgradeneeded=()=>request.result.createObjectStore('checkpoints',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
 async request(action:string,payload:any,videoKey:string){
  if(!/^(?:youtube:|bilibili:)/.test(videoKey)||typeof payload.key!=='string'||!/^\d+:\d+:\d+:[0-9a-f]{64}$/.test(payload.key))throw new Error('分析缓存请求无效。');
  const db=await this.open(),id=`${videoKey}|${payload.key}`;
  if(action==='analysis-load')return new Promise<any>((resolve,reject)=>{const request=db.transaction('checkpoints').objectStore('checkpoints').get(id);request.onsuccess=()=>resolve(request.result?.checkpoint??null);request.onerror=()=>reject(request.error);});
  if(action!=='analysis-save'||!validCheckpoint(payload.checkpoint,payload.checkpoint?.durationMs,payload.checkpoint?.originMs)||JSON.stringify(payload.checkpoint).length>4_000_000)throw new Error('分析进度无效。');
  return new Promise<void>((resolve,reject)=>{const tx=db.transaction('checkpoints','readwrite'),store=tx.objectStore('checkpoints');store.put({id,checkpoint:payload.checkpoint,at:Date.now()});
   const request=store.getAll();request.onsuccess=()=>{const rows=request.result.sort((a,b)=>b.at-a.at);for(const row of rows.slice(24))store.delete(row.id);};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('分析进度保存失败。'));});
 }
 async close(){(await this.db)?.close();this.db=undefined;}
}
