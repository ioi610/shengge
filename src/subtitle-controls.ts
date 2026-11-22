import {button,field,h,text} from './dom';
import {readableSubtitleTracks,SubtitleTrack} from './subtitles';

export function subtitleControls<T extends SubtitleTrack>(tracks:ReturnType<typeof readableSubtitleTracks<T>>,subtitle:ReturnType<typeof readableSubtitleTracks<T>>[number]|undefined,apply:(track:T|null)=>void){
 const controls=h('div',{class:'subtitle-source'});
 if(!tracks.length){controls.hidden=true;return controls;}
 const picker=h('select',{'aria-label':'字幕轨道',value:subtitle?String(tracks.indexOf(subtitle)):'manual'},...tracks.map((item,i)=>h('option',{value:String(i),dir:'auto'},item.label)),h('option',{value:'manual'},'语音停顿分句（不使用字幕）'));
 controls.append(field('字幕轨道',picker),button('应用字幕选择',()=>apply(picker.value==='manual'?null:tracks[Number(picker.value)].track),'soft small'),text(`当前：${subtitle?.label??'语音停顿分句'}。切换字幕后可从当前播放位置开始练习。`,'muted'));
 return controls;
}
