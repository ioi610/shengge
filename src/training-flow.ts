import {Clip,Mode,State,complete,safeCue} from './domain';
export function afterPractice(clip:Clip,mode:Mode,state:State,searchMore:boolean,restricted=false):'discover'|'cue'|undefined {
 if(state!=='PRACTICE_DONE'||!['listen','shadow'].includes(mode)||restricted||clip.settings.nextPolicy!=='auto')return;
 if(!clip.segments.every(s=>complete(clip.progress[s.id])||clip.progress[s.id].skipped))return;
 if(searchMore)return 'discover';
 return safeCue(clip.segments)?'cue':undefined;
}
/** Stop a real-site prompt before the target's first sound, even for adjoining cues. */
export function promptEnd(start:number,end:number,targetStart:number,formal:boolean){
 const guarded=Math.min(end,targetStart-(formal?250:0));
 if(guarded<=start)throw new Error('提示句与答案距离过近，无法独立播放。请先重新识别边界。');
 return guarded;
}
