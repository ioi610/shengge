export type Mode = 'listen' | 'shadow' | 'cue' | 'done' | 'review';
export type State = 'READY'|'SEEKING'|'PLAYING'|'COMMITTING'|'GAP'|'PAUSED'|'INTERRUPTED'|'PRACTICE_DONE'|'WAIT_ANSWER'|'WAIT_RATING'|'ERROR';
// showJapanese is the legacy persisted name for the language-neutral subtitle toggle.
// Keep it compatible with existing records; the UI calls it “显示字幕”.
export type Settings = {targetDefault:number;rate:number;listenGapMs:number;shadowGap:{type:'auto'|'fixed'|'manual';ms?:number};nextPolicy:'auto'|'manual';showJapanese:boolean};
export type Segment = {id:string;revision:number;startMs:number;endMs:number;text?:string;englishText?:string;confidence?:number;language?:string;source:'manual'|'demo'|'platform'|'asr'|'vad'|'turn';onsetVerified?:boolean;onsetVersion?:number;previousStartMs?:number;overlapConfirmed?:boolean};
export type Progress = {count:number;target:number;reason?:'target'|'early';skipped?:boolean};
export type Question = {id:string;cueId:string;targetId:string;revealed:boolean;rating?:'can'|'stuck'|'skip'};
export type Clip = {id:string;videoKey:string;url:string;title:string;name:string;durationMs:number;sourceExhausted?:boolean;subtitleFingerprint?:string;segments:Segment[];progress:Record<string,Progress>;settings:Settings;questions:Question[];current:number;mode:Mode;practiceIds?:string[];history?:{endedAt:string;progress:Record<string,Progress>;questions:Question[]}[];revision:number;createdAt:string;updatedAt:string};
export class AppError extends Error { constructor(public code:string,message:string=code){super(message);} }
export const uid=()=>crypto.randomUUID();
export const defaults=():Settings=>({targetDefault:20,rate:1,listenGapMs:1000,shadowGap:{type:'auto'},nextPolicy:'auto',showJapanese:true});
export const shadowSettings=(settings:Settings):Settings=>({...settings,rate:1,listenGapMs:1000,shadowGap:{type:'auto'},nextPolicy:'auto'});
export function validateSettings(s:Settings){if(!s||!Number.isInteger(s.targetDefault)||s.targetDefault<1||s.targetDefault>100||!Number.isFinite(s.rate)||s.rate<0.1||s.rate>4||!Number.isInteger(s.listenGapMs)||s.listenGapMs<0||s.listenGapMs>10000||!['auto','manual'].includes(s.nextPolicy)||!['auto','fixed','manual'].includes(s.shadowGap?.type)||typeof s.showJapanese!=='boolean')throw new AppError('INVALID_REQUEST');if(s.shadowGap.type==='fixed'&&(!Number.isInteger(s.shadowGap.ms)||s.shadowGap.ms!<1000||s.shadowGap.ms!>30000))throw new AppError('INVALID_REQUEST');}
export function validateSegments(segments:Segment[],duration:number){if(!Number.isFinite(duration)||duration<=0||segments.length<1||segments.length>5000)throw new AppError('INVALID_INTERVAL');const ids=new Set<string>();for(const s of segments){if(typeof s.id!=='string'||ids.has(s.id)||!Number.isInteger(s.revision)||s.revision<1||!Number.isInteger(s.startMs)||!Number.isInteger(s.endMs)||s.startMs<0||s.startMs>=s.endMs||s.endMs>duration||s.text&&s.text.length>2000)throw new AppError('INVALID_INTERVAL');ids.add(s.id);}let lastEnd=-Infinity,unconfirmedEnd=-Infinity;for(const s of [...segments].sort((a,b)=>a.startMs-b.startMs)){if((s.overlapConfirmed?unconfirmedEnd:lastEnd)>s.startMs)throw new AppError('OVERLAP_CONFIRM');lastEnd=Math.max(lastEnd,s.endMs);if(!s.overlapConfirmed)unconfirmedEnd=Math.max(unconfirmedEnd,s.endMs);}}
export const overlap=(a:Segment,b:Segment)=>a.startMs<b.endMs&&b.startMs<a.endMs;
export const safeCue=(segments:Segment[])=>segments.length>=2&&segments.every((s,i)=>i===0||segments[i-1].endMs<=s.startMs);
export function splitCues(cues:Segment[],start:number,end:number){return cues.filter(c=>c.endMs>start&&c.startMs<end).map(c=>({...c,id:uid(),startMs:Math.max(start,c.startMs),endMs:Math.min(end,c.endMs)})).filter(c=>c.endMs>c.startMs);}
export function createClip(data:Pick<Clip,'videoKey'|'url'|'title'|'durationMs'|'segments'>,name='未命名片段',demo=false):Clip{validateSegments(data.segments,data.durationMs);const settings=defaults();if(demo)settings.targetDefault=3;const now=new Date().toISOString();return {...data,id:uid(),name:name.trim().slice(0,80)||'未命名片段',settings,progress:Object.fromEntries(data.segments.map(s=>[s.id,{count:0,target:settings.targetDefault}])),questions:[],current:0,mode:'listen',revision:1,createdAt:now,updatedAt:now};}
export function questionsFor(c:Clip):Question[]{if(!safeCue(c.segments))throw new AppError('BOUNDARY_UNSAFE');return c.segments.slice(1).map((s,i)=>({id:uid(),cueId:c.segments[i].id,targetId:s.id,revealed:false}));}
export const complete=(p:Progress)=>Boolean(p.reason)&&!p.skipped;
export const clipComplete=(c:Clip)=>c.segments.every(s=>complete(c.progress[s.id]));
export function videoPracticeComplete(c:Clip){
 const streaming=c.segments.every(s=>s.source==='turn'||s.source==='vad');
 const last=c.segments.at(-1);
 return clipComplete(c)&&(!streaming||c.sourceExhausted===true||!!last&&last.endMs>=c.durationMs-100);
}

export function results(c:Clip){const rated=c.questions.filter(q=>q.revealed&&(q.rating==='can'||q.rating==='stuck'));const can=rated.filter(q=>q.rating==='can').length;return {completed:c.segments.filter(s=>complete(c.progress[s.id])).length,can,rated:rated.length,total:c.questions.length,stuck:rated.filter(q=>q.rating==='stuck').length,skipped:c.questions.filter(q=>q.rating==='skip').length,percent:rated.length?Math.round(can/rated.length*100):null};}
export function gapMs(s:Segment,settings:Settings,mode:Mode){if(mode==='listen')return settings.listenGapMs;if(settings.shadowGap.type==='manual')return null;if(settings.shadowGap.type==='fixed')return settings.shadowGap.ms!;return Math.min(10000,Math.max(2000,(s.endMs-s.startMs)/settings.rate));}
export function estimateMs(segments:Segment[],settings:Settings,mode:Mode,progress?:Clip['progress']){return segments.reduce((sum,s)=>{const p=progress?.[s.id];const r=p?.reason?0:Math.max(0,(p?.target??settings.targetDefault)-(p?.count??0));const d=(s.endMs-s.startMs)/settings.rate;const g=gapMs(s,settings,mode)??0;return sum+r*d+(mode==='shadow'?r:Math.max(0,r-1))*g;},0);}
export function formatTime(ms:number,precise=false){const whole=Math.floor(Math.max(0,ms));const seconds=Math.floor(whole/1000);const base=`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;return precise?`${base}.${Math.floor(whole/100)%10}`:base;}
export function resolveSource(input:string){
 let u:URL;try{u=new URL(input.trim());}catch{throw new AppError('INVALID_URL');}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new AppError('INVALID_URL');
 const host=u.hostname.toLowerCase();
 if(['bilibili.com','www.bilibili.com','m.bilibili.com'].includes(host)){
  const pathname=u.pathname.replace(/^\/(?:zh-Hans|zh-Hant|en)(?=\/(?:video|bangumi)\/)/i,'');
  const episode=pathname.match(/^\/bangumi\/play\/(ep[1-9]\d*)\/?$/);
  if(episode){const id=episode[1];return {videoKey:`bilibili:${id}`,id,url:`https://www.bilibili.com/bangumi/play/${id}`,platform:'bilibili' as const,route:'original' as const};}
  const match=pathname.match(/^\/video\/(BV[a-zA-Z0-9]{10}|av[1-9]\d*)\/?$/);
  const part=u.searchParams.get('p')??'1';
  if(!match||!/^([1-9]\d*)$/.test(part)||!Number.isSafeInteger(Number(part))||u.searchParams.getAll('p').length>1)throw new AppError('INVALID_URL');
  const id=match[1],page=Number(part);
  return {videoKey:`bilibili:${id}:p${page}`,id,url:`https://www.bilibili.com/video/${id}/${page===1?'':`?p=${page}`}`,platform:'bilibili' as const,route:'original' as const};
 }
 let id:string|null=null;
 if(host==='youtu.be')id=u.pathname.slice(1).split('/')[0];
 else if(['youtube.com','www.youtube.com','m.youtube.com'].includes(host))id=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)\/?$/)?.[1]??null;
 else throw new AppError('UNSUPPORTED_SOURCE');
 if(!id||!/^[a-zA-Z0-9_-]{11}$/.test(id))throw new AppError('INVALID_URL');
 return {videoKey:`youtube:${id}`,id,url:`https://www.youtube.com/watch?v=${id}`,platform:'youtube' as const,route:'original' as const};
}
export const errors:Record<string,string>={MEDIA_TIMEOUT:'教学视频加载超时，请重试。',MEDIA_UNAVAILABLE:'教学视频无法加载，请检查演示资源后重试。',OPERATION_CANCELLED:'定位已取消，请重新播放。',UPGRADE_BLOCKED:'请关闭其他声格页面，再刷新以升级本地记录。',INVALID_URL:'链接格式不正确，请粘贴完整的视频网址。',UNSUPPORTED_SOURCE:'这个平台尚未适配。目前支持 YouTube 和哔哩哔哩视频页。',INVALID_INTERVAL:'请检查区间边界与视频时长。',OVERLAP_CONFIRM:'区间有重叠，需要确认；重叠区间不能用于接话。',BOUNDARY_UNSAFE:'请先消除区间重叠，至少保留两句。',SESSION_OWNED:'另一个页面正在练习此视频。',STALE_BINDING:'播放器或会话已变更，请重新连接。',STALE_EPOCH:'记录已被删除或清空，请返回记录页。',REVISION_CONFLICT:'记录已在其他页面更新，请重新打开。',STORAGE_FAILED:'保存失败，请重试保存。',QUOTA_EXCEEDED:'本地空间不足，请删除不需要的记录。',PROTOCOL_MISMATCH:'网页与扩展版本不一致，请更新扩展。',DISCONNECTED:'扩展未连接，请先加载扩展后重连。',SEEK_TIMEOUT:'定位失败，请重试。',CAPABILITY_LOST:'播放被中断，请确认正片可播放后继续。',VIDEO_CHANGED:'视频已切换，请重新点击扩展连接。',INVALID_REQUEST:'请求无效，请重新打开。',ACCESS_REQUIRED:'请先在原站确认登录及播放状态。'};
export const message=(e:unknown)=>e instanceof Error?(errors[(e as AppError).code]??e.message):'操作失败，请重试。';
export function cueFingerprint(cues:Segment[]):string{const normalized=cues.map(c=>[c.startMs,c.endMs,c.text??'']).sort((a,b)=>Number(a[0])-Number(b[0])||Number(a[1])-Number(b[1]));let hash=2166136261;for(const char of JSON.stringify(normalized)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return `jp-${(hash>>>0).toString(16)}`;}
