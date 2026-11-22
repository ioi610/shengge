import test from 'node:test';
import assert from 'node:assert/strict';
import {StreamingTurns,type TurnAnalyzer,type TurnContext,type SpeakerWindow} from '../src/turn-model';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
for(const rate of [1,2]){
 test(`speaker observations identify shifted input windows and duplicate flushes at rate ${rate}`,async()=>{
  const bufferOrigin=10000,prefixFrames=64,origin=bufferOrigin+prefixFrames*32*rate;
  const context:TurnContext={samples:new Float32Array(prefixFrames*512),times:Array.from({length:prefixFrames},(_,i)=>bufferOrigin+(i+1)*32*rate),origin:bufferOrigin,endMs:origin,rate};
  const inputs:{offset:number;length:number;ended:boolean}[]=[],observations:{focused?:boolean;window?:SpeakerWindow}[]=[];
  const model:TurnAnalyzer={dispose(){},async analyze(pcm,offset,ended=false){inputs.push({offset,length:pcm.length,ended});return {decision:undefined,frames:[],focusedFrames:[]};}};
  const stream=new StreamingTurns(model,origin,rate,()=>{},error=>{throw error;},undefined,(_frames,focused,window)=>observations.push({focused,window}),context);
  for(let i=0;i<330;i++){stream.push(new Float32Array(512),origin+(i+1)*32*rate);await tick();}
  await stream.flush();await stream.flush();await stream.finish();stream.stop();
  assert.equal(observations.length,inputs.length*2);
  for(const [i,input]of inputs.entries()){
   const raw=observations[2*i],focused=observations[2*i+1];
   assert.equal(raw.focused,false);assert.equal(focused.focused,true);
   assert.deepEqual(raw.window,{startMs:bufferOrigin+input.offset*rate,endMs:bufferOrigin+(input.offset+input.length/16)*rate,ended:input.ended,clockAligned:true});
   assert.deepEqual(focused.window,raw.window);
  }
  const raw=observations.filter(o=>!o.focused).map(o=>o.window!);
  const [flushA,flushB,endA,endB]=raw.slice(-4);
  assert.deepEqual(flushA,flushB,'re-decoding the same PCM retains the same window identity');
  assert.equal(endA.ended,true);assert.deepEqual(endA,endB);
  assert.ok(raw.some((window,i)=>i>0&&window.startMs>raw[i-1].startMs&&window.endMs>raw[i-1].endMs),'new rolling windows advance both input edges');
 });
}
for(const correction of ['persistent','opposing-middle-steps'] as const)test(`a ${correction} media correction invalidates late evidence despite matching window duration`,async()=>{
 const observed:SpeakerWindow[]=[];
 const model:TurnAnalyzer={dispose(){},async analyze(){return {decision:undefined,frames:[]};}};
 const stream=new StreamingTurns(model,0,1,()=>{},error=>{throw error;},undefined,(_frames,_focused,window)=>{if(window)observed.push(window);});
 for(let i=0;i<430;i++){
  const shifted=correction==='persistent'?i>=30:i>=140&&i<180;
  stream.push(new Float32Array(512),(i+1)*32+(shifted?500:0));await tick();
 }
 await stream.flush();stream.stop();
 const final=observed.at(-1)!;
 assert.equal(final.endMs-final.startMs,10000,'two window edges alone miss a constant offset or opposing interior steps');
 assert.ok(final.startMs>1500);assert.equal(final.clockAligned,false,'absolute media mapping still differs from the PCM clock');
});
