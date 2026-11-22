import {AppError, Clip, Segment, Settings, complete, createClip, clipComplete, videoPracticeComplete, questionsFor, resolveSource, uid, validateSegments, validateSettings} from './domain';
import {isLocalMediaKey} from './local-media';
export type Owner={ownerId:string;binding:string;generation:number;expiresAt:number};
export type Root={schemaVersion:1;dataEpoch:number;clips:Record<string,Clip>;owners:Record<string,Owner>;receipts:Record<string,{fingerprint:string;response:unknown;binding:string;retired?:boolean}>;attempts:Record<string,unknown>};
export const fresh=():Root=>({schemaVersion:1,dataEpoch:1,clips:{},owners:{},receipts:{},attempts:{}});
export type Request={protocolVersion:1;requestId:string;type:string;dataEpoch?:number;clipId?:string;expectedRevision?:number;payload:Record<string,any>};
export type Authority={binding:string;controller:boolean;videoKey?:string;activeTabFrame?:string};
export type Response={ok:true;dataEpoch:number;data:any}|{ok:false;error:string};
const writes=new Set(['APPEND_SEGMENTS','SAVE_TRANSCRIPT','SAVE_TRANSLATION','SAVE_CLIP','REFINE_START','ACQUIRE_SESSION','RENEW_SESSION','RELEASE_SESSION','COMMIT_COMPLETION','SAVE_CHECKPOINT','START_QUESTIONS','REVEAL_ANSWER','RATE_ANSWER','UPDATE_PROGRESS','RESTART_SESSION','RESTART_DIFFICULT','DELETE_RECORD','CLEAR_DATA']);
const controls=new Set(['APPEND_SEGMENTS','SAVE_TRANSCRIPT','SAVE_TRANSLATION','SAVE_CLIP','REFINE_START','ACQUIRE_SESSION','RENEW_SESSION','RELEASE_SESSION','COMMIT_COMPLETION','SAVE_CHECKPOINT','START_QUESTIONS','REVEAL_ANSWER','RATE_ANSWER','UPDATE_PROGRESS','RESTART_SESSION','RESTART_DIFFICULT']);
function recordQuery(p:Record<string,any>){
 const filter=p.filter??'all';
 if(!['all','active','done','hard'].includes(filter)||p.videoKey!==undefined&&typeof p.videoKey!=='string'||p.cursor&&(!p.cursor.time||typeof p.cursor.time!=='string'||typeof p.cursor.id!=='string'))throw new AppError('INVALID_REQUEST');
 return {filter,limit:Math.min(50,Math.max(1,Math.floor(Number(p.limit)||50))),bucket:p.videoKey?`video:${p.videoKey}:${filter}`:filter};
}
function recordIndex(c:Clip,done=clipComplete(c)){
 const buckets=['all',done?'done':'active',...(c.questions.some(q=>q.rating==='stuck')?['hard']:[])];
 return {id:c.id,keys:buckets.flatMap(b=>[[b,c.updatedAt,c.id],[`video:${c.videoKey}:${b}`,c.updatedAt,c.id]])};
}
export function execute(root:Root,m:Request,auth:Authority,now=Date.now(),demo=false,localMedia=false):any{
 if(root.schemaVersion!==1)throw new AppError('PROTOCOL_MISMATCH');
 if(!m||m.protocolVersion!==1)throw new AppError('PROTOCOL_MISMATCH');
 if(typeof m.type!=='string'||typeof m.requestId!=='string'||m.requestId.length>100||!m.payload||JSON.stringify(m).length>250000)throw new AppError('INVALID_REQUEST');
 if(m.type==='HELLO')return {protocolVersion:1,dataEpoch:root.dataEpoch,version:'0.4.0'};
 if(m.type==='RESOLVE_SOURCE')return resolveSource(m.payload.url);
 if(m.dataEpoch!==root.dataEpoch)throw new AppError('STALE_EPOCH');
 if(controls.has(m.type)&&!auth.controller)throw new AppError('INVALID_REQUEST');
 const fingerprint=JSON.stringify(m);
 const receipt=root.receipts[m.requestId];
 if(receipt){if(receipt.binding!==auth.binding)throw new AppError('INVALID_REQUEST');if(receipt.retired)throw new AppError('STALE_EPOCH');if(receipt.fingerprint!==fingerprint)throw new AppError('INVALID_REQUEST');return receipt.response;}
 let result:any;
 const p=m.payload;
 const clip=m.clipId?root.clips[m.clipId]:undefined;
 if(controls.has(m.type)&&m.type!=='SAVE_CLIP'&&m.type!=='ACQUIRE_SESSION'&&(!clip||auth.videoKey!==clip.videoKey))throw new AppError('STALE_BINDING');
 function checkOwner(renew=false){if(!clip)throw new AppError('STALE_EPOCH');const o=root.owners[clip.videoKey];if(!o||o.binding!==auth.binding||o.ownerId!==p.ownerId||o.generation!==p.generation||o.expiresAt===0||!renew&&o.expiresAt<=now)throw new AppError('STALE_BINDING');return o;}
 function checkRevision(){if(!clip)throw new AppError('STALE_EPOCH');if(clip.revision!==m.expectedRevision)throw new AppError('REVISION_CONFLICT');}
 function bump(){clip!.revision++;clip!.updatedAt=new Date(now).toISOString();result=structuredClone(clip);}
 switch(m.type){
  case 'LIST_RECORDS':{
   const {filter,limit}=recordQuery(p);const all=Object.values(root.clips).filter(c=>!p.videoKey||c.videoKey===p.videoKey).filter(c=>filter==='done'?clipComplete(c):filter==='active'?!clipComplete(c):filter==='hard'?c.questions.some(q=>q.rating==='stuck'):true).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.id.localeCompare(a.id));
   const remaining=p.cursor?all.filter(c=>c.updatedAt<p.cursor.time||c.updatedAt===p.cursor.time&&c.id<p.cursor.id):all;
   const list=remaining.slice(0,limit);const last=list.at(-1);result={clips:list,hasMore:remaining.length>list.length,nextCursor:last?{time:last.updatedAt,id:last.id}:null,total:all.length};break;
  }
  case 'GET_RECORD':if(!clip)throw new AppError('STALE_EPOCH');result=structuredClone(clip);break;
  case 'SAVE_CLIP':{
   if(auth.videoKey!==p.videoKey)throw new AppError('STALE_BINDING');
   if(localMedia){if(!isLocalMediaKey(p.videoKey)||p.url!==p.videoKey)throw new AppError('INVALID_URL');}
   else if(!demo&&resolveSource(p.url).videoKey!==p.videoKey)throw new AppError('INVALID_URL');
   if(typeof p.name!=='string'||typeof p.title!=='string'||p.title.length>500)throw new AppError('INVALID_REQUEST');
   const segments=p.segments as Segment[];validateSegments(segments,p.durationMs);
   segments.sort((a,b)=>a.startMs-b.startMs);
   if(clip){
    checkOwner();checkRevision();if(clip.videoKey!==p.videoKey)throw new AppError('STALE_BINDING');
    const old=clip.segments,currentId=old[clip.current]?.id;const changed=new Set<string>();
    for(const s of segments){
     const prior=old.find(x=>x.id===s.id);s.revision=prior?.revision??1;
     // A previously prepared append request must not erase a caption that
     // completed while it was in flight, or reset that sentence's repetitions.
     if(prior?.source==='turn'&&s.source==='turn'&&!s.text&&prior.startMs===s.startMs&&prior.endMs===s.endMs){s.text=prior.text;s.confidence=prior.confidence;s.language=prior.language;s.englishText=prior.englishText;}
     if(prior?.text===s.text&&prior?.startMs===s.startMs&&prior?.endMs===s.endMs&&prior?.englishText&&!s.englishText)s.englishText=prior.englishText;
     if(!prior||prior.startMs!==s.startMs||prior.endMs!==s.endMs||prior.text!==s.text||prior.source!==s.source){
      if(prior)s.revision=prior.revision+1;
      changed.add(s.id);clip.progress[s.id]={count:0,target:clip.settings.targetDefault};
     }
    }
    clip.progress=Object.fromEntries(segments.map(s=>[s.id,clip.progress[s.id]]));
    clip.questions=clip.questions.filter(q=>!changed.has(q.cueId)&&!changed.has(q.targetId)&&segments.some((s,i)=>s.id===q.cueId&&segments[i+1]?.id===q.targetId));
    clip.practiceIds=clip.practiceIds?.filter(id=>segments.some(s=>s.id===id));if(!clip.practiceIds?.length)delete clip.practiceIds;
    delete clip.sourceExhausted;clip.segments=segments;clip.name=p.name.trim().slice(0,80)||'未命名片段';
    const current=segments.findIndex(s=>s.id===currentId);clip.current=current>=0?current:Math.min(clip.current,segments.length-1);
    clip.durationMs=p.durationMs;clip.subtitleFingerprint=p.subtitleFingerprint;bump();
   }
   else {const c=createClip({videoKey:p.videoKey,url:p.url,title:p.title,durationMs:p.durationMs,segments},p.name,demo);c.subtitleFingerprint=p.subtitleFingerprint;root.clips[c.id]=c;result=structuredClone(c);}break;
  }
  case 'ACQUIRE_SESSION':{
   if(!clip||auth.videoKey!==clip.videoKey)throw new AppError('STALE_BINDING');const old=root.owners[clip.videoKey];
   // A redirect or reload replaces the active desktop document in this tab.
   // The new owner gets a fresh generation so delayed writes cannot take effect.
   const replaced=auth.activeTabFrame&&old?.binding.startsWith(auth.activeTabFrame);
   if(old&&old.expiresAt>now&&old.binding!==auth.binding&&!replaced&&!p.takeover)throw new AppError('SESSION_OWNED');const same=old&&old.binding===auth.binding&&old.expiresAt>now;
   root.owners[clip.videoKey]={ownerId:same?old.ownerId:uid(),binding:auth.binding,generation:same?old.generation:(old?.generation??0)+1,expiresAt:now+15000};result=structuredClone(root.owners[clip.videoKey]);break;
  }
  // A delayed timer may renew its exact, unreleased owner. Takeover changes the
  // generation/owner ID, so an old page can never revive someone else's lease.
  case 'RENEW_SESSION':{const o=checkOwner(true);o.expiresAt=now+15000;result=structuredClone(o);break;}
  case 'RELEASE_SESSION':{const o=checkOwner();o.expiresAt=0;result=true;break;}
  case 'COMMIT_COMPLETION':{
   checkOwner();
   const attemptKey=`${clip!.id}:${p.attemptId}`;if(typeof p.attemptId!=='string')throw new AppError('INVALID_REQUEST');
   if(root.attempts[attemptKey]){result=root.attempts[attemptKey];break;}
   checkRevision();const s=clip!.segments.find(s=>s.id===p.segmentId);if(!s||s.revision!==p.segmentRevision)throw new AppError('REVISION_CONFLICT');const progress=clip!.progress[s.id];if(complete(progress))throw new AppError('INVALID_REQUEST');progress.count++;if(progress.count>=progress.target){progress.reason='target';progress.skipped=false;}bump();root.attempts[attemptKey]=structuredClone(result);break;
  }
  case 'APPEND_SEGMENTS':{
   checkOwner();checkRevision();
   if(!Array.isArray(p.segments)||!p.segments.length||p.segments.length>50)throw new AppError('INVALID_REQUEST');
   const appended=(p.segments as Segment[]).sort((a,b)=>a.startMs-b.startMs),prior=clip!.segments.at(-1)!;
   if(appended.some(s=>s.source!=='turn'||s.startMs<prior.endMs||s.revision!==1))throw new AppError('INVALID_INTERVAL');
   const combined=[...clip!.segments,...appended];validateSegments(combined,clip!.durationMs);
   delete clip!.sourceExhausted;clip!.segments=combined;for(const s of appended)clip!.progress[s.id]={count:0,target:clip!.settings.targetDefault};bump();break;
  }
  case 'SAVE_TRANSCRIPT':{
   checkOwner();const s=clip!.segments.find(s=>s.id===p.segmentId);
   if(!s||s.source!=='turn'||s.revision!==p.segmentRevision)throw new AppError('REVISION_CONFLICT');
   if(typeof p.text!=='string'||!p.text.trim()||p.text.length>2000||!Number.isFinite(p.confidence)||p.confidence<.6||p.confidence>1||p.language!==undefined&&(typeof p.language!=='string'||!/^[a-z]{2,20}$/.test(p.language)))throw new AppError('INVALID_REQUEST');
   // Metadata only: do not invalidate an in-flight completion/seek, or reset
   // counters/questions. Ownership and the immutable interval revision fence it.
   if(!s.text){s.text=p.text;s.confidence=p.confidence;s.language=p.language;}
   result={text:s.text,confidence:s.confidence,language:s.language};break;
  }
  case 'SAVE_TRANSLATION':{
   checkOwner();const s=clip!.segments.find(s=>s.id===p.segmentId);
   if(!s||!s.text||typeof p.sourceText!=='string'||s.revision!==p.segmentRevision||s.text!==p.sourceText)throw new AppError('REVISION_CONFLICT');
   if(typeof p.englishText!=='string'||!p.englishText.trim()||p.englishText.length>4000)throw new AppError('INVALID_REQUEST');
   s.englishText=p.englishText;result={englishText:s.englishText};break;
  }
  case 'REFINE_START':{
   checkOwner();checkRevision();const s=clip!.segments.find(s=>s.id===p.segmentId);
   const prior=s?clip!.segments[clip!.segments.indexOf(s)-1]:undefined;
   const minimum=(p.onsetVersion===2||p.onsetVersion===3)?Math.max(0,s?s.startMs-1600:0,prior?.endMs??0):s?.startMs??0;
   if(!s||!['turn','vad'].includes(s.source)||s.revision!==p.segmentRevision||!Number.isInteger(p.startMs)||p.startMs<minimum||p.startMs>=s.endMs-100)throw new AppError('INVALID_INTERVAL');
   // Bounded acoustic re-calibration may restore a clipped first word. Keep history.
   // Keep the old boundary for recovery and invalidate outstanding playback attempts.
   s.previousStartMs??=s.startMs;s.startMs=p.startMs;s.revision++;s.onsetVerified=true;
   if(p.onsetVersion===2||p.onsetVersion===3){
    const oldText=s.text,oldLanguage=s.language;
    s.onsetVersion=p.onsetVersion;
    if(typeof p.text==='string'&&p.text.length<=20000)s.text=p.text;
    if(Number.isFinite(p.confidence)&&p.confidence>=0&&p.confidence<=1)s.confidence=p.confidence;
    if(typeof p.language==='string'&&/^[a-z]{2,20}$/.test(p.language))s.language=p.language;
    if(s.text!==oldText||s.language!==oldLanguage)delete s.englishText;
   }
   clip!.questions=clip!.questions.filter(q=>q.cueId!==s.id&&q.targetId!==s.id);bump();break;
  }
  case 'SAVE_CHECKPOINT':{
   checkOwner();checkRevision();if(p.sourceExhausted===true)clip!.sourceExhausted=true;if(p.current!==undefined){if(!Number.isInteger(p.current)||p.current<0||p.current>=clip!.segments.length)throw new AppError('INVALID_REQUEST');clip!.current=p.current;}
   if(p.practiceIds!==undefined){if(p.practiceIds!==null&&(!Array.isArray(p.practiceIds)||!p.practiceIds.length||p.practiceIds.some((id:unknown)=>!clip!.segments.some(s=>s.id===id))))throw new AppError('INVALID_REQUEST');clip!.practiceIds=p.practiceIds??undefined;}
   if(p.mode!==undefined){if(!['listen','shadow','cue','done','review'].includes(p.mode))throw new AppError('INVALID_REQUEST');clip!.mode=p.mode;}
   if(p.settings){validateSettings(p.settings);const targetChanged=clip!.settings.targetDefault!==p.settings.targetDefault;clip!.settings=p.settings;if(targetChanged)for(const progress of Object.values(clip!.progress)){progress.target=p.settings.targetDefault;if(progress.count>=progress.target){progress.reason='target';progress.skipped=false;}else if(progress.reason==='target')delete progress.reason;}}
   bump();break;
  }
  case 'START_QUESTIONS':checkOwner();checkRevision();clip!.questions=questionsFor(clip!).map(q=>p.preserve?clip!.questions.find(old=>old.cueId===q.cueId&&old.targetId===q.targetId)??q:q);clip!.mode='cue';bump();break;
  case 'REVEAL_ANSWER':case 'RATE_ANSWER':{
   checkOwner();checkRevision();const q=clip!.questions.find(q=>q.id===p.questionId);if(!q)throw new AppError('INVALID_REQUEST');if(m.type==='REVEAL_ANSWER'){q.revealed=true;}else{if(!['can','stuck','skip'].includes(p.rating)||p.rating!=='skip'&&!q.revealed)throw new AppError('INVALID_REQUEST');q.rating=p.rating;if(clip!.questions.every(item=>item.rating))clip!.mode='done';}bump();break;
  }
  case 'RESTART_DIFFICULT':{
   checkOwner();checkRevision();const hard=new Set(clip!.questions.filter(q=>q.rating==='stuck').map(q=>q.targetId));
   const targets=clip!.segments.filter(s=>hard.has(s.id));if(!targets.length)throw new AppError('INVALID_REQUEST');
   for(const s of targets){const progress=clip!.progress[s.id];progress.count=0;delete progress.reason;progress.skipped=false;}
   clip!.practiceIds=targets.map(s=>s.id);clip!.current=clip!.segments.findIndex(s=>s.id===targets[0].id);clip!.mode='listen';bump();break;
  }
  case 'RESTART_SESSION':{checkOwner();checkRevision();(clip!.history??=[]).push({endedAt:new Date(now).toISOString(),progress:structuredClone(clip!.progress),questions:structuredClone(clip!.questions)});for(const p of Object.values(clip!.progress)){p.count=0;p.target=clip!.settings.targetDefault;delete p.reason;delete p.skipped;}clip!.questions=[];clip!.current=0;clip!.mode='listen';delete clip!.practiceIds;bump();break;}
  case 'UPDATE_PROGRESS':{
   checkOwner();checkRevision();const progress=clip!.progress[p.segmentId];if(!progress)throw new AppError('INVALID_REQUEST');
   if(p.action==='early'){progress.reason='early';progress.skipped=false;}
   else if(p.action==='skip'){progress.skipped=true;delete progress.reason;}
   else if(p.action==='extra'){progress.target=Math.min(100,progress.target+5);if(progress.count<progress.target)delete progress.reason;progress.skipped=false;}
   else if(p.action==='reset'){progress.count=0;delete progress.reason;progress.skipped=false;}
   else throw new AppError('INVALID_REQUEST');bump();break;
  }
  case 'DELETE_RECORD':{
   if(!clip)throw new AppError('STALE_EPOCH');const o=root.owners[clip.videoKey];if(o){o.generation++;o.expiresAt=0;}delete root.clips[clip.id];for(const key of Object.keys(root.attempts))if(key.startsWith(clip.id+':'))delete root.attempts[key];for(const [key,r]of Object.entries(root.receipts)){if(r.retired)continue;const request=JSON.parse(r.fingerprint);if(request.type==='SAVE_CLIP'&&!request.clipId&&(r.response as Clip)?.id===clip.id)root.receipts[key]={...r,fingerprint:'',response:null,retired:true};else if(request.clipId===clip.id)delete root.receipts[key];}result=true;break;
  }
  case 'CLEAR_DATA':{if(p.confirm!==true)throw new AppError('INVALID_REQUEST');root.clips={};root.owners={};root.receipts={};root.attempts={};root.dataEpoch++;result={dataEpoch:root.dataEpoch};break;}
  default:throw new AppError('INVALID_REQUEST');
 }
 if(writes.has(m.type)&&m.type!=='RENEW_SESSION')root.receipts[m.requestId]={fingerprint,response:structuredClone(result),binding:auth.binding};
 return result;
}
export class Repository {
 private db:Promise<IDBDatabase>;
 constructor(name:string,private demo=false,private localMedia=false,private videoHistory=false){this.db=new Promise((resolve,reject)=>{
  let blocked=false;const request=indexedDB.open(name,videoHistory?4:3);request.onblocked=()=>{blocked=true;reject(new AppError('UPGRADE_BLOCKED'));};
  request.onupgradeneeded=event=>{
   const db=request.result,tx=request.transaction!;
   const records=event.oldVersion<3?db.createObjectStore('recordIndex',{keyPath:'id'}):tx.objectStore('recordIndex');
   if(event.oldVersion<3)records.createIndex('recent','keys',{multiEntry:true});
   const videos=videoHistory?db.createObjectStore('videoRecords',{keyPath:'videoKey'}):undefined;
   videos?.createIndex('recent','keys',{multiEntry:true});
   function migrate(c:Clip){
    const entry=recordIndex(c);
    if(event.oldVersion<3)records.put(entry);
    videos?.put({...recordIndex(c,videoPracticeComplete(c)),videoKey:c.videoKey,updatedAt:c.updatedAt});
   }
   if(event.oldVersion>=2){
    const scan=tx.objectStore('clips').index('updatedAt').openCursor();
    scan.onsuccess=()=>{const cursor=scan.result;if(cursor){migrate(cursor.value);cursor.continue();}};return;
   }
   if(!db.objectStoreNames.contains('state'))db.createObjectStore('state');
   const clips=db.createObjectStore('clips');clips.createIndex('videoKey','videoKey');clips.createIndex('updatedAt','updatedAt');
   const receipts=db.createObjectStore('receipts');receipts.createIndex('clipId','clipId');
   const attempts=db.createObjectStore('attempts');attempts.createIndex('clipId','clipId');
   db.createObjectStore('owners');const logs=db.createObjectStore('diagnostics',{keyPath:'id',autoIncrement:true});logs.createIndex('at','at');
   const read=tx.objectStore('state').get('root');read.onsuccess=()=>{const old:Root=read.result??fresh();if(old.schemaVersion!==1){tx.abort();return;}
    for(const c of Object.values(old.clips).sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt)||a.id.localeCompare(b.id))){clips.put(c,c.id);migrate(c);}
    for(const [id,o]of Object.entries(old.owners))tx.objectStore('owners').put(o,id);
    for(const [id,r]of Object.entries(old.receipts)){const m=r.retired?{}:JSON.parse(r.fingerprint);receipts.put({...r,clipId:m.clipId??(r.response as any)?.id},id);}
    for(const [id,value]of Object.entries(old.attempts))attempts.put({clipId:id.split(':')[0],value},id);
    tx.objectStore('state').put({...fresh(),dataEpoch:old.dataEpoch},'root');
   };
  };
  request.onsuccess=()=>{if(blocked){request.result.close();return;}request.result.onversionchange=()=>request.result.close();resolve(request.result);};request.onerror=()=>reject(request.error);
 });}
 async close(){(await this.db).close();}
 async request(m:Request,auth:Authority):Promise<Response>{try{
  if(!m||typeof m.type!=='string'||!m.payload||JSON.stringify(m).length>250000)return {ok:false,error:'INVALID_REQUEST'};
  const db=await this.db;
  return await new Promise<Response>((resolve,reject)=>{
   const write=writes.has(m.type);const names=['state','clips','owners','receipts','attempts','diagnostics','recordIndex'];if(this.videoHistory)names.push('videoRecords');const tx=db.transaction(names,write?'readwrite':'readonly');
   let deletedVideoKey:string|undefined;let answer:Response;let root=fresh();let pending=0;let executed=false;
   const read=(store:string,key:IDBValidKey,apply:(v:any)=>void)=>{pending++;const r=tx.objectStore(store).get(key);r.onsuccess=()=>{apply(r.result);pending--;run();};};
   const cascade=(store:string,id:string)=>{const q=tx.objectStore(store).index('clipId').openCursor(IDBKeyRange.only(id));q.onsuccess=()=>{const c=q.result;if(c){const request=store==='receipts'?JSON.parse(c.value.fingerprint):null;if(request?.type==='SAVE_CLIP'&&!request.clipId)c.update({...c.value,fingerprint:'',response:null,retired:true,clipId:undefined});else c.delete();c.continue();}};};
   const run=()=>{if(pending||executed)return;executed=true;try{
    let data:any;
    if(m.type==='GET_DIAGNOSTICS'){if(m.protocolVersion!==1||m.dataEpoch!==root.dataEpoch)throw new AppError('STALE_EPOCH');const q=tx.objectStore('diagnostics').getAll();q.onsuccess=()=>{answer={ok:true,dataEpoch:root.dataEpoch,data:q.result};};return;}
    data=execute(root,m,auth,Date.now(),this.demo,this.localMedia);answer={ok:true,dataEpoch:root.dataEpoch,data};
    if(m.type==='LIST_RECORDS'){
     // Read only this page's aggregates. Counts and cursors use small index entries,
     // including both filter and video key, in the same consistent transaction.
     const {bucket,limit}=recordQuery(m.payload);const index=tx.objectStore(this.videoHistory&&!m.payload.videoKey?'videoRecords':'recordIndex').index('recent');
     const range=IDBKeyRange.bound([bucket],[bucket,[]]);
     const cursor=m.payload.cursor;
     const pageRange=cursor?IDBKeyRange.bound([bucket],[bucket,cursor.time,cursor.id],false,true):range;
     const count=index.count(range);const clips:Clip[]=[];let total=0,hasMore=false;
     const finish=()=>{const last=clips.at(-1);answer={ok:true,dataEpoch:root.dataEpoch,data:{clips,total,hasMore,nextCursor:last?{time:last.updatedAt,id:last.id}:null}};};
     count.onsuccess=()=>{total=count.result;finish();};
     const scan=index.openKeyCursor(pageRange,'prev');scan.onsuccess=()=>{const c=scan.result;if(!c){finish();return;}if(clips.length===limit){hasMore=true;finish();return;}
      const get=tx.objectStore('clips').get((c.key as string[])[2]);get.onsuccess=()=>{if(get.result)clips.push(get.result);c.continue();};
     };return;
    }
    if(!write)return;
    if(m.type==='CLEAR_DATA'){for(const name of names.filter(name=>name!=='state'))tx.objectStore(name).clear();}
    if(m.type==='DELETE_RECORD'&&m.clipId){
     const remove=(id:string)=>{tx.objectStore('clips').delete(id);tx.objectStore('recordIndex').delete(id);cascade('attempts',id);cascade('receipts',id);};
     if(this.videoHistory&&deletedVideoKey){
      tx.objectStore('videoRecords').delete(deletedVideoKey);
      const keys=tx.objectStore('clips').index('videoKey').getAllKeys(deletedVideoKey);
      keys.onsuccess=()=>keys.result.forEach(id=>remove(String(id)));
     }else remove(m.clipId);
    }
    if(['APPEND_SEGMENTS','SAVE_TRANSCRIPT','SAVE_TRANSLATION','SAVE_CLIP','REFINE_START','COMMIT_COMPLETION','SAVE_CHECKPOINT','START_QUESTIONS','REVEAL_ANSWER','RATE_ANSWER','UPDATE_PROGRESS','RESTART_SESSION','RESTART_DIFFICULT'].includes(m.type))for(const c of Object.values(root.clips)){
     const entry=recordIndex(c);tx.objectStore('clips').put(c,c.id);tx.objectStore('recordIndex').put(entry);
     if(this.videoHistory){
      const videos=tx.objectStore('videoRecords'),prior=videos.get(c.videoKey);
      prior.onsuccess=()=>{const old=prior.result;if(!old||old.updatedAt<c.updatedAt||old.updatedAt===c.updatedAt&&old.id<=c.id)videos.put({...recordIndex(c,videoPracticeComplete(c)),videoKey:c.videoKey,updatedAt:c.updatedAt});};
     }
    }
    for(const [id,o]of Object.entries(root.owners))tx.objectStore('owners').put(o,id);
    const receipt=root.receipts[m.requestId];if(receipt)tx.objectStore('receipts').put({...receipt,clipId:m.clipId??data?.id},m.requestId);
    if(m.type==='COMMIT_COMPLETION'){const key=`${m.clipId}:${m.payload.attemptId}`;if(root.attempts[key])tx.objectStore('attempts').put({clipId:m.clipId,value:root.attempts[key]},key);}
    if(m.type==='CLEAR_DATA')tx.objectStore('state').put({...fresh(),dataEpoch:root.dataEpoch},'root');
    const logs=tx.objectStore('diagnostics');logs.add({at:Date.now(),command:m.type,code:'OK'});const q=logs.index('at').openCursor(null,'prev');let n=0;q.onsuccess=()=>{const cursor=q.result;if(cursor){if(++n>500||cursor.value.at<Date.now()-7*86400000)cursor.delete();cursor.continue();}};
   }catch(e){answer={ok:false,error:(e as Error).name==='QuotaExceededError'?'QUOTA_EXCEEDED':(e as AppError).code??'STORAGE_FAILED'};tx.abort();}};
   // Queue all reads before permitting execution, including the dependent owner lookup.
   pending++;
   read('state','root',v=>{if(v){root.schemaVersion=v.schemaVersion;root.dataEpoch=v.dataEpoch;}});
   read('receipts',m.requestId,v=>{if(v)root.receipts[m.requestId]=v;});
   if(m.type!=='LIST_RECORDS'&&m.clipId)read('clips',m.clipId,c=>{if(c){if(m.type==='DELETE_RECORD')deletedVideoKey=c.videoKey;root.clips[c.id]=c;read('owners',c.videoKey,o=>{if(o)root.owners[c.videoKey]=o;});}});
   if(m.type==='COMMIT_COMPLETION')read('attempts',`${m.clipId}:${m.payload.attemptId}`,v=>{if(v)root.attempts[`${m.clipId}:${m.payload.attemptId}`]=v.value;});
   pending--;run();
   tx.oncomplete=()=>resolve(answer!);tx.onabort=()=>answer?.ok===false?resolve(answer):reject(tx.error);// Let abort settle the transaction so a quota/validation error is not replaced by AbortError.
   tx.onerror=()=>{};
  });
 }catch(e){return {ok:false,error:(e as AppError)?.code==='UPGRADE_BLOCKED'?'UPGRADE_BLOCKED':(e as Error)?.name==='VersionError'?'PROTOCOL_MISMATCH':(e as Error)?.name==='QuotaExceededError'?'QUOTA_EXCEEDED':'STORAGE_FAILED'};}}
}
