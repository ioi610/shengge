// The player accepts seeks within 150 ms. That tolerance must not create overlapping records.
export function continueSentence<T extends {startMs:number;endMs:number}>(boundary:T,previousEnd:number):T{
 if(!Number.isFinite(previousEnd)||previousEnd-boundary.startMs>150||boundary.endMs<=previousEnd)throw new Error('自动续句的时间点异常，已暂停，请重新连接播放器。');
 return {...boundary,startMs:Math.max(boundary.startMs,previousEnd)};
}

// Media-time boundaries from streaming speech probabilities, never fixed-length cuts.
export class SpeechBoundary {
 private start?:number;private lastSpeech=0;private voiced=0;private previous?:number;
 constructor(private floor:number,private silenceMs=600){}
 push(time:number,probability:number){
  if(!Number.isFinite(time)||!Number.isFinite(probability))return;
  const delta=this.previous===undefined?32:Math.min(100,Math.max(0,time-this.previous));this.previous=time;
  if(probability>=0.5){if(this.start===undefined)this.start=Math.max(this.floor,time-140);this.lastSpeech=time;this.voiced+=delta;}
  else if(probability>=0.35&&this.start!==undefined)this.lastSpeech=time;
  if(this.start!==undefined&&time-this.lastSpeech>=this.silenceMs){const result=this.finish(time);this.start=undefined;this.voiced=0;return result;}
 }
 finish(limit:number){return this.start!==undefined&&this.voiced>=128?{startMs:Math.round(this.start),endMs:Math.round(Math.min(limit,this.lastSpeech+80))}:undefined;}
}
