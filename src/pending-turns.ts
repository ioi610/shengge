export type PendingTurn={startMs:number;endMs:number;reason?:'speaker-change'|'turn-end';leadingStartMs?:number;focused?:boolean};
/** A later clear reply must not replace an earlier, still unreviewed utterance. */
export class PendingTurns {
 private turns:PendingTurn[]=[];
 private reviewed:{turn:PendingTurn;through:number}[]=[];
 private sameReviewedAudio(t:PendingTurn,r:PendingTurn,through:number){
  const overlap=Math.min(t.endMs,r.endMs)-Math.max(t.startMs,r.startMs);
  return t.endMs<=through&&Math.abs(t.startMs-r.startMs)<=900&&overlap/Math.min(t.endMs-t.startMs,r.endMs-r.startMs)>=.7;
 }
 wasReviewed(turn:PendingTurn){return this.reviewed.some(r=>this.sameReviewedAudio(turn,r.turn,r.through));}
 add(turn:PendingTurn){
  if(this.wasReviewed(turn))return;
  const existing=this.turns.findIndex(t=>Math.min(t.endMs,turn.endMs)>Math.max(t.startMs,turn.startMs)&&Math.abs(t.startMs-turn.startMs)<=400&&Math.abs(t.endMs-turn.endMs)<=400);
  if(existing>=0)this.turns[existing]=turn;else this.turns.push(turn);
  this.turns.sort((a,b)=>a.startMs-b.startMs||a.endMs-b.endMs);
 }
 get first(){return this.turns[0];}
 firstOtherAudio(active:PendingTurn,sharesHold?:(candidate:PendingTurn)=>boolean){
  // Two streaming estimates can differ by one 512-sample VAD frame while
  // the active review already owns those samples. Leave that estimate queued
  // for fresh evidence, but protect a genuinely separate waiting utterance.
  // A caller may additionally group estimates of one closed printed line for
  // backpressure. This is a nonmutating lookup: no candidate loses its review.
  return this.turns.find(t=>(Math.abs(t.startMs-active.startMs)>32 || Math.abs(t.endMs-active.endMs)>32)&&!sharesHold?.(t));
 }
 shift(){return this.turns.shift();}
 discardThrough(endMs:number){this.turns=this.turns.filter(t=>t.endMs>endMs);}
 /** A refined estimate queued during a slow review must not launch another
  * review of almost the same audio. Preserve adjacent independent replies and
  * materially extended endings, which may contain previously missed words. */
 discardReviewed(reviewed:PendingTurn,coveredThrough=reviewed.endMs+400){
  const through=Math.max(reviewed.endMs,Math.min(reviewed.endMs+960,coveredThrough));
  this.reviewed.push({turn:{...reviewed},through});this.reviewed=this.reviewed.slice(-32);
  this.turns=this.turns.filter(t=>!this.sameReviewedAudio(t,reviewed,through));
 }
}
