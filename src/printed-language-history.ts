import type {Clip,Segment} from './domain';
import {languageCode,languageEvidence} from './source-language';
import type {VisualTurn} from './visual-turns';

type PriorLine=Pick<Segment,'startMs'|'endMs'|'text'|'confidence'|'language'|'source'>;
const normalized=(text:string)=>text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'');
// Records are hints about this particular source. Verify the line against
// newly observed pixels and its timing before using one, even on the same URL.
export function priorPrintedLines(clips:Clip[],key:string,durationMs:number):Segment[] {
 const lines:Segment[]=[];
 for(const clip of clips){
  if(clip.videoKey!==key || Math.abs(clip.durationMs-durationMs)>200)continue;
  const eligible=clip.segments.filter(s=>s.source==='turn' && (s.confidence??0)>=.70 && s.text && languageEvidence(s.text,s.language));
  if(eligible.some(s=>languageCode(s.language)!=='ja') || new Set(eligible.map(s=>normalized(s.text!))).size<2)continue;
  lines.push(...eligible);
 }
 return lines;
}
export function matchesPriorPrint(turn:VisualTurn,lines:PriorLine[]){
 const text=normalized(turn.text);
 if(text.length<4)return false;
 return lines.some(s=>s.text && normalized(s.text)===text &&
  Math.abs(s.startMs-turn.startMs)<1500 && Math.abs(s.endMs-turn.endMs)<1500 &&
  Math.min(s.endMs,turn.endMs)-Math.max(s.startMs,turn.startMs)>.55*(turn.endMs-turn.startMs));
}
