import {Segment, uid} from './domain';

type CueData={startTime:number;endTime:number;text?:string};
export type SubtitleTrack={kind:string;language:string;label:string;mode:string;cues:ArrayLike<CueData>|null};
function trackLabel(track:SubtitleTrack){
 let language=track.language;
 if(language){try{language=new Intl.DisplayNames(['zh-CN'],{type:'language'}).of(language)||language;}catch{/* Keep unrecognized tags selectable. */}}
 return [track.label&&track.label!==track.language?track.label:'',language].filter(Boolean).join(' · ')||'未标注语言';
}
export function readSubtitleCues(track:SubtitleTrack):Segment[]{
 if(!['subtitles','captions'].includes(track.kind)||!track.cues)return [];
 return Array.from(track.cues).filter(c=>Number.isFinite(c.startTime)&&Number.isFinite(c.endTime)&&c.startTime>=0&&c.endTime>c.startTime&&typeof c.text==='string'&&c.text.trim().length>0)
  .map(c=>({id:uid(),revision:1,startMs:Math.round(c.startTime*1000),endMs:Math.round(c.endTime*1000),text:c.text!,source:'platform' as const}))
  .filter(c=>c.endMs>c.startMs).sort((a,b)=>a.startMs-b.startMs||a.endMs-b.endMs);
}
/** Keep each language/track separate: combining translations would duplicate sentences. */
export function readableSubtitleTracks<T extends SubtitleTrack>(tracks:ArrayLike<T>){
 return Array.from(tracks).map((track,index)=>({track,cues:readSubtitleCues(track),label:`${trackLabel(track)} · 轨道 ${index+1}`})).filter(item=>item.cues.length>0);
}
export function preferredSubtitleTrack<T extends {track:{mode:string}}>(tracks:T[]):T|undefined{
 return tracks.find(item=>item.track.mode==='showing')??tracks.find(item=>item.track.mode==='hidden')??tracks[0];
}
