import {BackgroundCaptions} from '../src/background-captions';
import {extensionAsr} from '../src/local-asr-client';
import {prepareRecognition} from '../src/recognition-ready';
import {isDialogueText} from '../src/sentence-confirmation';
import {SourceLanguage} from '../src/source-language';

import {PlaybackSubtitleTimeline} from './playback-subtitle-timeline';
type Batch={pcm:Float32Array;start:number;rate:number;epoch:number};

// Ordinary playback listens to a copy of the element's audio. Practice owns
// seeking and sentence boundaries, so this reader never controls the video.
export class LivePlaybackCaptions {
 private abort=new AbortController();
 private decoder=new BackgroundCaptions(extensionAsr);
 private language=new SourceLanguage();
 private stream?:MediaStream;
 private context?:AudioContext;
 private node?:AudioWorkletNode;
 private frames:Float32Array[]=[];
 private pending:Batch[]=[];
 private ready=false;
 private overlap=0;
 private lastEnd=0;
 private rate=1;
 private decoding=false;
 private epoch=0;
 status='正在准备自动字幕…';
 constructor(private video:HTMLVideoElement,private selectedLanguage:()=>string|undefined,private timeline=new PlaybackSubtitleTimeline()){
  const signal=this.abort.signal;
  for(const event of ['pause','waiting','ratechange','ended'])video.addEventListener(event,()=>this.collect(true),{signal});
  for(const event of ['seeking','emptied']){
   video.addEventListener(event,()=>this.reset(),{signal});
  }
  void this.start().catch(error=>{
   if(!signal.aborted){this.status=error instanceof Error?error.message:'当前视频无法识别字幕';this.release();}
  });
 }
 private async start(){
  const signal=this.abort.signal,video=this.video as HTMLVideoElement&{captureStream?:()=>MediaStream};
  if(!video.captureStream)throw Error('当前视频不支持音轨识别');
  const context=this.context=new AudioContext({sampleRate:16000});
  await context.resume();signal.throwIfAborted();
  const stream=this.stream=video.captureStream();
  stream.getVideoTracks().forEach(t=>t.stop());
  if(!stream.getAudioTracks().length)throw Error('当前视频没有可读取的音轨');
  await context.audioWorklet.addModule(chrome.runtime.getURL('vad/vad.worklet.bundle.min.js'));signal.throwIfAborted();
  const source=context.createMediaStreamSource(stream);
  const node=this.node=new AudioWorkletNode(context,'vad-helper-worklet',{channelCount:1,channelCountMode:'explicit',processorOptions:{frameSamples:1600}});
  node.port.onmessage=event=>{
   if(event.data.message!=='AUDIO_FRAME'||video.paused||video.seeking||video.readyState<3)return;
   this.lastEnd=video.currentTime;this.rate=video.playbackRate;
   this.frames.push(new Float32Array(event.data.data));
   // Longer contiguous jobs allow a busy decoder to catch up without
   // replacing the earlier audio. Each frame is 100 ms at 16 kHz.
   if(this.frames.length>=(this.pending.length?160:40))this.collect(false);
  };
  source.connect(node);node.connect(context.destination);
  await prepareRecognition(extensionAsr,signal,info=>{this.status=info;});signal.throwIfAborted();
  this.ready=true;this.status='正在自动识别对白';void this.decode();
 }
 private collect(flush:boolean){
  if(this.frames.length>this.overlap){
   const pcm=new Float32Array(this.frames.length*1600);
   this.frames.forEach((frame,i)=>pcm.set(frame,i*1600));
   if(pcm.some(sample=>Math.abs(sample)>.0001)){
    this.pending.push({pcm,start:this.lastEnd-pcm.length/16000*this.rate,rate:this.rate,epoch:this.epoch});
   }
  }
  this.frames=flush?[]:this.frames.slice(-10);this.overlap=this.frames.length;
  void this.decode();
 }
 private async decode(){
  if(!this.ready||this.decoding)return;
  this.decoding=true;
  try{while(this.pending.length&&!this.abort.signal.aborted){
   const {pcm,start,rate,epoch}=this.pending.shift()!;
   const result=await this.decoder.transcribe(pcm,this.selectedLanguage()??this.language.language,60000,false);
   if(!result||this.abort.signal.aborted)continue;
   const duration=pcm.length/16;
   for(const row of [...result.segments].sort((a,b)=>a.startMs-b.startMs)){
    const minimum=row.timing==='aligned'&&row.words?.length ? .45 : .6;
    if(!isDialogueText(row.text)||(row.confidence??0)<minimum)continue;
    const from=Math.max(0,row.startMs),to=Math.min(duration,row.endMs);
    if(!(to>from))continue;
    const line={text:row.text.trim(),start:Math.max(0,start+from/1000*rate),end:start+to/1000*rate};
    if(line.end<=line.start)continue;
    this.language.observe(line.text,result.language);this.timeline.add(line,epoch===this.epoch);
   }
  }}finally{this.decoding=false;}
 }
 get hasLines(){return this.timeline.hasLines;}
 text(){return this.timeline.text(this.video.currentTime,performance.now()/1000);}
 private reset(){
  if(!this.abort.signal.aborted)this.collect(true);
  this.epoch++;this.frames=[];this.overlap=0;this.timeline.seek();
 }
 private release(){this.node?.port.close();this.node?.disconnect();this.stream?.getTracks().forEach(t=>t.stop());if(this.context?.state!=='closed')void this.context?.close().catch(()=>{});}
 dispose(){this.abort.abort();this.reset();this.decoder.dispose();this.release();}
}
