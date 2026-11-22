/** Internal control flow: discard discontinuous PCM and recapture, never save it. */
export class ResumeRecognition extends Error {
 constructor(readonly rewindTo:number,readonly reason:'seek'|'buffer'|'rate'|'capture'){super('自动重新连接音频采集');this.name='ResumeRecognition';}
}

export function waitForStableMedia(video:HTMLMediaElement,signal:AbortSignal){
 return new Promise<void>((resolve,reject)=>{
  let timer:ReturnType<typeof setTimeout>;
  const events=['canplay','loadeddata','seeked','error'];
  const done=(error?:Error)=>{clearTimeout(timer);events.forEach(e=>video.removeEventListener(e,check));signal.removeEventListener('abort',abort);error?reject(error):resolve();};
  const abort=()=>done(new DOMException('已暂停','AbortError'));
  const check=()=>{if(signal.aborted)return abort();if(video.error)return done(new Error('视频加载失败，请等待原站恢复后重试识别。'));if(!video.seeking&&video.readyState>=3)done();};
  events.forEach(e=>video.addEventListener(e,check));signal.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>done(new Error('视频仍在缓冲，已暂停。网络恢复后可点击“重试识别”。')),30000);check();
 });
}

/** Compare two ingress clocks, not media ingress against VAD completion time. */
export function captureDiscontinuity(time:number,previous:number,wall:number,previousWall:number,rate:number){
 return time<previous-80||time-previous>Math.max(0,wall-previousWall)*rate+400;
}

/** A native player may step across a subsecond timestamp/buffer discontinuity.
 * Rewinding before the same step forever cannot recover audio from that gap.
 * Keep existing captured context only for a recent, bounded forward step;
 * multi-second skips and backwards seeks still require full recovery. */
export function smallForwardCorrection(time:number,previous:number,wall:number,previousWall:number,rate:number){
 const elapsed=wall-previousWall,advance=time-previous;
 return [time,previous,wall,previousWall,rate].every(Number.isFinite)&&rate>0&&elapsed>=0&&elapsed<=1000&&advance>=0&&advance<=1000;
}
