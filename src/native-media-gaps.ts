type Gap={from:number;to:number;end:number;next:number};
/** Remember only an observed native jump to a real next buffered range. A
 * replay may cross that same missing timestamp range without being a user
 * seek. This object never seeks or extends a playback boundary. */
export class NativeMediaGaps {
 private observed:Gap[]=[];
 private shortStart?:{start:number;end:number;next:number};
 rememberShortStart(ranges:TimeRanges|undefined,from:number,to:number,start:number){
  if(!ranges||![from,to,start].every(Number.isFinite)||from<start||from-start>150||to-from<1000||to-from>2400)return false;
  for(let i=1;i<ranges.length;i++){
   const end=ranges.end(i-1)*1000,next=ranges.start(i)*1000;
   if(next<=end||next-end>1000||Math.abs(next-to)>20||end-from<300||end-from>1600||start<ranges.start(i-1)*1000)continue;
   if(this.shortStart?.start===start && this.shortStart.next===next)return false;
   this.shortStart={start,end,next};return true;
  }
  return false;
 }
 replayStart(ranges:TimeRanges|undefined,start:number,end:number){
  const known=this.shortStart;
  if(!ranges||!known||known.start!==start||known.next>=end)return start;
  for(let i=1;i<ranges.length;i++)if(Math.abs(ranges.start(i)*1000-known.next)<=20 && Math.abs(ranges.end(i-1)*1000-known.end)<=20)
   return Math.max(ranges.start(i-1)*1000,0,start-1600);
  return start;
 }
 private gap(ranges:TimeRanges|undefined,from:number,to:number):Gap|undefined{
  if(!ranges||![from,to].every(Number.isFinite)||to<=from||to-from>1500)return;
  for(let i=1;i<ranges.length;i++){
   const end=ranges.end(i-1)*1000,next=ranges.start(i)*1000;
   if(next>end&&next-end<=1000&&Math.abs(to-next)<=20&&from>=end-800&&from<=end+20&&(to-from<=1000||end-from<=600))return {from,to,end,next};
  }
 }
 observe(ranges:TimeRanges|undefined,from:number,to:number){
  const gap=this.gap(ranges,from,to);if(!gap)return;
  if(this.observed.some(old=>Math.abs(old.next-gap.next)<=20))return;
  this.observed.push(gap);if(this.observed.length>16)this.observed.shift();
 }
 matches(ranges:TimeRanges|undefined,from:number,to:number){
  const gap=this.gap(ranges,from,to);if(!gap)return false;
  const early=this.shortStart;
  if(early && Math.abs(early.end-gap.end)<=20 && Math.abs(early.next-gap.next)<=20 &&
     from>=early.start+400 && from>=gap.end-600){
   this.observe(ranges,from,to);
   return true;
  }
  return this.observed.some(old=>{
   if(Math.abs(old.to-to)>20 || Math.abs(old.end-gap.end)>20 || Math.abs(old.next-gap.next)>20)return false;
   // Bilibili can start correcting earlier on replay of a wider hole. The
   // extra tolerance is bounded by the measured hole and only goes earlier.
   const lead=old.from-from;
   return lead>=-200 && lead<=Math.max(200,Math.min(600,gap.next-gap.end));
  });
 }
}
