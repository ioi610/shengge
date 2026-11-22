import type {SpeakerFrame} from './speaker-turns';
/** PCM-relative evidence. Capture time and previous sentence end are not loop starts. */
export class SpeechOnset {
 private vad:number[]=[];
 private voice=new Map<number,{hits:number;seen:number}>();
 private tails=new Map<number,{hits:number;seen:number}>();
 private reviewVoice=new Map<number,{hits:number;seen:number}>();
 private strongVoice=new Map<number,{hits:number;seen:number}>();
 private continuationVoice=new Map<number,{bits:number;seen:number}>();
 private sustainedVoice=new Map<number,{bits:number;seen:number}>();private lastWitness=-Infinity;
 private corroboratedVoice=new Set<number>();private previousVoice=new Set<number>();
 private corroboratedStrong=new Set<number>();private previousStrong=new Set<number>();private lastStrongWitness=-Infinity;
 private latestVoice=new Set<number>();private latestEnd=-Infinity;
 push(probability:number){this.vad.push(probability);}
 observe(frames:SpeakerFrame[]){
  this.latestEnd=frames.at(-1)?.atMs??-Infinity;this.latestVoice=new Set<number>();
  for(const f of frames)if(f.speaker>=0&&f.confidence>=.5)this.latestVoice.add(Math.floor(f.atMs/32));
  const bins=new Map<number,boolean>();
  for(const f of frames){const i=Math.floor(f.atMs/32);bins.set(i,(bins.get(i)??false)||(f.speaker>=0&&f.confidence>=.7));}
  for(const [i,speech] of bins){const old=this.voice.get(i)??{hits:0,seen:0};this.voice.set(i,{hits:old.hits+Number(speech),seen:old.seen+1});}
  const tails=new Map<number,boolean>();for(const f of frames){const i=Math.floor(f.atMs/32);tails.set(i,(tails.get(i)??false)||(f.speaker>=0&&f.confidence>=.6));}
  for(const [i,speech]of tails){const old=this.tails.get(i)??{hits:0,seen:0};this.tails.set(i,{hits:old.hits+Number(speech),seen:old.seen+1});}
  const review=new Map<number,boolean>();for(const f of frames){const i=Math.floor(f.atMs/32);review.set(i,(review.get(i)??false)||(f.speaker>=0&&f.confidence>=.45));}
  for(const [i,speech]of review){const old=this.reviewVoice.get(i)??{hits:0,seen:0};this.reviewVoice.set(i,{hits:old.hits+Number(speech),seen:old.seen+1});}
  const strongWitness=frames.at(-1)?.atMs??-Infinity;
  if(strongWitness-this.lastStrongWitness>=128){
   this.lastStrongWitness=strongWitness;
   const current=new Set<number>(),voice=new Set<number>();
   for(const f of frames)if(f.speaker>=0){if(f.confidence>=.85)current.add(Math.floor(f.atMs/32));if(f.confidence>=.7)voice.add(Math.floor(f.atMs/32));}
   for(const i of current)if(this.previousStrong.has(i))this.corroboratedStrong.add(i);
   this.previousStrong=current;
   for(const i of voice)if(this.previousVoice.has(i))this.corroboratedVoice.add(i);
   this.previousVoice=voice;
   const covered=new Set(frames.map(f=>Math.floor(f.atMs/32)));
   for(const i of covered){const old=this.continuationVoice.get(i)??{bits:0,seen:0};this.continuationVoice.set(i,{bits:((old.bits<<1)|Number(voice.has(i)))&15,seen:Math.min(4,old.seen+1)});}
  }
  const strong=new Map<number,boolean>();for(const f of frames){const i=Math.floor(f.atMs/32);strong.set(i,(strong.get(i)??false)||(f.speaker>=0&&f.confidence>=.85));}
  for(const [i,speech]of strong){const old=this.strongVoice.get(i)??{hits:0,seen:0};this.strongVoice.set(i,{hits:old.hits+Number(speech),seen:old.seen+1});}
  const witness=frames.at(-1)?.atMs??-Infinity;
  if(witness-this.lastWitness>=128){
   this.lastWitness=witness;
   // Incomplete early windows are provisional. Six recent independent
   // observations can corroborate a quiet reply without being diluted by
   // every earlier low-confidence estimate for that same audio.
   const recent=new Map<number,boolean>();for(const f of frames){const i=Math.floor(f.atMs/32);recent.set(i,(recent.get(i)??false)||(f.speaker>=0&&f.confidence>=.5));}
   for(const [i,speech]of recent){const old=this.sustainedVoice.get(i)??{bits:0,seen:0};this.sustainedVoice.set(i,{bits:((old.bits<<1)|Number(speech))&63,seen:Math.min(6,old.seen+1)});}
  }
 }
 /** A recent independent view can veto an early pause while voice continues.
  * It cannot create a sentence or merge replies across an explicit speaker change. */
 ongoingVoice(afterMs:number,observedEnd:number){
  if(observedEnd-this.latestEnd>384)return false;
  const voiced=[...this.latestVoice];
  if(voiced.filter(i=>i*32>=Math.max(afterMs,observedEnd-384)&&i*32<=observedEnd).length<4)return false;
  let tail=Math.max(0,afterMs-320);
  for(const i of voiced){const at=i*32;if(at<tail||at>observedEnd)continue;if(at-tail>=950)return false;tail=at+32;}
  return tail>=observedEnd-384;
 }
 /** A turn candidate is an acoustic interval, not a DTW first-word anchor.
  * A quiet prefix may precede corroborated voice. Preserve that prefix rather
  * than vetoing the whole turn. Repeated strong speaker evidence can also
  * establish stylised speech that VAD consistently under-scores. */
 acousticStart(startMs:number,endMs:number,allowConsensus=true):number|undefined {
  const direct=this.wordStart(startMs,endMs);if(direct!==undefined)return direct;
  const supported=(i:number)=>{const e=this.voice.get(i),strong=this.strongVoice.get(i);return Boolean((this.corroboratedVoice.has(i)||e&&e.seen>=2&&e.hits/e.seen>=.6)&&(this.vad[i]??0)>=.35||strong&&strong.seen>=2&&strong.hits/strong.seen>=.6||this.corroboratedStrong.has(i));};
  const limit=Math.min(endMs,startMs+1200);
  for(let i=Math.max(0,Math.floor(startMs/32));i*32<limit;i++){
   let hits=0;for(let j=i;j<i+9&&j*32<limit;j++)if(supported(j))hits++;
   if(hits>=5)return Math.max(0,startMs-160);
  }
  // Short stylised replies can score near zero on VAD. A sustained region seen as
  // one speaker in four of six advancing windows, including the latest two,
  // is stronger evidence than one moderate score. Early incomplete estimates
  // cannot veto fresh corroboration; alternating noise still cannot qualify.
  // Longer uncorroborated sounds (e.g. slurping) still require text review.
  // This exception is for a nearby short reply, not an isolated weak sound
  // after a long musical lead-in. Those still need a text review.
  if(!allowConsensus||startMs>2500)return;
  // The proposed interval already includes 140ms onset + 100ms endpoint
  // padding and a 32ms capture bin. Keep up to 1200ms of actual short speech.
  for(let i=Math.max(0,Math.floor(startMs/32));endMs-startMs<=1472&&(i+12)*32<=limit;i++){
   let hits=0;for(let j=i;j<i+12;j++){const e=this.sustainedVoice.get(j);if(e&&e.seen===6&&(e.bits&3)===3){let bits=e.bits,count=0;while(bits){bits&=bits-1;count++;}if(count>=4)hits++;}}
   if(hits>=10)return Math.max(0,startMs-160);
  }
 }
 /** A nearby continuation may outlast the short-reply exception. Require
  * stronger recent agreement; this is not available for a cold video start or
  * a voice after a long silent lead-in (the caller enforces continuation). */
 continuationStart(startMs:number,endMs:number):number|undefined {
  if(startMs>320||endMs-startMs>3200||endMs-startMs<1472)return;
  let hits=0;
  for(let i=Math.max(0,Math.floor(startMs/32));i*32<Math.min(endMs,startMs+2800);i++){
   const e=this.continuationVoice.get(i);if(!e||e.seen<4||(e.bits&3)!==3)continue;
   let bits=e.bits,count=0;while(bits){bits&=bits-1;count++;}if(count>=3)hits++;
  }
  if(hits>=10)return Math.max(0,startMs-160);
 }
 /** Moderate repeated speaker evidence requests text review; it cannot itself
  * authorize a loop when the fast acoustic gate rejected the utterance. */
 reviewSupport(startMs:number,endMs:number){
  const bins:number[]=[];for(let i=Math.max(0,Math.floor(startMs/32));i*32<endMs;i++){
   const e=this.reviewVoice.get(i);if(e&&e.seen>=2&&e.hits/e.seen>=.6)bins.push(i);
  }return bins;
 }
 canReview(startMs:number,endMs:number){return this.reviewSupport(startMs,Math.min(endMs,startMs+1200)).length>=5;}
 /** Quiet suffixes often fall below VAD's threshold. Extend an already
  * corroborated utterance through repeated speaker evidence, never trim it. */
 tail(startMs:number,endMs:number){
  let last=endMs,gap=0;for(let i=Math.max(0,Math.floor(startMs/32));i<this.vad.length;i++){
   const e=this.tails.get(i),speech=e&&e.seen>=2&&e.hits/e.seen>=.6;
   if(speech){last=Math.max(last,(i+1)*32+160);gap=0;}
   else if(i*32>=endMs&&(gap+=32)>=320)break;
  }
  return last;
 }
 /** Locate a confirmed first word, rather than searching the whole sentence for
  * any easier-to-detect later vowel. DTW anchors can fall inside a word. */
 wordStart(startMs:number,endMs:number,strongTranscript=false,alignedTranscript=false):number|undefined {
  const anchor=Math.max(0,Math.floor(startMs/32));
  const supported=(i:number)=>{
   const e=this.voice.get(i),p=this.vad[i]??0;
   return Boolean((this.corroboratedVoice.has(i)||e&&e.seen>=2&&e.hits/e.seen>=.6)&&(p>=.35||alignedTranscript));
  };
  // Require support near the first word. A hit two words later cannot justify
  // dropping the beginning; the caller must re-decode instead.
  let near=-1;
  for(let i=Math.max(0,anchor-6);i*32<Math.min(endMs,startMs+320);i++){
   if(supported(i)||(strongTranscript&&(this.vad[i]??0)>=.85)){
    let hits=0;for(let j=i;j<i+7&&j*32<endMs;j++)if(supported(j)||(strongTranscript&&(this.vad[j]??0)>=.85))hits++;
    if(hits>=3){near=i;break;}
   }
  }
  if(near<0)return;
  let first=supported(near)?near:anchor,gap=0;
  // Backtrack only corroborated voice, stopping at a real gap. Never pull
  // uncorroborated music into a loop just because VAD calls it speech.
  for(let i=near-1;i>=Math.max(0,anchor-50);i--){
   if(supported(i)){first=i;gap=0;}else if(++gap>=8)break;
  }
  return Math.max(0,Math.min(startMs-160,first*32-96));
 }

 resolve(startMs:number,endMs:number,strongTranscript=false):number|undefined {
  let first=-1,voiced=0,last=-1;
  for(let i=Math.max(0,Math.floor((startMs-320)/32));i*32<endMs;i++){
   const evidence=this.voice.get(i);
   const probability=this.vad[i]??0;
   // Stable, high-confidence timed words can corroborate VAD when the
   // speaker model misses a shout under a score. The word start still bounds trimming.
   const speech=(evidence&&evidence.seen>=2&&evidence.hits/evidence.seen>=.6&&probability>=.5)||(strongTranscript&&probability>=.85);
   if(speech){if(first<0)first=i;voiced++;last=i;}
   else if(last>=0&&i-last>2){first=-1;voiced=0;last=-1;}
   // Reject short tails and isolated effects; keep the first sustained onset,
   // never jump to a later island just because a speaker pauses mid-sentence.
   if(voiced>=5)return Math.max(startMs-160,first*32-96,0);
  }
 }
}

/** Cross-attention alignment supplies the acoustic word anchor for stylised
 * voices missed by speech classifiers. Still reject silent/empty PCM. */
export function alignedSpeechOnset(samples:ArrayLike<number>,startMs:number,endMs:number){
 const a=Math.max(0,Math.floor(startMs*16)),b=Math.min(samples.length,Math.ceil(endMs*16));
 if(b-a<320)return;
 let energy=0;for(let i=a;i<b;i++)energy+=samples[i]*samples[i];
 if(Math.sqrt(energy/(b-a))<.003)return;
 // DTW is a token attention anchor, often inside its first syllable. Retain
 // a short onset margin, bounded by the current search/previous turn in caller.
 return Math.max(0,startMs-200);
}
