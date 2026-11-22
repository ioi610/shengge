import {createClip, cueFingerprint, formatTime, message, questionsFor, resolveSource, splitCues, type Question, type Segment} from '../src/domain';
import {promptEnd} from '../src/training-flow';
import {demoCues} from '../tests/fixtures/demo';

type Phase='watch'|'prompt'|'wait'|'answer'|'rate'|'done'|'retry';
type Snapshot={ready:boolean;duration:number;position:number;paused:boolean;site:boolean;title:string;result?:{state:string;run:string};cues?:Line[]};
type Line={startMs:number;endMs:number;text?:string;englishText?:string};
type Source={url:string;videoKey:string;title:string};
type Receipt={fingerprint:string;ratings:Question['rating'][]};
type Recent=Source & {lines?:Line[];receipt?:Receipt};
declare const webkit:{messageHandlers:{desktop:{postMessage:(args:object)=>Promise<any>}}};
const send=(op:string,args:object={})=>webkit.messageHandlers.desktop.postMessage({op,...args});
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const urlField=el<HTMLInputElement>('url');
let source:Source|undefined, session='', phase:Phase='watch', run='', index=0, busy=false;
let snap:Snapshot|undefined, lines:Segment[]=[], questions:Question[]=[], mark:number|undefined;
let issued=0, requestPending=false, retryAnswer=false;
let recent:Recent[]=[];
try{const saved=JSON.parse(localStorage.getItem('recent')??'[]');if(Array.isArray(saved))recent=saved.filter(v=>typeof v?.url==='string'&&typeof v.title==='string').slice(0,12);}catch{}
const demo:Source={url:'demo:cafe',videoKey:'demo:cafe',title:'駅前のカフェ · 示例视频'};
function notice(s=''){el('notice').textContent=s;}
function button(label:string,action:()=>void,primary=false){
 const b=document.createElement('button');b.textContent=label;if(primary)b.className='primary';b.onclick=action;return b;
}
function perform(fn:()=>Promise<void>){return async()=>{
 if(busy)return;const token=session;busy=true;notice();
 try{await fn();}catch(e){if(session===token)notice(message(e));}
 finally{if(session===token)busy=false;}
};}
function entry(){return recent.find(v=>v.videoKey===source?.videoKey);}
function save(){
 try{localStorage.setItem('recent',JSON.stringify(recent));}catch{notice('本机空间不足，本次进度仅在当前窗口保留。');}
}
function cards(){
 el('cards').replaceChildren();
 for(const item of [...recent.filter(r=>r.videoKey!==demo.videoKey),demo]){
  const b=button('',()=>void openSource(item));b.className='card';
  const img=document.createElement('img');img.src=item.videoKey===demo.videoKey?'cafe.jpg':'icons/play.svg';img.alt='';
  const label=document.createElement('span');label.textContent=item.title;b.append(img,label);el('cards').append(b);
 }
}
function layout(){
 const r=el('screen').getBoundingClientRect();void send('layout',{x:r.x,y:r.y,w:r.width,h:r.height});
}
new ResizeObserver(layout).observe(el('screen'));
window.addEventListener('scroll',layout,{passive:true});
async function home(){
 session='';source=undefined;busy=false;issued++;await send('close');
 el('landing').hidden=false;el('study').hidden=true;el('source').textContent='';notice();cards();urlField.focus();
}
async function media(op:string,extra:object={}):Promise<Snapshot>{
 const token=session;
 const state=await send('media',{session:token,command:{op,key:source?.videoKey,...extra}});
 if(token!==session)throw new Error('视频已切换');
 return state;
}
async function openSource(item:Source){
 openedAt=Date.now();const token=session=crypto.randomUUID();issued++;source=item;phase='watch';snap=undefined;lines=[];questions=[];mark=undefined;busy=false;
 el('position').textContent='00:00';el('duration').textContent='';el<HTMLProgressElement>('progress').value=0;
 el('landing').hidden=true;el('study').hidden=false;el('source').textContent=item.title;
 notice('正在打开视频…');draw();layout();
 try{
  await send('open',{session:token,url:item.url});if(token!==session)return;
  const old=entry();recent=[{...old,...item},...recent.filter(r=>r.videoKey!==item.videoKey)].slice(0,12);save();
  if(item.videoKey===demo.videoKey)lines=demoCues.map(s=>({...s}));
  else if(old?.lines)lines=segments(old.lines);
  await poll();
 }catch(e){if(session===token)notice(message(e));}
}
function importURL(){
 try{const s=resolveSource(urlField.value);void openSource({...s,title:s.url});}catch(e){notice(message(e));urlField.focus();}
}
el('import').onsubmit=e=>{e.preventDefault();importURL();};
el('paste').onclick=async()=>{const s=await send('paste');if(s){urlField.value=s;urlField.focus();notice();}else notice('剪贴板中没有视频链接。');};
el('home').onclick=el('add').onclick=()=>void home();
function segments(data:Line[]):Segment[]{
 return data.map((s,i)=>({...s,id:'line-'+i,revision:1,source:'platform'}));
}
function setLines(data:Line[]){
 if(!snap?.ready)throw new Error('请等视频加载后再添加对白。');
 const valid=splitCues(segments(data),0,snap.duration);
 if(valid.length!==data.length)throw new Error('字幕时间超出当前视频。');
 if(!source)return;
 createClip({videoKey:source.videoKey,url:source.url,title:source.title,durationMs:snap.duration,segments:valid});
 lines=valid;const r=entry();if(r){r.lines=valid.map(({startMs,endMs,text,englishText})=>({startMs,endMs,text,englishText}));save();}draw();
}
function parseSubtitle(text:string){
 const rows:Line[]=[];
 const clock=(s:string)=>s.replace(',','.').split(':').reduce((v,x)=>v*60+Number(x),0)*1000;
 for(const block of text.replace(/^\uFEFF/,'').replace(/\r/g,'').split(/\n\s*\n/)){
  const parts=block.trim().split('\n'),i=parts.findIndex(s=>s.includes('-->'));if(i<0)continue;
  const m=parts[i].match(/^\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})(?:\s.*)?$/);
  if(!m)throw new Error('字幕时间格式有误。');
  const body=parts.slice(i+1).map(x=>x.replace(/<[^>]*>/g,'').trim()).filter(Boolean);
  if(body.length)rows.push({startMs:Math.round(clock(m[1])),endMs:Math.round(clock(m[2])),text:body[0],englishText:body.slice(1).join(' ')||undefined});
 }
 if(rows.length<2)throw new Error('请导入至少含两句对白的 SRT 或 VTT 字幕。');
 return rows.sort((a,b)=>a.startMs-b.startMs);
}
el('sub').onclick=perform(async()=>{const token=session,text=await send('file');if(token===session&&text)setLines(parseSubtitle(text));});
function bindPlay(){el('play').onclick=perform(async()=>{const state=await media('toggle');if(state.ready){snap=state;draw();}});}
bindPlay();
el('site').onclick=perform(async()=>{snap=await media('site');draw();});
async function capture(){
 const now=await media('status');if(!now.ready)throw new Error('请先播放正片。');
 if(mark===undefined){mark=now.position;if(now.paused)await media('toggle');}
 else{
  if(now.position<=mark+350)throw new Error('请在一句对白结束时再点一次。');
  await media('stop');
  setLines([...lines,{startMs:mark,endMs:now.position}].sort((a,b)=>a.startMs-b.startMs));mark=undefined;
 }
 draw();
}
async function playQuestion(answer=false){
 const token=session,id=run=crypto.randomUUID();retryAnswer=answer;
 const q=questions[index],clip=lines.find(s=>s.id===(answer?q.targetId:q.cueId))!,target=lines.find(s=>s.id===q.targetId)!;
 phase=answer?'answer':'prompt';draw();
 try{
  const end=answer?clip.endMs:promptEnd(clip.startMs,clip.endMs,target.startMs,source?.videoKey!==demo.videoKey);
  const value=await media('range',{run:id,from:clip.startMs,to:end});if(token!==session||run!==id)return;
  if(!value.ready)throw new Error('请等待正片加载。');
 }catch(e){if(token===session&&run===id){phase='retry';draw();}throw e;}
}
async function start(){
 if(!source||!snap?.ready||lines.length<2)return;
 const clip=createClip({videoKey:source.videoKey,url:source.url,title:source.title,durationMs:snap.duration,segments:lines});
 questions=questionsFor(clip);
 const receipt=entry()?.receipt;
 if(receipt?.fingerprint===cueFingerprint(lines)&&receipt.ratings.length===questions.length&&receipt.ratings.some(r=>!r)){
  questions.forEach((q,i)=>{q.rating=receipt.ratings[i];});
 }
 index=Math.max(0,questions.findIndex(q=>!q.rating));await playQuestion();
}
el('start').onclick=perform(start);
el('practice').onclick=perform(async()=>{
 if(!source)return;
 const time=snap?.ready?snap.position:0;
 if(snap?.ready)await media('stop');
 await send('training',{session,url:source.url,time});
});
el('records').onclick=perform(async()=>{await send('training',{records:true});});
async function rate(rating:'can'|'stuck'|'skip'){
 if(rating!=='skip'&&phase!=='rate')return;
 const token=session;await media('stop');if(session!==token)return;questions[index].rating=rating;
 const r=entry();if(r){r.receipt={fingerprint:cueFingerprint(lines),ratings:questions.map(q=>q.rating)};save();}
 if(++index>=questions.length){phase='done';draw();}else await playQuestion();
}
async function watch(){await media('stop');phase='watch';run='';mark=undefined;draw();}
function draw(){
 const ready=!!snap?.ready,learning=phase!=='watch';
 el('practice').hidden=learning;el('sub').hidden=learning;el('site').hidden=learning;el('play').hidden=learning;
 el('start').hidden=learning;el<HTMLButtonElement>('start').disabled=!ready||lines.length<2||mark!==undefined;
 el<HTMLButtonElement>('play').disabled=!ready;
 el('play').querySelector('img')!.src=snap?.paused===false?'icons/pause.svg':'icons/play.svg';
 el('site').textContent=snap?.site?'返回播放器':'原站控件';
 const caption=el('caption'),actions=el('actions'),rows=el('rows');
 caption.replaceChildren();actions.replaceChildren();rows.replaceChildren();
 const add=(label:string,fn:()=>Promise<void>,primary=false)=>actions.append(button(label,perform(fn),primary));
 if(!learning){
  caption.textContent=ready?'':'等待原站播放器…';
  if(ready){add(mark===undefined?'标记句首':'标记句尾',capture);if(mark!==undefined)add('取消标记',async()=>{mark=undefined;draw();});}
  if(ready&&lines.length<2)caption.textContent='点「边播边练」自动识别对白';
 }else if(phase==='done'){
  caption.textContent='本轮完成';add('再练一轮',start,true);add('返回视频',watch);
 }else{
  const current=lines.find(s=>s.id===questions[index]?.targetId);
  caption.textContent=phase==='wait'?'接下一句':phase==='prompt'?'看上一句':phase==='retry'?'播放中断':current?.text||'原片核对';
  if((phase==='answer'||phase==='rate')&&current?.englishText){const sub=document.createElement('small');sub.textContent=current.englishText;caption.append(sub);}
  if(phase==='wait'){add('重播提示',()=>playQuestion());add('看原片',()=>playQuestion(true),true);}
  if(phase==='rate'){add('能接出',()=>rate('can'),true);add('卡住了',()=>rate('stuck'));add('再看一次',()=>playQuestion(true));}
  if(phase==='retry')add('重新播放',()=>playQuestion(retryAnswer),true);
  if(phase!=='rate')add('跳过',()=>rate('skip'));
  add('退出接话',watch);
 }
 el('count').textContent=learning?Math.min(index+1,questions.length)+' / '+questions.length:String(lines.length);
 const list=learning?questions.map(q=>lines.find(s=>s.id===q.targetId)!):lines;
 const pageStart=learning?Math.max(0,index-2):0;
 list.slice(pageStart,pageStart+12).forEach((s,offset)=>{
  const i=pageStart+offset,li=document.createElement('li'),num=document.createElement('b');num.textContent=String(i+1).padStart(2,'0');li.append(num);
  if(learning&&i===index)li.className='current';
  const rated=questions[i]?.rating;
  if(!learning||!!rated||i===index&&['answer','rate'].includes(phase)){
   const t=document.createElement('span');t.textContent=s.text||formatTime(s.startMs)+' – '+formatTime(s.endMs);
   if(s.englishText){const en=document.createElement('small');en.textContent=s.englishText;t.append(en);}li.append(t);
   if(learning&&rated){const m=document.createElement('em');m.textContent=rated==='can'?'✓':rated==='stuck'?'↻':'–';li.append(m);}
  }else li.append(document.createElement('i'));rows.append(li);
 });
}
let tick=0;
let openedAt=0;
async function poll(){
 if(!source||requestPending)return;requestPending=true;const token=session, serial=issued;
 try{
  const data=await media('status',{tracks:phase==='watch'&&!lines.length&&tick++%3===0});if(token!==session||issued!==serial)return;
  const changed=!snap||snap.ready!==data.ready||snap.paused!==data.paused||snap.site!==data.site;snap=data;
  if(!data.ready){if(changed)draw();if(Date.now()-openedAt>15000)notice('等待正片。可在原站画面中播放、登录或处理站点提示。');return;}
  if(changed){notice();draw();}
  if(data.title && source.title===source.url){source.title=data.title;el('source').textContent=data.title;const r=entry();if(r){r.title=data.title;save();}}
  if((data.cues?.length??0)>=2 && !lines.length && phase==='watch')setLines(data.cues!);
  el('position').textContent=formatTime(data.position);el('duration').textContent=formatTime(data.duration);el<HTMLProgressElement>('progress').value=data.position/data.duration;
  if(phase==='watch'&&lines.length){const line=lines.find(s=>s.startMs<=data.position&&s.endMs>data.position);el('caption').textContent=line?.text??'';}
  if(data.result?.run===run&&['answer','prompt'].includes(phase)){
   if(data.result.state==='finished'){if(phase==='answer')questions[index].revealed=true;phase=phase==='answer'?'rate':'wait';draw();}
   if(data.result.state==='interrupted'){phase='retry';draw();}
  }
 }catch(e){if(token===session){notice(message(e));}}
 finally{requestPending=false;}
}
cards();setInterval(()=>void poll(),220);
