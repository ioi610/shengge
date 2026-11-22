import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {VisualTurns} from '../src/visual-turns';
import type {SpeakerFrame} from '../src/speaker-turns';
type Window={startMs:number;endMs:number;ended:boolean;clockAligned:boolean};
type Evidence={id:number;position:number;window:Window;frames:SpeakerFrame[]};
type Case={name:string;run:string;range:{startMs:number;endMs:number};windows:Evidence[]};
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/bilibili-late-print-voice.json.gz',import.meta.url))).toString()) as {cases:Case[]};
const caption={text:'た…たすけに来ました',confidence:.99,min:.99};
function closed(range:{startMs:number;endMs:number}){
 const visual=new VisualTurns(155000);
 visual.observe(range.startMs,caption,true);
 for(let at=range.startMs+200;at<range.endMs;at+=200)visual.observe(at,caption,true);
 visual.observe(range.endMs,caption,true);
 const turn=visual.observe(range.endMs+500,undefined,true)!;
 assert.ok(turn);assert.deepEqual(visual.spokenLines(),[]);
 return {visual,turn};
}
const actual=fixture.cases[0];
const feed=(visual:VisualTurns,e:Evidence)=>visual.corroborateSpeakerWindow(e.frames,e.window,e.position);

for(const data of fixture.cases.filter(c=>c.name.startsWith('た'))){
 test(`two actual shifted raw windows support the same late printed line (${data.run})`,()=>{
  const {visual,turn}=closed(data.range);
  feed(visual,data.windows[0]);assert.deepEqual(visual.spokenLines(),[],'one inference is insufficient');
  feed(visual,data.windows[1]);assert.deepEqual(visual.spokenLines(),[],'a weak intervening inference is not a second witness');
  feed(visual,data.windows[2]);assert.deepEqual(visual.spokenLines(),[turn]);
  assert.equal(visual.hasVoice(turn.startMs,turn.endMs),false,'late evidence marks this line, not the global voice buffer');
 });
}
for(const data of fixture.cases.filter(c=>!c.name.startsWith('た'))){
 test(`actual ${data.name} raw windows cannot authorize a hypothetical stable print`,()=>{
  const {visual}=closed(data.range);
  for(const window of data.windows)feed(visual,window);
  assert.deepEqual(visual.spokenLines(),[]);
 });
}
test('repeated identical PCM windows and duplicate flushes cannot corroborate a line',()=>{
 const {visual}=closed(actual.range),strong=actual.windows[2];
 for(let i=0;i<6;i++)feed(visual,strong);
 feed(visual,{...strong,window:{...strong.window,ended:true}});
 assert.deepEqual(visual.spokenLines(),[]);
});
test('growing audio without a shifted independent window cannot supply a second witness',()=>{
 const {visual}=closed(actual.range),first=actual.windows[0],second=actual.windows[2];
 feed(visual,first);feed(visual,{...second,window:{...second.window,startMs:first.window.startMs}});
 assert.deepEqual(visual.spokenLines(),[]);
});
test('missing or discontinuous media-clock provenance cannot lend sound to an unrelated earlier print',()=>{
 for(const clockAligned of [false,undefined]){
  const {visual}=closed(actual.range);
  for(const e of actual.windows)feed(visual,{...e,window:{...e.window,clockAligned:clockAligned as boolean}});
  assert.deepEqual(visual.spokenLines(),[]);
 }
});
test('late, stale, future, and non-overlapping sound cannot revive a closed line',()=>{
 const first=actual.windows[0],second=actual.windows[2];
 for(const changed of [
  {...second,position:actual.range.endMs+4001},
  {...second,position:second.window.endMs+1001},
  {...second,position:second.window.endMs-1},
  {...second,frames:second.frames.map(f=>({...f,atMs:f.atMs+3000}))},
 ]){
  const {visual}=closed(actual.range);feed(visual,first);feed(visual,changed);assert.deepEqual(visual.spokenLines(),[]);
 }
});
test('strong windows never create stable print or carry evidence into another visual instance',()=>{
 const visual=new VisualTurns(155000);
 visual.observe(actual.range.startMs,caption,true);
 visual.observe(actual.range.endMs+500,undefined,true);
 for(const window of actual.windows)feed(visual,window);
 assert.deepEqual(visual.spokenLines(),[]);
 const prior=closed(actual.range);feed(prior.visual,actual.windows[0]);
 const next=closed(actual.range);feed(next.visual,actual.windows[2]);assert.deepEqual(next.visual.spokenLines(),[]);
});
test('each independent window must support the same three distinct media bins',()=>{
 const range={startMs:172400,endMs:174400},first=actual.windows[0],second=actual.windows[2];
 const {visual}=closed(range);
 const frame=(atMs:number)=>({atMs,speaker:0,confidence:.95});
 feed(visual,{...first,frames:[frame(172500),frame(172532),frame(172564)]});
 feed(visual,{...second,frames:[frame(173500),frame(173532),frame(173564)]});
 assert.deepEqual(visual.spokenLines(),[],'different sounds in the same long title are not repeated evidence');
 const duplicate=closed(range);
 feed(duplicate.visual,{...first,frames:Array(5).fill(frame(173000))});
 feed(duplicate.visual,{...second,frames:Array(5).fill(frame(173000))});
 assert.deepEqual(duplicate.visual.spokenLines(),[]);
});
