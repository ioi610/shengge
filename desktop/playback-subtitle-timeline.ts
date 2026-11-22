type Line={text:string;start:number;end:number};
const normalized=(text:string)=>text.normalize('NFKC').replace(/[\s\p{P}]/gu,'').toLowerCase();

export class PlaybackSubtitleTimeline {
 private lines:Line[]=[];
 private waiting:Line[]=[];
 private showing?:{line:Line;until:number};
 get hasLines(){return this.lines.length>0;}

 revision=0;
 get ordered(){return [...this.lines].sort((a,b)=>a.start-b.start);}
 match(start:number,end:number){
  let best:Line|undefined,score=.55;
  for(const line of this.lines){
   const overlap=Math.min(end,line.end)-Math.max(start,line.start);
   const ratio=overlap/Math.max(end-start,line.end-line.start);
   if(ratio>score){best=line;score=ratio;}
  }
  return best?.text;
 }
 add(line:Line,queue=true){
  const duplicate=this.lines.some(old=>old.start<line.end&&line.start<old.end&&normalized(old.text)===normalized(line.text));
  if(duplicate)return;
  this.lines.push(line);
  if(this.lines.length>5000)this.lines.shift();
  this.revision++;if(queue)this.waiting.push(line);
 }

 text(position:number,clock:number){
  // A seek reuses recognized timing. Late results from a first pass still
  // get a readable turn on screen, including multiple lines in one result.
  if(this.showing&&clock<this.showing.until)return this.showing.line.text;
  const next=this.waiting.shift();
  if(next){
   const duration=Math.min(3,Math.max(1,next.end-next.start,next.text.length*.065));
   this.showing={line:next,until:clock+duration};return next.text;
  }
  this.showing=undefined;return this.at(position);
 }

 at(position:number){
  for(let i=this.lines.length-1;i>=0;i--){
   const line=this.lines[i];if(line.start<=position&&position<line.end)return line.text;
  }
  return '';
 }

 seek(){this.waiting=[];this.showing=undefined;}
}
