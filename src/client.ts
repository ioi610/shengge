import {AppError, Clip, uid} from './domain';
import type {Request, Response} from './storage';
import type {Caption} from './background-captions';
export class Client {
 epoch=1;
 owner:any;
 clip?:Clip;
 private translations=new Map<string,{revision:number;sourceText:string;englishText:string}>();
 private captions=new Map<string,{revision:number;startMs:number;endMs:number;caption:Caption}>();
 private acquiring?:Promise<any>;private releasing?:Promise<void>;private disposal?:Promise<void>;private renewing?:Promise<any>;
 constructor(private transport:(m:Request)=>Promise<Response>,private close?:()=>Promise<void>){}
 async hello(){return this.call('HELLO');}
 envelope(type:string,payload:Record<string,any>={},clipId=this.clip?.id):Request{return {protocolVersion:1,requestId:uid(),type,dataEpoch:this.epoch,clipId,expectedRevision:this.clip?.revision,payload:{...payload,...(this.owner?{ownerId:this.owner.ownerId,generation:this.owner.generation}:{})}};}
 async send(m:Request){
  if(this.owner&&m.payload.ownerId===this.owner.ownerId&&m.payload.generation===this.owner.generation&&this.owner.expiresAt<=Date.now()&&!['RENEW_SESSION','RELEASE_SESSION','ACQUIRE_SESSION'].includes(m.type))await this.renew();
  const response=await this.transport(m);if(!response.ok)throw new AppError(response.error);if(this.epoch!==response.dataEpoch){this.captions.clear();this.translations.clear();}this.epoch=response.dataEpoch;const data=response.data;if(data?.segments)this.mergeCaptions(data);return data;
 }
 private mergeCaptions(clip:Clip){for(const s of clip.segments){const saved=this.captions.get(clip.id+':'+s.id);if(saved&&saved.revision===s.revision&&saved.startMs===s.startMs&&saved.endMs===s.endMs&&!s.text)Object.assign(s,saved.caption);const translation=this.translations.get(clip.id+':'+s.id);if(translation&&translation.revision===s.revision&&translation.sourceText===s.text)s.englishText=translation.englishText;}}
 async saveCaption(clipId:string,segmentId:string,caption:Caption){
  const clip=this.clip,s=clip?.segments.find(s=>s.id===segmentId);if(!clip||clip.id!==clipId||!s||s.text||!this.owner)return;
  const epoch=this.epoch,entry={revision:s.revision,startMs:s.startMs,endMs:s.endMs,caption};
  const saved=await this.send(this.envelope('SAVE_TRANSCRIPT',{segmentId,segmentRevision:s.revision,...caption},clipId));
  if(this.epoch!==epoch||!saved)return;
  entry.caption=saved;
  this.captions.set(clipId+':'+segmentId,entry);if(this.clip?.id===clipId)this.mergeCaptions(this.clip);
 }
 async saveTranslation(clipId:string,segmentId:string,sourceText:string,englishText:string){
  const s=this.clip?.id===clipId?this.clip.segments.find(s=>s.id===segmentId):undefined;if(!s||s.text!==sourceText||!this.owner)return;
  const epoch=this.epoch;const saved=await this.send(this.envelope('SAVE_TRANSLATION',{segmentId,segmentRevision:s.revision,sourceText,englishText},clipId));
  if(this.epoch!==epoch)return;const current=this.clip?.id===clipId?this.clip.segments.find(s=>s.id===segmentId):undefined;
  if(current&&current.revision===s.revision&&current.text===sourceText){this.translations.set(clipId+':'+segmentId,{revision:s.revision,sourceText,englishText:saved.englishText});current.englishText=saved.englishText;}
 }
 async call(type:string,payload:Record<string,any>={},clipId=this.clip?.id){const data=await this.send(this.envelope(type,payload,clipId));if(data?.segments)this.clip=data;return data;}
 async acquire(takeover=false){if(this.disposal)throw new AppError('OPERATION_CANCELLED');const pending=this.call('ACQUIRE_SESSION',{takeover});this.acquiring=pending;try{this.owner=await pending;return this.owner;}finally{if(this.acquiring===pending)this.acquiring=undefined;}}
 async renew(){
  if(this.renewing)return this.renewing;const owner=this.owner;if(!owner)return;
  const pending=(async()=>{const result=await this.send(this.envelope('RENEW_SESSION'));if(this.owner===owner)this.owner=result;return this.owner;})();
  this.renewing=pending;try{return await pending;}finally{if(this.renewing===pending)this.renewing=undefined;}
 }
 async release(){
  if(!this.owner){await this.releasing;return;}
  const request=this.envelope('RELEASE_SESSION');this.owner=undefined;
  const previous=this.releasing;const pending=(async()=>{await previous;try{await this.send(request);}catch{}})();this.releasing=pending;await pending;if(this.releasing===pending)this.releasing=undefined;
 }
 dispose(){return this.disposal??=(async()=>{try{await this.acquiring;}catch{}await this.release();await this.close?.();})();}
}
export function extensionClient(){return new Client(m=>new Promise((resolve,reject)=>{try{const timeout=setTimeout(()=>reject(new AppError('DISCONNECTED')),5000);const callback=(r:Response)=>{clearTimeout(timeout);const err=chrome.runtime.lastError;if(err||!r){console.warn('声格扩展连接',err?.message??'扩展未返回响应');reject(new AppError('DISCONNECTED'));}else resolve(r);};chrome.runtime.sendMessage(m,callback);}catch(e){console.warn('声格扩展接口',(e as Error).message);reject(new AppError('DISCONNECTED'));}}));}
