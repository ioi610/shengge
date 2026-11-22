import type {VisualTurn} from './visual-turns';
/** Metadata only, owned by one uninterrupted detect() call. A later confirmed
 * source may rescue closed, already-heard print from the preceding window.
 * Retention is bounded by the existing 45-second recognition horizon. */
export class UnconfirmedVisualTurns {
 private lines:VisualTurn[]=[];
 private generation=0;
 constructor(private floor:number){}
 get epoch(){return this.generation;}
 clear(){this.lines=[];this.generation++;}
 private prune(now:number){this.lines=this.lines.filter(line=>line.endMs>this.floor&&line.endMs>=now-45000);}
 remember(lines:VisualTurn[],now:number,epoch=this.generation){
  if(epoch!==this.generation)return;
  this.prune(now);
  for(const line of lines){
   if(!Number.isFinite(line.startMs)||!Number.isFinite(line.endMs)||line.endMs<=Math.max(this.floor,line.startMs)||line.endMs>now||line.endMs<now-45000)continue;
   const startMs=Math.max(this.floor,line.startMs);
   if(this.lines.some(prior=>prior.startMs===startMs&&prior.endMs===line.endMs&&prior.text===line.text))continue;
   this.lines.push({...line,startMs});
  }
  this.lines.sort((a,b)=>a.startMs-b.startMs);
  // Preserve the earliest unsubmitted lines. Dropping an older line in favour
  // of a newer one would recreate the omission this queue is meant to avoid.
  this.lines=this.lines.slice(0,12);
 }
 earliestBefore(nextStart:number,now:number){
  this.prune(now);
  return this.lines.find(line=>line.endMs<=nextStart);
 }
}
