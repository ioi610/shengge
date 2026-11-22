import test from 'node:test';import assert from 'node:assert/strict';
import {CorroboratedTurns} from '../src/corroborated-turns';
const observation=(end:number,confidence=.9,speaker=0)=>Array.from({length:Math.floor(end/32)},(_,i)=>({atMs:i*32,speaker:i>=30&&i<55?speaker:-1,confidence}));
test('transient single-window voice, duplicates, overlap and moderate music do not create retained turns',()=>{
 for(const [confidence,speaker] of [[.7,0],[.95,-2],[.95,-1]]){const t=new CorroboratedTurns();for(let n=0;n<10;n++)assert.deepEqual(t.observe(observation(2000+n*256,confidence,speaker),2000+n*256),[]);}
 const t=new CorroboratedTurns();for(let n=0;n<8;n++)assert.deepEqual(t.observe(observation(2000),2000),[]);
 assert.deepEqual(t.observe(observation(3200,.4),3200),[],'duplicate processing is not independent corroboration');
});
test('corroborated evidence survives later uncertainty, respects rejection and expires without resurrecting old audio',()=>{
 const t=new CorroboratedTurns();t.observe(observation(2000),2000);t.observe(observation(2300),2300);
 assert(t.observe(observation(3100,.4),3100).length,'confirmed voice survives a later uncertain estimate');
 t.discardBefore(2000);assert.deepEqual(t.observe(observation(3400,.4),3400),[]);
 const stale=new CorroboratedTurns();stale.observe(observation(2000),2000);stale.observe(observation(2300),2300);assert.deepEqual(stale.observe(observation(5000,.4),5000),[],'do not revive a stale sentence after several seconds');
});
test('legacy long-lead 6:33 proposal remains available for review instead of bypassing the music guard',async()=>{
 const {readFile}=await import('node:fs/promises'),{gunzipSync}=await import('node:zlib'),{StreamingSentences}=await import('../src/streaming-sentences');
 const run=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/bilibili-eyes-fixed-context.json.gz',import.meta.url))).toString());
 const t=new CorroboratedTurns(),s=new StreamingSentences(run.origin*1000,()=>{},e=>{throw e},async()=>{throw Error('no text review on acoustic path')},undefined,true);let frame=0;let found:any;
 for(const r of run.rows){
  while((frame+1)*32<=r.duration){s.push(new Float32Array(512).fill(.02),run.origin*1000+(frame+1)*32,run.probabilities[frame][1]);frame++;}
  if(r.duration<6000)continue;
  s.observeSpeech(r.frames,true);
  for(const turn of t.observe(r.frames,r.duration)){const mapped={...turn,focused:true,startMs:run.origin*1000+turn.startMs,endMs:run.origin*1000+turn.endMs};if(mapped.startMs>=391000&&mapped.startMs<=391700&&mapped.endMs>=393000&&mapped.endMs<=394200&&s.reviewAudio(mapped)){assert.equal(s.acousticBoundary(mapped),undefined);found=mapped;break;}}
  if(found)break;
 }
 assert(found,'retain the target candidate for text review, not only the clearer following reply');s.stop();
});
test('a nearby second voice prevents the retained-pause path from swallowing it',()=>{
 const frames=(end:number)=>Array.from({length:Math.floor(end/32)},(_,i)=>({atMs:i*32,speaker:i>=30&&i<50?0:i>=65&&i<85?1:-1,confidence:.95}));
 const t=new CorroboratedTurns();t.observe(frames(3000),3000);t.observe(frames(3300),3300);
 const turns=t.observe(frames(4000),4000);assert(turns.every(t=>t.startMs>1800),'first voice must use the original speaker-change boundary, not a padded pause boundary');
});
