export type TurnDecision={startMs:number;endMs:number;reason:'speaker-change'|'turn-end';confidence:number;leadingStartMs?:number;focused?:boolean};
export type SpeakerFrame={atMs:number;speaker:number;confidence:number};
const STEP=16.875;
// Channels are local to one inference window. Never compare channel IDs across windows.
export function decodeSpeakerFrames(scores:ArrayLike<number>,count:number,offsetMs=0):SpeakerFrame[]{
 const frames:SpeakerFrame[]=[];
 for(let i=0;i<count;i++){let best=0;for(let k=1;k<7;k++)if(scores[i*7+k]>scores[i*7+best])best=k;frames.push({atMs:offsetMs+30.96875+i*STEP,speaker:best===0?-1:best<=3?best-1:-2,confidence:Math.exp(scores[i*7+best])});}
 return frames;
}
export function firstSpeakerTurn(frames:SpeakerFrame[],observedEnd:number,ended=false):TurnDecision|undefined{
 // This proposes a boundary; repeated acoustic evidence or aligned text still
 // has to authorize playback. Filtering quiet voice out here prevents either
 // confirmation path from ever seeing the utterance.
 const stable=frames.filter(f=>f.confidence>=.55);let first:number|undefined,start=0,last=0,voice=0,score=0;
 let alternative:number|undefined,alternativeStart=0,alternativeVoice=0,overlap=0;
 for(const f of stable){
  if(f.speaker===-2){overlap+=STEP;continue;}
  if(f.speaker<0)continue;
  // A sustained pause closes the first utterance even if the same speaker
  // has already resumed by the time the detector processes the window.
  if(first!==undefined&&voice>=160&&overlap<200&&f.atMs-last>=950)return {startMs:Math.max(0,start-140),endMs:last+100,reason:'turn-end',confidence:score/(voice/STEP)};
  if(first===undefined){first=f.speaker;start=f.atMs;}
  if(f.speaker===first){last=f.atMs;voice+=STEP;score+=f.confidence;alternative=undefined;alternativeVoice=0;}
  else{
   if(alternative!==f.speaker){alternative=f.speaker;alternativeStart=f.atMs;alternativeVoice=0;}
   alternativeVoice+=STEP;
   if(voice<160&&alternativeVoice>=160){first=alternative;start=alternativeStart;last=f.atMs;voice=alternativeVoice;score=f.confidence*(voice/STEP);alternative=undefined;alternativeVoice=0;continue;}
   if(voice>=160&&alternativeVoice>=180&&overlap<200)return {startMs:Math.max(0,start-140),endMs:Math.min(alternativeStart,last+100),reason:'speaker-change',confidence:score/(voice/STEP)};
  }
 }
 if(voice>=160&&overlap<200&&(ended||observedEnd-last>=950))return {startMs:Math.max(0,start-140),endMs:Math.min(observedEnd,last+100),reason:'turn-end',confidence:score/(voice/STEP)};
 return;
}
export class StableTurn {
 private previous?:TurnDecision;
 accept(current:TurnDecision|undefined){
  if(!current){this.previous=undefined;return;}
  const prior=this.previous;this.previous=current;
  // A one-off channel flip or incomplete trailing audio must not become a saved sentence.
  if(prior&&prior.reason===current.reason&&Math.abs(prior.endMs-current.endMs)<=180)return {...current,startMs:Math.min(prior.startMs,current.startMs)};
 }
}
/** Keep later closed utterances visible while an earlier candidate is being
 * reviewed. Channel identities are compared only inside this inference. */
export function closedSpeakerTurns(frames:SpeakerFrame[],observedEnd:number,ended=false,first=firstSpeakerTurn(frames,observedEnd,ended)){
 const turns:TurnDecision[]=[];let current=first;
 while(current&&turns.length<32){
  turns.push(current);const floor=current.endMs;
  const next=firstSpeakerTurn(frames.filter(f=>f.atMs>=floor),observedEnd,ended);
  if(!next||next.endMs<=floor)break;current=next;
 }
 return turns;
}
export class StableTurns {
 private previous:TurnDecision[][]=[];
 accept(current:TurnDecision[]){
  const accepted=current.flatMap(turn=>{
   const prior=this.previous.flat().find(p=>p.reason===turn.reason&&Math.abs(p.endMs-turn.endMs)<=320&&Math.abs(p.startMs-turn.startMs)<=500&&Math.min(p.endMs,turn.endMs)-Math.max(p.startMs,turn.startMs)>=.75*Math.min(p.endMs-p.startMs,turn.endMs-turn.startMs));
   return prior?[{...turn,startMs:Math.min(prior.startMs,turn.startMs),endMs:Math.max(prior.endMs,turn.endMs)}]:[];
  });
  // One uncertain window need not erase a previously corroborated short reply.
  // Strong temporal overlap prevents neighbouring replies from confirming one another.
  this.previous=[...this.previous.slice(-1),current];return accepted;
 }
}
