/** Stamp PCM at ingress, before async inference. Recurrent VAD state must be
 * advanced in capture order, and queued work from an old search is discarded. */
export class CapturedFrames<T> {
 private tail:Promise<void>=Promise.resolve();
 constructor(private current:()=>T|undefined,private position:()=>number,private process:(frame:Float32Array,owner:T,time:number,wall:number)=>Promise<void>,private clock:()=>number=()=>performance.now(),private canAccept:()=>boolean=()=>true){}
 push(frame:Float32Array){
  // A temporary playback hold stops new PCM without revoking the owner of
  // audio already captured before that hold. Session cancellation still
  // changes current(), so queued work cannot cross into another search.
  if(!this.canAccept())return Promise.resolve();
  const owner=this.current(),time=this.position(),wall=this.clock();if(owner===undefined)return Promise.resolve();
  const task=this.tail.then(async()=>{if(this.current()===owner)await this.process(frame,owner,time,wall);});
  this.tail=task.catch(()=>{});return task;
 }
 /** Revoke the current owner before draining. An inference already in flight
  * can still update recurrent model state after its callback is discarded. */
 drain(){return this.tail;}
}
