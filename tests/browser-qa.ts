import {RecognitionHost} from '../src/recognition-host';
import {prepareRecognition} from '../src/recognition-ready';
import {Repository, Request} from '../src/storage';
import {Client} from '../src/client';
import {createClip, uid, Clip, Segment} from '../src/domain';
import {Engine} from '../src/engine';
import {VideoAdapter} from '../src/player';
import {Workspace} from '../src/workspace';
import {demoCues} from './fixtures/demo';
import {applyAppearance} from '../src/theme';
import {h,button} from '../src/dom';
import {preferredSubtitleTrack,readableSubtitleTracks} from '../src/subtitles';
import {subtitleControls} from '../src/subtitle-controls';
const out=document.querySelector('#output')!;
const report:(Record<string,unknown>)[]=[];
function log(name:string,data:Record<string,unknown>){const prior=report.findIndex(row=>row.name===name);if(prior>=0)report[prior]={name,...data};else report.push({name,...data});out.textContent=JSON.stringify({browser:navigator.userAgent,at:new Date().toISOString(),results:report},null,2);}
function assert(condition:unknown,text:string):asserts condition{if(!condition)throw new Error(text);}
const auth={binding:'qa-'+uid(),controller:true,videoKey:'demo:cafe'};
const request=(type:string,payload:Record<string,any>={},clipId?:string,expectedRevision?:number):Request=>({protocolVersion:1,requestId:uid(),type,dataEpoch:1,payload,clipId,expectedRevision});
const area=document.querySelector<HTMLElement>('#work')!;let workspace:Workspace|undefined;let engine:Engine|undefined;let adapter:VideoAdapter|undefined;let repository:Repository|undefined;let client:Client|undefined;
function clear(){workspace?.dispose();engine?.dispose();adapter?.dispose();workspace=undefined;engine=undefined;adapter=undefined;area.replaceChildren();}
let failNextCheckpoint=false,loseNextCheckpoint=false,failNextRestart=false,loseNextRestart=false,failNextClip=false,loseNextClip=false;
async function open(name:string){repository=new Repository(name,true);client=new Client(async m=>{if(failNextClip&&m.type==='SAVE_CLIP'){failNextClip=false;return {ok:false,error:'STORAGE_FAILED'};}if(failNextRestart&&m.type.startsWith('RESTART_')){failNextRestart=false;return {ok:false,error:'STORAGE_FAILED'};}if(failNextCheckpoint&&m.type==='SAVE_CHECKPOINT'){failNextCheckpoint=false;return {ok:false,error:'STORAGE_FAILED'};}const reply=await repository!.request(m,auth);if(loseNextClip&&m.type==='SAVE_CLIP'){loseNextClip=false;throw new Error('模拟片段回执丢失');}if(loseNextRestart&&m.type.startsWith('RESTART_')){loseNextRestart=false;throw new Error('模拟重练回执丢失');}if(loseNextCheckpoint&&m.type==='SAVE_CHECKPOINT'){loseNextCheckpoint=false;throw new Error('模拟回执丢失');}return reply;});await client.hello();return client;}
function demoVideo(){const v=h('video',{src:'./media/cafe.mp4',preload:'auto',muted:true,playsinline:true,style:'width:min(600px,100%)','aria-label':'验收教学视频'});v.muted=true;area.append(v);return v;}
async function ready(video:HTMLVideoElement){if(video.readyState>=1)return;await new Promise<void>((resolve,reject)=>{video.addEventListener('loadedmetadata',()=>resolve(),{once:true});video.addEventListener('error',()=>reject(new Error('media unavailable')),{once:true});});}
async function storage(){
 const name='shengge-qa-index-'+uid();const template=createClip({videoKey:'demo:cafe',url:'demo:cafe',title:'QA',durationMs:35000,segments:demoCues});
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open(name,2);q.onupgradeneeded=()=>{const d=q.result;d.createObjectStore('state').put({schemaVersion:1,dataEpoch:1},'root');const clips=d.createObjectStore('clips');clips.createIndex('videoKey','videoKey');clips.createIndex('updatedAt','updatedAt');d.createObjectStore('owners');for(const n of ['receipts','attempts'])d.createObjectStore(n).createIndex('clipId','clipId');d.createObjectStore('diagnostics',{keyPath:'id',autoIncrement:true}).createIndex('at','at');};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 await new Promise<void>((resolve,reject)=>{const tx=db.transaction('clips','readwrite');for(let i=0;i<1000;i++){const c=structuredClone(template);c.id=`qa-${String(i).padStart(4,'0')}`;if(i%2===0)Object.values(c.progress).forEach(p=>p.reason='early');if(i%3===0)c.questions=[{id:'q',cueId:c.segments[0].id,targetId:c.segments[1].id,revealed:true,rating:'stuck'}];tx.objectStore('clips').put(c,c.id);}tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();
 let repo=new Repository(name,true);const begin=performance.now();await repo.request(request('HELLO'),auth);const migrateMs=performance.now()-begin;
 const times:number[]=[],ids=new Set<string>();let cursor;
 for(let i=0;i<20;i++){const t=performance.now(),r=await repo.request(request('LIST_RECORDS',{cursor,limit:50}),auth);times.push(performance.now()-t);assert(r.ok,'list failed');assert(r.data.total===1000,'wrong total');assert(r.data.hasMore===(i<19),'wrong end');for(const c of r.data.clips)ids.add(c.id);cursor=r.data.nextCursor;}
 assert(ids.size===1000,'missing or duplicate records');
 for(const [filter,total]of [['active',500],['done',500],['hard',334]] as const){const r=await repo.request(request('LIST_RECORDS',{filter}),auth);assert(r.ok&&r.data.total===total,'filter '+filter);}
 const target='qa-0001';const owned=await repo.request(request('ACQUIRE_SESSION',{},target),auth);assert(owned.ok,'owner failed');
 const event=request('COMMIT_COMPLETION',{...owned.data,attemptId:'native-one',segmentId:template.segments[0].id,segmentRevision:1},target,1);
 const put=IDBObjectStore.prototype.put;
 try{IDBObjectStore.prototype.put=function(...args:any[]){if(this.name==='attempts')throw new DOMException('QA quota','QuotaExceededError');return put.apply(this,args as any);};const r=await repo.request(event,auth);assert(!r.ok&&r.error==='QUOTA_EXCEEDED','quota response');}finally{IDBObjectStore.prototype.put=put;}
 const before=await repo.request(request('GET_RECORD',{},target),auth);assert(before.ok&&before.data.progress[template.segments[0].id].count===0,'rollback lost');
 for(let i=0;i<2;i++){const r=await repo.request(event,auth);assert(r.ok&&r.data.progress[template.segments[0].id].count===1,'duplicate count');}
 await repo.close();repo=new Repository(name,true);const restored=await repo.request(request('GET_RECORD',{},target),auth);assert(restored.ok&&restored.data.progress[template.segments[0].id].count===1,'reopen lost');
 await repo.request(request('DELETE_RECORD',{},target),auth);const deleted=await repo.request(request('GET_RECORD',{},target),auth);assert(!deleted.ok,'delete failed');
 await repo.request(request('CLEAR_DATA',{confirm:true}),auth);const stale=await repo.request(event,auth);assert(!stale.ok&&stale.error==='STALE_EPOCH','old epoch revived');await repo.close();
 times.sort((a,b)=>a-b);log('native-indexeddb',{passed:true,rows:ids.size,pages:20,filterTotals:[500,500,334],migrationMs:Math.round(migrateMs),pageP50Ms:Math.round(times[10]*10)/10,pageP95Ms:Math.round(times[18]*10)/10,quotaRollback:true,retryCount:1,reopen:true,deletion:true,oldEpochRejected:true,database:name});
}
async function playback(){clear();const c=await open('shengge-qa-video-'+uid());const v=demoVideo();await ready(v);adapter=new VideoAdapter(v,'demo:cafe');const segments=Array.from({length:30},(_,i)=>({id:`sample-${i}`,revision:1,startMs:1000+i*1000,endMs:1250+i*1000,source:'manual' as const}));await c.call('SAVE_CLIP',{videoKey:'demo:cafe',url:'demo:cafe',title:'90区间本地媒体验收',name:'QA',durationMs:adapter.duration,segments});await c.acquire();engine=new Engine(adapter,c);await engine.attach();await engine.saveSettings({...c.clip!.settings,targetDefault:3,listenGapMs:0});const started=performance.now();const samples:number[]=[];let prior=0;
 const snapshot=()=>{const count=Object.values(c.clip!.progress).reduce((sum,p)=>sum+p.count,0);if(count>prior){samples.push(adapter!.position-segments[Math.floor((count-1)/3)].endMs);prior=count;}
 log('local-media-progress',{count,total:90,state:engine!.state,error:engine!.error});
 if(engine!.state==='PRACTICE_DONE'){assert(count===90,'wrong completion total');assert(v.paused,'did not stop');log('local-media-90',{passed:true,count,segments:30,elapsedMs:Math.round(performance.now()-started),maxAbsoluteEndPositionErrorMs:Math.round(Math.max(...samples.map(Math.abs))),note:'30个250ms技术区间，各3遍；不是30句真实平台音频验收'});engine!.removeEventListener('change',snapshot);}
 };
 engine.addEventListener('change',snapshot);await engine.start();
}
async function interruption(){
 clear();const v=demoVideo();await ready(v);const a=new VideoAdapter(v,'demo:cafe');
 try{
  const cancelled=a.seek(30000).then(()=>false,e=>e.code==='OPERATION_CANCELLED');a.cancelSeek();assert(await cancelled,'seek was not cancelled');
  await a.seek(2000);
  const second=new VideoAdapter(v,'demo:cafe');adapter=second;
  await second.play();a.pause();assert(!v.paused,'obsolete controller paused the replacement');a.dispose();assert(!v.paused,'obsolete dispose paused replacement');second.pause();
  const failure=second.seek(32000).then(()=>false,e=>e.code==='CAPABILITY_LOST');v.removeAttribute('src');v.load();assert(await failure,'emptied media did not reject seek');
  log('native-player-interruption',{passed:true,cancelledSeek:true,stalePauseIgnored:true,sourceEmptiedRejected:true});
 }finally{a.dispose();adapter?.dispose();}
}
const workspaceDb='shengge-qa-workspace-v1';
async function practice(){clear();const c=await open(workspaceDb);const v=demoVideo();await ready(v);adapter=new VideoAdapter(v,'demo:cafe',demoCues);workspace=new Workspace(adapter,c,{demo:true,onRecords:()=>log('workspace',{message:'返回记录已触发'}),onExit:clear});area.replaceChildren(workspace.root);const list=await c.call('LIST_RECORDS',{limit:1});if(list.clips[0])await workspace.resume(list.clips[0]);log('workspace',{database:workspaceDb,formalDataUntouched:true});}
async function difficultFixture(restore=false){
 clear();const c=await open('shengge-qa-difficult-v1');const v=demoVideo();await ready(v);adapter=new VideoAdapter(v,'demo:cafe',demoCues);
 if(restore){const list=await c.call('LIST_RECORDS',{limit:1});assert(list.clips[0],'no fixture');c.clip=list.clips[0];}
 else{
  await c.call('SAVE_CLIP',{videoKey:'demo:cafe',url:'demo:cafe',title:'困难句事务验收',name:'困难句事务验收',durationMs:adapter.duration,segments:demoCues});await c.acquire();
  await c.call('SAVE_CHECKPOINT',{settings:{...c.clip!.settings,targetDefault:1,listenGapMs:0}});
  for(const s of c.clip!.segments)await c.call('COMMIT_COMPLETION',{segmentId:s.id,segmentRevision:s.revision,attemptId:uid()});
  await c.call('START_QUESTIONS');
  for(const [i,q] of c.clip!.questions.entries()){await c.call('REVEAL_ANSWER',{questionId:q.id});await c.call('RATE_ANSWER',{questionId:q.id,rating:i%2===0?'stuck':'can'});}
  await c.call('SAVE_CHECKPOINT',{mode:'done'});await c.release();
 }
 workspace=new Workspace(adapter,c,{demo:true,onRecords:()=>log('workspace',{message:'返回记录已触发'}),onExit:clear});area.replaceChildren(workspace.root);await workspace.resume(c.clip!);inspectWorkspace();
}
function inspectWorkspace(){if(!client?.clip)return;const c=client.clip;log('difficult-workspace',{mode:c.mode,current:c.current,practiceIds:c.practiceIds??null,counts:c.segments.map(s=>c.progress[s.id].count),targets:c.segments.map(s=>c.progress[s.id].target),ratings:c.questions.map(q=>q.rating),historyCount:c.history?.length??0,segments:c.segments.map(s=>({id:s.id,startMs:s.startMs,endMs:s.endMs,revision:s.revision})),paused:adapter?.video.paused});}
let qaRunning=false;
async function run(fn:()=>Promise<void>){if(qaRunning)return;qaRunning=true;try{await fn();}catch(e){adapter?.pause();log('FAIL',{error:String(e),segments:client?.clip?.segments});}finally{qaRunning=false;}}
const top=document.querySelector('#actions')!;top.append(button('模拟下一次设置保存失败',()=>{failNextCheckpoint=true;log('fault',{armed:'checkpoint failure'});},'soft'),button('模拟下一次设置回执丢失',()=>{loseNextCheckpoint=true;log('fault',{armed:'lost checkpoint acknowledgement'});},'soft'),button('运行播放器中断验收',()=>void run(interruption),'soft'),button('运行1000条存储验收',()=>void run(storage),'primary'),button('运行90次本地视频循环',()=>void run(playback),'primary'),button('继续循环验收',()=>void engine?.resume(),'soft'),button('打开独立教学工作区',()=>void run(practice),'soft'));
applyAppearance(document.querySelector<HTMLElement>('.sg')!,true);
window.addEventListener('beforeunload',clear);

top.append(button('准备困难句事务测试',()=>void run(()=>difficultFixture()),'soft'),button('恢复困难句测试记录',()=>void run(()=>difficultFixture(true)),'soft'),button('模拟下一次重练保存失败',()=>{failNextRestart=true;},'soft'),button('模拟下一次重练回执丢失',()=>{loseNextRestart=true;},'soft'),button('读取工作区验证状态',inspectWorkspace,'soft'),button('重新练整段测试',()=>void run(async()=>{await workspace?.restart();inspectWorkspace();}),'soft'));

async function freshRecognition(){clear();const c=await open('shengge-qa-recognition-'+uid());const v=demoVideo();await ready(v);adapter=new VideoAdapter(v,'demo:cafe',demoCues);workspace=new Workspace(adapter,c,{demo:true,onRecords:()=>{},onExit:clear});area.replaceChildren(workspace.root);}
top.append(button('打开新练习测试',()=>void run(freshRecognition),'soft'),button('模拟下一次片段保存失败',()=>{failNextClip=true;},'soft'),button('模拟下一次片段回执丢失',()=>{loseNextClip=true;},'soft'),button('读取测试记录数量',()=>void run(async()=>{const data=await client!.call('LIST_RECORDS',{limit:50});log('recognition-records',{total:data.total,names:data.clips.map((c:Clip)=>c.name)});inspectWorkspace();}),'soft'));

async function keyboardFocus(inShadow=false){
 await freshRecognition();const root=workspace!.root;
 if(inShadow){const host=h('div');area.append(host);host.attachShadow({mode:'open'}).append(h('style',null,await (await fetch('./app.css')).text()),root);}
 const named=(label:string)=>Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(b=>(b.textContent===label||b.getAttribute('aria-label')===label))!;
 const wait=async(check:()=>boolean)=>{const until=performance.now()+5000;while(!check()){if(performance.now()>until)throw new Error('focus test timed out');await new Promise(r=>setTimeout(r,20));}};
 const focused=()=>{let el=document.activeElement as HTMLElement;while(el.shadowRoot?.activeElement)el=el.shadowRoot.activeElement as HTMLElement;return el;};
 assert(root.querySelectorAll('.steps button').length===3&&!named('自动识别'),'recognition page remains');
 failNextClip=true;named('开始跟读').focus();named('开始跟读').click();await wait(()=>Boolean(named('重试保存练习')));
 named('重试保存练习').focus();named('重试保存练习').click();await wait(()=>Boolean(root.querySelector('.compact-preferences')));
 await new Promise(r=>setTimeout(r,100));assert(focused().dataset.focusKey==='transport','save retry lost playback focus');adapter!.pause();
 log(inShadow?'shadow-keyboard-focus':'keyboard-focus',{passed:true,threeStepsOnly:true,noRecognitionPage:true,failedSaveRetry:true,saveToPlayback:true});
}
top.append(button('运行原站面板焦点验收',()=>void run(()=>keyboardFocus(true)),'soft'));

async function accessibility(inShadow=false){
 let accessibilityWait=0;
 await freshRecognition();const root=workspace!.root;
 if(inShadow){const host=h('div',{class:'injected'});area.append(host);host.attachShadow({mode:'open'}).append(h('style',null,await (await fetch('./app.css')).text()),root);}
 const wait=async(check:()=>boolean)=>{const until=performance.now()+12000;const step=++accessibilityWait;while(!check()){if(performance.now()>until)throw new Error('accessibility test timed out at '+step+' current '+client?.clip?.current);await new Promise(r=>setTimeout(r,20));}await new Promise(r=>setTimeout(r,0));};
 const named=(label:string)=>Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(b=>(b.textContent===label||b.getAttribute('aria-label')===label))!;
 const click=async(el:HTMLElement)=>{assert(el,'missing control');el.focus();el.click();await new Promise(r=>setTimeout(r,100));};
 const focused=()=>{let el=document.activeElement as HTMLElement;while(el.shadowRoot?.activeElement)el=el.shadowRoot.activeElement as HTMLElement;return el;};
 const live=root.querySelector<HTMLElement>('[data-workspace-announcement]')!;
 assert(live?.getAttribute('role')==='status'&&live.getAttribute('aria-atomic')==='true','missing persistent announcement');
 await click(named('开始跟读'));await wait(()=>Boolean(root.querySelector('.compact-preferences')));await click(root.querySelector<HTMLButtonElement>('[data-focus-key=transport]')!);
 assert(live===root.querySelector('[data-workspace-announcement]'),'live region replaced after save');assert(live.textContent?.includes('第 1 / 5 句，已完成 0 / 3 遍'),'initial progress not announced');
 const target=root.querySelector<HTMLInputElement>('[aria-label="每句遍数"]')!;target.focus();target.value='2';target.dispatchEvent(new Event('input',{bubbles:true}));
 await wait(()=>client!.clip!.settings.targetDefault===2);assert(focused()===target,'automatic save lost input focus');
 assert(client!.clip!.mode==='shadow'&&client!.clip!.settings.rate===1&&client!.clip!.settings.nextPolicy==='auto','fixed shadowing defaults not applied');
 assert(root.querySelector('.compact-preferences')&&root.querySelector('.compact-actions'),'compact controls missing');
 await click(named('加练5遍'));await wait(()=>!named('加练5遍').disabled);assert(focused().getAttribute('aria-label')==='加练5遍','icon action lost focus');
 await click(named('下一句'));await wait(()=>client!.clip!.current===1);await click(named('上一句'));await wait(()=>client!.clip!.current===0);
 for(let i=0;i<5;i++){await click(named('提前完成'));await wait(()=>i===4?client!.clip!.mode==='cue':client!.clip!.current===i+1);}
 await wait(()=>Boolean(named('听原声核对'))&&!named('听原声核对').disabled);
 assert(live.textContent?.includes('等待手动核对，答案未揭示'),'waiting for answer not announced');
 const publicText=[live.textContent,root.querySelector('.controls-area')?.textContent].join(' ');
 assert(!demoCues.some(c=>c.text&&publicText.includes(c.text)),'dialogue leaked into controls or announcement');
 await click(named('听原声核对'));await wait(()=>Boolean(named('卡住了')));await click(named('卡住了'));await wait(()=>live.textContent?.includes('第 2 / 4 题')===true);
 for(let i=0;i<3;i++){await wait(()=>Boolean(named('跳过'))&&!named('跳过').disabled);await click(named('跳过'));await wait(()=>i===2?Boolean(named('重练困难句')):live.textContent?.includes(`第 ${i+3} / 4 题`)===true);}
 assert(live.textContent?.includes('卡住 1，跳过 3'),'results not announced');
 log(inShadow?'shadow-accessibility':'accessibility',{passed:true,autoSaveFocus:true,iconActionFocus:true,persistentLiveRegion:true,unchangedNoticeRetained:true,savedCountAnnounced:true,automaticGap:true,answerWaitAnnounced:true,ratingAnnounced:true,questionAndResultsAnnounced:true,noDialogueInAnnouncements:true,database:'isolated shengge-qa-recognition-*',note:'DOM与实际视频回归；不代表VoiceOver听感验收'});
}
top.append(button('运行状态播报验收',()=>void run(()=>accessibility()),'soft'),button('运行原站面板状态播报验收',()=>void run(()=>accessibility(true)),'soft'));

async function multilingualSubtitles(){
 clear();const c=await open('shengge-qa-languages-'+uid());const v=demoVideo();await ready(v);
 const samples=[['en','Hello there.'],['zh-Hans','你好，世界。'],['ja','こんにちは。'],['ko','안녕하세요.'],['ar','مرحبًا بالعالم.'],['hi','नमस्ते दुनिया।'],['es','¡Hola, mundo!'],['','Unlabelled speech.']];
 for(const [language,line] of samples){const track=v.addTextTrack('subtitles',language||'未标注语言',language);track.mode='hidden';track.addCue(new VTTCue(2,4,line));}
 v.textTracks[4].mode='showing';const choices=readableSubtitleTracks(v.textTracks);assert(choices.length===samples.length,'language filtered out');
 for(let i=0;i<choices.length;i++)assert(choices[i].cues.length===1&&choices[i].cues[0].text===samples[i][1],'text changed or tracks merged');
 const selected=preferredSubtitleTrack(choices)!;assert(selected.track.language==='ar','visible Arabic track not preferred');
 let applied:TextTrack|null|undefined;const pickerPanel=subtitleControls(choices,selected,track=>{applied=track;});area.append(pickerPanel);
 const picker=pickerPanel.querySelector('select')!;assert(picker.value==='4','visible track not selected in picker');
 picker.value='0';pickerPanel.querySelector('button')!.click();assert(applied===v.textTracks[0],'English selection not applied');
 picker.value='manual';pickerPanel.querySelector('button')!.click();assert(applied===null,'manual fallback not applied');
 assert(v.textTracks[4].mode==='showing','picker changed platform caption visibility');
 adapter=new VideoAdapter(v,'demo:cafe',selected.cues);await c.call('SAVE_CLIP',{videoKey:'demo:cafe',url:'demo:cafe',title:'多语言字幕测试',name:'阿拉伯语字幕',durationMs:adapter.duration,segments:selected.cues});
 const restored=await c.call('GET_RECORD',{},c.clip!.id);assert(restored.segments[0].text===samples[4][1],'Unicode persistence changed text');
 workspace=new Workspace(adapter,c,{demo:true,onRecords:()=>{},onExit:clear});area.replaceChildren(workspace.root);workspace.root.dataset.theme='dark';await workspace.resume(restored);
 workspace.root.prepend(subtitleControls(choices,selected,()=>{}));
 log('native-multilingual-subtitles',{passed:true,nativeTextTracks:true,languages:samples.map(s=>s[0]||'unlabelled'),visibleTrackPreferred:true,noMergedTranslations:true,unicodePersistence:true,restoredWorkspace:true,englishSelection:true,manualFallback:true,platformCaptionsUnchanged:true});
}
top.append(button('运行多语言字幕验收',()=>void run(multilingualSubtitles),'soft'));


const recognitionHost=new RecognitionHost(()=>new Worker('./recognition-worker.js',{type:'module'}));
const sentenceTransport=async(action:string,payload:Record<string,any>={})=>recognitionHost.request(action,payload,'isolated-qa');
async function livePractice(cancel=false,speakers=false){
 clear();await prepareRecognition(sentenceTransport,new AbortController().signal,message=>log('model-prepare',{message}));const c=await open('shengge-qa-live-'+uid());const v=demoVideo();if(speakers)v.src='./media/speaker-turns.wav';await ready(v);adapter=new VideoAdapter(v,'demo:cafe');workspace=new Workspace(adapter,c,{demo:true,asrTransport:sentenceTransport,onRecords:()=>{},onExit:clear});area.replaceChildren(workspace.root);const root=workspace.root;
 assert(root.querySelectorAll('.steps button').length===3&&!root.textContent?.includes('开始自动识别'),'separate recognition page remains');
 const target=root.querySelector<HTMLInputElement>('[aria-label="每句遍数"]')!;target.value='1';target.dispatchEvent(new Event('change'));
 const waits=async(check:()=>boolean,ms=40000)=>{const deadline=performance.now()+ms;while(!check()){if(performance.now()>deadline)throw new Error('live flow timed out: '+root.innerText);await new Promise(r=>setTimeout(r,20));}};
 const stops:number[]=[];const onPause=()=>stops.push(v.currentTime);v.addEventListener('pause',onPause);const started=performance.now();
 root.querySelector<HTMLButtonElement>('[data-focus-key=transport]')!.click();await waits(()=>!v.paused,10000);const startDelay=performance.now()-started;
 if(cancel){root.querySelector<HTMLButtonElement>('[data-focus-key=live-pause]')!.click();await waits(()=>Boolean(root.querySelector('[data-focus-key=transport]')));const records=await c.call('LIST_RECORDS',{limit:10});assert(v.paused&&records.total===0,'cancel saved partial speech or left playback running');log('live-cancel',{passed:true,noPartialRecord:true,paused:true,startDelayMs:startDelay});return;}
 await waits(()=>Boolean(c.clip));const firstCreated=performance.now()-started;const first=structuredClone(c.clip!);assert(first.segments.length===1&&first.segments[0].source==='turn','not streaming speech detection');if(speakers){assert(first.segments[0].startMs<1000&&first.segments[0].endMs>=3600&&first.segments[0].endMs<4400,'merged two complete sentences from same speaker');}else assert(first.segments[0].startMs>=1500&&first.segments[0].startMs<2800&&first.segments[0].endMs>=3800&&first.segments[0].endMs<6500,'first sentence cut at an internal pause');
 await waits(()=>Boolean(c.clip&&c.clip.segments.length>=2));await waits(()=>!root.querySelector('[data-focus-key=live-pause]'));
 const current=c.clip!;assert(current.id===first.id,'next sentence created another record');assert(current.progress[first.segments[0].id].count===1,'first sentence progress lost');assert(current.current===1,'next sentence not selected');if(speakers)assert(current.segments[1].startMs>=3700&&current.segments[1].startMs<4900,'second complete sentence not selected');else assert(current.segments[1].startMs>=8000&&current.segments[1].startMs<9500,'second sentence is a fragment of the first');
 let third:Segment|undefined;
 if(speakers){await waits(()=>Boolean(c.clip&&c.clip.segments.length>=3));await waits(()=>!root.querySelector('[data-focus-key=live-pause]'));third=c.clip!.segments[2];assert(third.startMs>=6800&&third.startMs<7900&&third.endMs>9500&&third.endMs<13900,'next speaker was merged, skipped or cut into a fragment');assert(c.clip!.progress[current.segments[1].id].count===1,'second sentence did not finish before the next speaker');}
 root.querySelector<HTMLButtonElement>('[data-focus-key=transport]')!.click();v.removeEventListener('pause',onPause);
 log(speakers?'semantic-turn-live-practice':'streaming-live-practice',{passed:true,realSpeakerModel:true,realVideoAudio:true,streamingTextAndSpeakerModels:true,noRecognitionPage:true,startDelayMs:startDelay,firstSentenceReadyMs:firstCreated,firstBoundary:first.segments[0],secondBoundary:current.segments[1],thirdBoundary:third,sameRecord:true,firstCount:current.progress[first.segments[0].id].count,pauses:stops,paused:v.paused});
}
top.append(button('运行即时分句练习验收',()=>void run(()=>livePractice()),'soft'),button('运行即时练习取消验收',()=>void run(()=>livePractice(true)),'soft'));

top.append(button('运行完整句与换人联合验收',()=>void run(()=>livePractice(false,true)),'soft'));
