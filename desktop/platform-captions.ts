// Bilibili's player exposes its subtitle list per CID (part), not per series.
// Only request captions offered for the loaded video. An empty or inaccessible
// list leaves the native track, subtitle file and manual marking paths available.
import type {Segment} from '../src/domain';
type Track={lan?:string;subtitle_url?:string};
type Line=Pick<Segment,'startMs'|'endMs'|'text'|'englishText'>;
async function json(url:URL,signal:AbortSignal){
 const response=await fetch(url,{credentials:url.host==='api.bilibili.com'?'include':'omit',signal});
 if(!response.ok)throw new Error('字幕暂不可用');
 return response.json();
}
async function trackRows(track:Track,signal:AbortSignal):Promise<Line[]>{
 if(!track.subtitle_url)return [];
 const url=new URL(track.subtitle_url,location.href);
 if(url.protocol!=='https:'||!/(^|\.)(bilibili\.com|hdslb\.com|bilivideo\.com|biliimg\.com)$/.test(url.hostname))return [];
 const data=await json(url,signal);
 if(!Array.isArray(data.body))return [];
 return data.body.slice(0,5000).filter((r:any)=>Number.isFinite(r.from)&&Number.isFinite(r.to)&&r.to>r.from&&r.from>=0&&typeof r.content==='string').map((r:any)=>({startMs:Math.round(r.from*1000),endMs:Math.round(r.to*1000),text:r.content.trim()}));
}
export async function biliLines(key:string,signal:AbortSignal):Promise<Line[]>{
 const match=key.match(/^bilibili:(BV[a-zA-Z0-9]{10}|av\d+):p(\d+)$/);if(!match)return [];
 const view=new URL('https://api.bilibili.com/x/web-interface/view');
 view.searchParams.set(match[1].startsWith('av')?'aid':'bvid',match[1].replace(/^av/,''));
 const metadata=(await json(view,signal)).data;
 const cid=metadata?.pages?.find((p:any)=>p.page===Number(match[2]))?.cid;
 if(!cid)return [];
 const info=new URL('https://api.bilibili.com/x/player/v2');
 info.searchParams.set('aid',String(metadata.aid));info.searchParams.set('cid',String(cid));
 const tracks:Track[]=(await json(info,signal)).data?.subtitle?.subtitles??[];
 const source=tracks.find(t=>/^(ja|jp)/i.test(t.lan??''))??tracks[0];
 if(!source)return [];
 const primary=await trackRows(source,signal);
 const en=tracks.find(t=>t!==source&&/^en/.test(t.lan??''));
 if(en){
  const timings=new Map((await trackRows(en,signal).catch(()=>[])).map(s=>[s.startMs+'-'+s.endMs,s.text]));
  for(const s of primary)s.englishText=timings.get(s.startMs+'-'+s.endMs);
 }
 return primary;
}
