import type {Segment} from '../src/domain';
export function parseSubtitles(text:string):Segment[]{
 const rows:Segment[]=[];
 const clock=(s:string)=>s.replace(',','.').split(':').reduce((v,x)=>v*60+Number(x),0)*1000;
 for(const block of text.replace(/^\uFEFF/,'').replace(/\r/g,'').split(/\n\s*\n/)){
  const parts=block.trim().split('\n'),i=parts.findIndex(s=>s.includes('-->'));if(i<0)continue;
  const m=parts[i].match(/^\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})(?:\s.*)?$/);
  if(!m)throw new Error('字幕时间格式有误。');
  const body=parts.slice(i+1).map(x=>x.replace(/<[^>]*>/g,'').trim()).filter(Boolean);
  if(body.length)rows.push({id:crypto.randomUUID(),revision:1,source:'platform',startMs:Math.round(clock(m[1])),endMs:Math.round(clock(m[2])),text:body[0],englishText:body.slice(1).join(' ')||undefined});
 }
 if(!rows.length)throw new Error('字幕文件里没有可读取的对白。');
 return rows.sort((a,b)=>a.startMs-b.startMs);
}
