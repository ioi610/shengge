/** Keep a practicing video on its original source at EOF. Site players usually
 * attach auto-next to the video's ended event before our toolbar is opened.
 * Capture on its window, then notify our own listeners without redispatching a
 * DOM event (which would run auto-next again). Never truncate the final audio. */
export class MediaEnd extends EventTarget {
 private target:EventTarget;
 constructor(private video:HTMLVideoElement,private valid:()=>boolean,private ownsPlayback:()=>boolean){
  super();this.target=video.ownerDocument?.defaultView??video;
  this.target.addEventListener('ended',this.ended,{capture:true});
 }
 private ended=(event:Event)=>{
  if(event.target!==this.video||!this.valid())return;
  if(this.ownsPlayback())event.stopImmediatePropagation();
  this.dispatchEvent(new Event('ended'));
 };
 dispose(){this.target.removeEventListener('ended',this.ended,{capture:true});}
}
