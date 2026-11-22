import {closedSpeakerTurns,type SpeakerFrame,type TurnDecision} from './speaker-turns';

/** Retain voice corroborated by two advancing windows before later context
 * dilutes it. Speaker channel IDs are deliberately not compared across runs.
 * This secondary path only closes at an acoustic pause, not a speaker change. */
export class CorroboratedTurns {
 private previous=new Set<number>();private confirmed=new Set<number>();private witness=-Infinity;
 discardBefore(ms:number){for(const set of [this.previous,this.confirmed])for(const i of set)if((i+1)*32<=ms)set.delete(i);}
 observe(frames:SpeakerFrame[],observedEnd:number,ended=false):TurnDecision[]{
  const witness=frames.at(-1)?.atMs??-Infinity;
  if(witness-this.witness<128&&!ended)return [];
  if(witness-this.witness>=128){
   this.witness=witness;const strong=new Set<number>();
   for(const f of frames){const i=Math.floor(f.atMs/32);if(f.speaker>=0&&f.confidence>=.85)strong.add(i);}
   for(const i of strong)if(this.previous.has(i))this.confirmed.add(i);
   this.previous=strong;
  }
  for(const i of this.confirmed)if(i*32<observedEnd-10000)this.confirmed.delete(i);
  const bins=[...this.confirmed].sort((a,b)=>a-b),groups:number[][]=[];
  for(const i of bins){const last=groups.at(-1);if(!last||i-last.at(-1)!>10)groups.push([i]);else last.push(i);}
  const turns:TurnDecision[]=[];const candidates=closedSpeakerTurns(frames,observedEnd,ended);
  for(const [index,group] of groups.entries()){
   let a=group[0]*32,b=(group.at(-1)!+1)*32;
   for(const f of frames)if(f.speaker>=0&&f.confidence>=.55&&f.atMs>=a-160&&f.atMs<=b+160){a=Math.min(a,f.atMs);b=Math.max(b,f.atMs+32);}
   // Leave close/overlapping replies to the original speaker-change path.
   // A quiet-tail margin must not swallow the next confirmed voice.
   const next=groups[index+1]?.[0];if(next!==undefined&&next*32-b<1100)continue;
   if(group.length<5||b-a>8000||observedEnd-(group.at(-1)!+1)*32>2500||!ended&&observedEnd-b<1100)continue;
   const startMs=Math.max(0,a-160),endMs=Math.min(observedEnd,b+320);
   // Confirm with the strong core, but retain a nearby weak opening from the
   // original candidate. It may contain the first word, not merely music.
   const lead=candidates.find(t=>t.startMs<startMs&&startMs-t.startMs<=1400&&t.endMs>=a+160&&t.endMs<=endMs+640);
   turns.push({startMs,endMs,reason:'turn-end',confidence:.85,...(lead?{leadingStartMs:lead.startMs}:{})});
  }
  return turns;
 }
}
