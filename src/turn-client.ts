import type {AsrTransport} from './local-asr-client';
import type {TurnAnalyzer} from './turn-model';
export class RemoteTurnModel implements TurnAnalyzer {
 constructor(private transport:AsrTransport){void transport('turn-prepare').catch(()=>{});}
 async analyze(samples:Float32Array,offsetMs:number,ended=false){
  const bytes=new Uint8Array(samples.buffer,samples.byteOffset,samples.byteLength);let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return this.transport('turn-analyze',{samples:btoa(binary),offsetMs,ended});
 }
 dispose(){void this.transport('turn-release').catch(()=>{});}
}
