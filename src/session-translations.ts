import type {Segment} from './domain';
import {languageCode} from './source-language';

export type TranslationSession={
 clipId:string;epoch:number;generation:number;language?:string;enabled:boolean;segments:Segment[];
};
type Heard=Pick<Segment,'revision'|'startMs'|'endMs'>;
type Task={key:string;serial:number};
const sameRange=(a:Heard,b:Heard)=>a.revision===b.revision&&a.startMs===b.startMs&&a.endMs===b.endMs;
const keyOf=(s:Segment)=>JSON.stringify([s.id,s.revision,s.startMs,s.endMs,s.text,s.language]);

/** Only this session's observed lines can become background work. The existing
 * translator owns model/cache deduplication; this queue never enables a model,
 * changes playback, or scans unplayed subtitle rows for translation. */
export class SessionTranslations {
 private scope='';private policy='';private serial=0;
 private heard=new Map<string,Heard>();private attempted=new Set<string>();
 private foreground?:Task;private background?:Task;
 private currentKey='';private foregroundAt=0;private nextBackgroundAt=0;
 constructor(private read:()=>TranslationSession|undefined,
  private translate:(segment:Segment)=>Promise<string|undefined>,
  private save:(clipId:string,segment:Segment,english:string)=>Promise<unknown>,
  private now=()=>performance.now()){}

 private sync(state:TranslationSession){
  const scope=JSON.stringify([state.clipId,state.epoch]);
  if(scope!==this.scope){this.serial++;this.scope=scope;this.heard.clear();this.attempted.clear();this.foreground=undefined;this.background=undefined;this.nextBackgroundAt=0;}
  const policy=JSON.stringify([state.generation,state.language,state.enabled]);
  if(policy!==this.policy){this.serial++;this.policy=policy;this.attempted.clear();this.foreground=undefined;this.background=undefined;this.nextBackgroundAt=0;}
 }
 /** Called with playback evidence, including a just-discovered live sentence
  * whose original audio has already played even if its text is still pending. */
 remember(clipId:string,segmentId:string){
  const state=this.read();if(!state||state.clipId!==clipId)return;this.sync(state);
  const segment=state.segments.find(s=>s.id===segmentId);if(!segment)return;
  this.rememberSegment(segment);
 }
 private rememberSegment(segment:Segment){
  const previous=this.heard.get(segment.id);if(previous&&sameRange(previous,segment))return;
  this.heard.delete(segment.id);
  this.heard.set(segment.id,{revision:segment.revision,startMs:segment.startMs,endMs:segment.endMs});
  if(this.heard.size>64)this.heard.delete(this.heard.keys().next().value!);
 }
 update(current?:Segment,heard?:Segment,previewBusy=false){
  const state=this.read();if(!state)return;this.sync(state);
  if(heard)this.rememberSegment(heard);
  if(!state.enabled)return;
  const currentKey=current?keyOf(current):'';
  if(currentKey!==this.currentKey){this.currentKey=currentKey;this.foregroundAt=this.now();}
  const eligible=(s:Segment)=>Boolean(s.text?.trim()&&!s.englishText&&languageCode(s.language)===state.language&&!this.attempted.has(keyOf(s)));
  const needsCurrent=current&&eligible(current);
  if(needsCurrent){
   // A previous visible line may still be translating as playback advances.
   // Move that one task aside, preserving the bounded two-task limit.
   if(this.foreground&&this.foreground.key!==currentKey&&!this.background){this.background=this.foreground;this.foreground=undefined;}
   if(!this.foreground)this.start(state,current,false);
   return;
  }
  if(this.foreground||this.background||previewBusy||this.now()-this.foregroundAt<500||this.now()<this.nextBackgroundAt)return;
  // Client can apply a late caption in place, so observe it periodically even
  // without an engine event. Never rescan the saved timeline on every frame.
  this.nextBackgroundAt=this.now()+500;
  const byId=new Map(state.segments.map(segment=>[segment.id,segment]));
  for(const [id,heard] of this.heard){
   const segment=byId.get(id);
   if(segment&&sameRange(heard,segment)&&eligible(segment)){this.start(state,segment,true);return;}
  }
 }
 private start(state:TranslationSession,source:Segment,background:boolean){
  // Neither mutable Client snapshots nor the engine's current segment are a
  // safe identity after awaiting a translation. Capture all source coordinates.
  const segment={...source},context={clipId:state.clipId,epoch:state.epoch,generation:state.generation,language:state.language};
  const task={key:keyOf(segment),serial:this.serial};this.attempted.add(task.key);
  if(this.attempted.size>128)this.attempted.delete(this.attempted.values().next().value!);
  if(background)this.background=task;else {this.foreground=task;this.foregroundAt=this.now();}
  void this.translate(segment).then(async value=>{
   const current=this.read();
   if(current)this.sync(current);
   if(!value||!current?.enabled||current.clipId!==context.clipId||current.epoch!==context.epoch||
      current.generation!==context.generation||current.language!==context.language||task.serial!==this.serial)return;
   const row=current.segments.find(s=>s.id===segment.id);
   if(!row||!sameRange(row,segment)||row.text!==segment.text||row.language!==segment.language||row.englishText)return;
   if(background){const heard=this.heard.get(segment.id);if(!heard||!sameRange(heard,segment))return;}
   await this.save(context.clipId,segment,value);
  }).catch(()=>{}).finally(()=>{
   if(this.foreground===task){this.foreground=undefined;this.foregroundAt=this.now();}
   if(this.background===task){this.background=undefined;this.nextBackgroundAt=0;}
  });
 }
}
