import test from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '../src/workspace';
import {Client} from '../src/client';
import type {Segment,Clip} from '../src/domain';

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const segment=(id:string,startMs:number,text?:string,englishText?:string):Segment=>({id,startMs,endMs:startMs+1000,revision:1,source:'turn',language:'ja',text,englishText});
const deferred=()=>{let resolve!:(value:string)=>void;const promise=new Promise<string>(r=>resolve=r);return {promise,resolve};};

function setup(t:import('node:test').TestContext,segments:Segment[]){
 let now=0; t.mock.method(performance,'now',()=>now);
 const saved:{clipId:string;segmentId:string;sourceText:string;englishText:string}[]=[];
 const client=new Client(async request=>{
  if(request.type==='SAVE_TRANSCRIPT')return {ok:true,dataEpoch:1,data:{text:request.payload.text,language:request.payload.language,confidence:request.payload.confidence}} as any;
  if(request.type==='SAVE_TRANSLATION'){
   saved.push({clipId:request.clipId!,segmentId:request.payload.segmentId,sourceText:request.payload.sourceText,englishText:request.payload.englishText});
   return {ok:true,dataEpoch:1,data:{englishText:request.payload.englishText}} as any;
  }
  throw new Error('Unexpected storage request: '+request.type);
 });
 client.clip={id:'clip',revision:1,segments,progress:{},settings:{}} as Clip;
 client.owner={ownerId:'test',generation:1,expiresAt:Date.now()+60000};
 const calls:string[]=[];const pending=new Map<string,ReturnType<typeof deferred>>();
 const english={enabled:true,activeLanguage:'ja' as string|undefined,translate:async(text:string)=>{calls.push(text);return pending.get(text)?.promise??'English: '+text;},canResume:async()=>false,disable(){this.enabled=false;this.activeLanguage=undefined;}};
 const video={paused:false,seeking:false,readyState:4,playbackRate:1,removeEventListener(){}};
 const engine:any={current:0,state:'PLAYING',mode:'shadow',get clip(){return client.clip;},get segment(){return client.clip!.segments[this.current];},dispose(){}};
 const adapter={valid:true,position:segments[0].startMs+300,video,pause(){video.paused=true;}};
 // Run the real Workspace subtitle/persistence controller without constructing
 // unrelated DOM, capture models, or a playback engine.
 const workspace:any=Object.assign(Object.create(Workspace.prototype),{
  client,engine,adapter,english,englishWanted:true,sourceLanguage:'ja',showCaptions:true,
  discovering:false,disposed:false,translationBusy:false,translated:new Set(),translationGeneration:0,
  previewKey:'',previewEnglish:'',subtitles:{setText(){},dispose(){}},renderControls(){},
  lifecycle:new AbortController(),captionFrame:0,onMetadata(){},
 });
 const update=(index=engine.current,elapsed=0)=>{now+=elapsed;engine.current=index;adapter.position=engine.segment.startMs+300;workspace.updateSubtitle();};
 return {workspace,client,engine,adapter,video,english,saved,calls,pending,update};
}

test('a caption saved after its replay gets English after the engine advances',async t=>{
 const first=segment('late',138098),next=segment('next',155322,'次','Next');
 const s=setup(t,[first,next]);s.update(0);s.update(1);
 await s.client.saveCaption('clip','late',{text:'どれもみんな',language:'ja',confidence:.9});
 s.update(1,700);await flush();
 assert.deepEqual(s.saved.map(row=>[row.segmentId,row.sourceText]),[['late','どれもみんな']]);
 assert.equal(s.engine.current,1);assert.equal(s.adapter.position,155622);
});

test('a displayed and heard line is not lost while an earlier translation is busy',async t=>{
 const s=setup(t,[segment('busy',1000,'先の句'),segment('heard',3000,'へぇー!'),segment('next',5000,'次','Next')]);
 const busy=deferred();s.pending.set('先の句',busy);s.update(0);s.update(1);s.update(2);
 busy.resolve('Earlier');await flush();s.update(2,1000);await flush();
 assert.ok(s.saved.some(row=>row.segmentId==='heard'&&row.englishText==='English: へぇー!'));
});

test('one slow background fill does not take the current subtitle translation slot',async t=>{
 const first=segment('late',1000),s=setup(t,[first,segment('next',3000,'次','Next'),segment('current',5000,'今の句')]);
 s.update(0);s.update(1);first.text='遅い句';const delayed=deferred();s.pending.set(first.text,delayed);
 s.update(1,700);await flush();assert.deepEqual(s.calls,['遅い句']);
 s.update(2);await flush();
 assert.ok(s.saved.some(row=>row.segmentId==='current'),'current caption must not await the older fill');
 delayed.resolve('Late');await flush();assert.equal(s.saved.filter(row=>row.segmentId==='late').length,1);
});

test('current untranslated text starts before an eligible older fill',async t=>{
 const first=segment('late',1000),s=setup(t,[first,segment('current',3000,'今の句')]);
 s.update(0);first.text='遅い句';const current=deferred();s.pending.set('今の句',current);
 s.update(1,700);await flush();assert.deepEqual(s.calls,['今の句']);
 current.resolve('Current');await flush();s.update(1,700);await flush();
 assert.deepEqual(s.calls,['今の句','遅い句']);
});

test('old saved progress and unplayed future rows do not authorize background translation',async t=>{
 const old=segment('old',1000),future=segment('future',5000),s=setup(t,[old,segment('current',3000,'次','Next'),future]);
 s.client.clip!.progress.old={count:2,target:2,skipped:false,reason:'target'} as any;
 s.update(1);old.text='昔の句';future.text='未来の句';s.update(1,1000);await flush();
 assert.deepEqual(s.calls,[]);
});

for(const change of ['english-off','source-away-and-back','clip','epoch','source-text','segment-revision','dispose'] as const){
 test('pending English cannot save after '+change,async t=>{
  const row=segment('line',1000,'元の句'),s=setup(t,[row]);const pending=deferred();s.pending.set(row.text!,pending);s.update();
  if(change==='english-off')s.workspace.requestEnglish(false);
  if(change==='source-away-and-back'){s.workspace.setSourceLanguage('ko');s.workspace.setSourceLanguage('ja');s.english.enabled=true;s.english.activeLanguage='ja';}
  if(change==='clip')s.client.clip={...s.client.clip!,id:'other'};
  if(change==='epoch')s.client.epoch++;
  if(change==='source-text')row.text='違う句';
  if(change==='segment-revision')row.revision++;
  if(change==='dispose')s.workspace.disposed=true;
  pending.resolve('Stale English');await flush();assert.deepEqual(s.saved,[]);
 });
}

test('English preference off never translates heard or late text',async t=>{
 const row=segment('line',1000),s=setup(t,[row]);s.workspace.requestEnglish(false);s.update();row.text='遅い句';s.update(0,1000);await flush();
 assert.deepEqual(s.calls,[]);
});

test('only the most recent 64 heard lines are eligible; background work stays serial',async t=>{
 const rows=Array.from({length:70},(_,i)=>segment('line-'+i,i*2000));
 const s=setup(t,rows);
 for(let i=0;i<70;i++)s.update(i);
 s.workspace.showCaptions=false;
 for(let i=0;i<70;i++)rows[i].text='句'+i;
 const delayed=deferred();s.pending.set('句6',delayed);
 s.update(69,700);s.update(69,700);await flush();
 assert.deepEqual(s.calls,['句6'],'oldest six are evicted and no second background job starts');
 delayed.resolve('Six');await flush();s.update(69,700);await flush();
 assert.deepEqual(s.calls,['句6','句7']);
});

test('an idle long record is scanned at most twice a second; current text bypasses the scan interval',async t=>{
 const rows=Array.from({length:2000},(_,i)=>segment('line-'+i,i*2000));
 let maps=0,finds=0;
 const map=rows.map.bind(rows),find=rows.find.bind(rows);
 rows.map=((...args:any[])=>{maps++;return map(...args as [any]);}) as typeof rows.map;
 rows.find=((...args:any[])=>{finds++;return find(...args as [any]);}) as typeof rows.find;
 const s=setup(t,rows);s.update(0);
 for(let i=0;i<60;i++)s.update(0,16);
 assert.ok(maps<=2);assert.equal(finds,0,'remembering/current lookup must not linearly search each animation frame');
 rows[1].text='今の句';s.update(1,10);await flush();assert.deepEqual(s.calls,['今の句']);
});

test('a paused restored line is not marked heard just because it was displayed',async t=>{
 const old=segment('old',1000),s=setup(t,[old,segment('current',3000,'次','Next')]);
 s.video.paused=true;s.update(0);s.video.paused=false;s.update(1);
 old.text='まだ聞いていない';s.update(1,1000);await flush();assert.deepEqual(s.calls,[]);
});

test('live discovery can remember an already-heard empty line before a replay frame',async t=>{
 const old=segment('live',1000),s=setup(t,[old,segment('current',3000,'次','Next')]);
 s.workspace.discovering=true;s.workspace.sessionTranslations().remember('clip','live');
 s.update(1);await s.client.saveCaption('clip','live',{text:'見つけた',language:'ja',confidence:.9});
 s.update(1,1000);await flush();assert.deepEqual(s.saved.map(row=>row.segmentId),['live']);
});

test('a fresh immutable Client snapshot keeps the same heard-line identity',async t=>{
 const row=segment('late',1000),s=setup(t,[row,segment('current',3000,'次','Next')]);s.update(0);s.update(1);
 await s.client.saveCaption('clip','late',{text:'あとから届く',language:'ja',confidence:.9});
 s.client.clip=structuredClone(s.client.clip!);s.update(1,700);await flush();
 assert.deepEqual(s.saved.map(row=>row.segmentId),['late']);
 assert.equal(s.client.clip.segments[0].englishText,'English: あとから届く');
});

test('a fill finishing during append ownership renewal can retry once the session is owned again',async t=>{
 const row=segment('late',1000),s=setup(t,[row,segment('current',3000,'次','Next')]);s.update(0);s.update(1);
 row.text='遅い句';const delayed=deferred();s.pending.set(row.text,delayed);s.update(1,700);await flush();
 const owner=s.client.owner;s.client.owner=undefined;delayed.resolve('Late');await flush();assert.equal(s.saved.length,0);
 s.client.owner=owner;s.update(1,700);await flush();
 assert.deepEqual(s.saved.map(row=>row.segmentId),['late']);
});

test('leaving and returning to the same clip cannot resurrect its old in-flight task',async t=>{
 const row=segment('line',1000,'元の句'),s=setup(t,[row]),oldClip=s.client.clip!;
 const delayed=deferred();s.pending.set(row.text!,delayed);s.update();
 s.client.clip={...oldClip,id:'other',segments:[segment('other',3000,'次','Next')]};s.update();
 s.client.clip=oldClip;s.workspace.showCaptions=false;s.video.paused=true;s.update();
 delayed.resolve('Stale English');await flush();assert.deepEqual(s.saved,[]);
});

for(const change of ['english-off','source-text','segment-range','invalid-video'] as const){
 test('a delayed background result is discarded after '+change,async t=>{
  const row=segment('late',1000),s=setup(t,[row,segment('current',3000,'次','Next')]);s.update(0);s.update(1);
  row.text='遅い句';const delayed=deferred();s.pending.set(row.text,delayed);s.update(1,700);await flush();assert.deepEqual(s.calls,['遅い句']);
  if(change==='english-off')s.workspace.requestEnglish(false);
  if(change==='source-text')row.text='訂正した句';
  if(change==='segment-range')row.endMs++;
  if(change==='invalid-video')s.adapter.valid=false;
  delayed.resolve('Stale fill');await flush();assert.deepEqual(s.saved,[]);
 });
}
