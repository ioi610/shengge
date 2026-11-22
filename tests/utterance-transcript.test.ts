import test from 'node:test';import assert from 'node:assert/strict';
import {transcriptForUtterance} from '../src/utterance-transcript';

test('join Japanese decoder fragments into the utterance before a speaker change',()=>{
 const rows=[{startMs:200,endMs:1200,text:'島の住民が',confidence:.9},{startMs:1500,endMs:2700,text:'次々さらわれて',confidence:.9},{startMs:2900,endMs:4100,text:'行方不明になってる?',confidence:.9}];
 const result=transcriptForUtterance(rows,2750,true);assert.equal(result.length,1);assert.equal(result[0].text,'島の住民が次々さらわれて');assert.equal(result[0].startMs,200);assert.equal(result[0].endMs,2700);assert.equal(rows[0].text,'島の住民が');
});
test('a brief decoder fragment at the start of one sentence stays joined in any script',()=>{
 for(const [first,second,expected] of [['今日は','もう終わったよ。','今日はもう終わったよ。'],['This is','one sentence.','This is one sentence.'],['هذا','حوار واحد.','هذا حوار واحد.']]){
  const result=transcriptForUtterance([{startMs:100,endMs:400,text:first,confidence:.9},{startMs:500,endMs:1800,text:second,confidence:.9}],1900);
  assert.equal(result.length,1);assert.equal(result[0].text,expected);assert.equal(result[0].endMs,1800);
 }
});
test('word alignment excludes the next speaker even when ASR joins both into one row',()=>{
 const result=transcriptForUtterance([{startMs:100,endMs:2300,text:'Hello. Hi!',confidence:.9,timing:'aligned',words:[{startMs:100,endMs:900,text:'Hello.'},{startMs:1500,endMs:2300,text:' Hi!'}]}],1100,true);
 assert.equal(result[0].text,'Hello.');assert.equal(result[0].endMs,900);
});
test('music markers remain separate from a spoken utterance',()=>{
 const result=transcriptForUtterance([{startMs:0,endMs:2000,text:'♪~'},{startMs:2400,endMs:3200,text:'Hello!',confidence:.9}],3300);
 assert.equal(result.length,2);assert.equal(result[1].text,'Hello!');
});

test('a complete question followed by a real pause stays separate when speaker detection misses a change',()=>{
 const result=transcriptForUtterance([{startMs:200,endMs:1500,text:'行方不明になってる?',confidence:.95},{startMs:1900,endMs:4800,text:'このメンバーであれを討伐するのか?',confidence:.95}],4900);
 assert.equal(result.length,2);assert.equal(result[0].endMs,1500);
});

test('a quiet first interjection and clearer following words remain one acoustic utterance',()=>{
 const result=transcriptForUtterance([
  {startMs:820,endMs:1600,text:'えっ!?',confidence:.51,timing:'aligned',words:[{startMs:820,endMs:980,text:'えっ'}]},
  {startMs:1740,endMs:2440,text:'すごい!',confidence:.99,timing:'aligned',words:[{startMs:1740,endMs:1900,text:'すごい'}]},
  {startMs:2320,endMs:3580,text:'もう勉強!?',confidence:.99,timing:'aligned',words:[{startMs:2320,endMs:2480,text:'もう'},{startMs:2600,endMs:2760,text:'勉強'}]}
 ],3200);
 assert.equal(result.length,1);assert.equal(result[0].startMs,820);assert.match(result[0].text,/^えっ/);assert.match(result[0].text,/もう勉強/);assert.equal(result[0].words?.[0].text,'えっ');
});

test('a single decoder row cannot pull the next voice across a confirmed acoustic pause',()=>{
 const rows=[{startMs:12000,endMs:19000,text:'First reply. Oh! Another reply.',confidence:.8,timing:'aligned' as const,words:[
  {startMs:12000,endMs:12500,text:'First '},{startMs:14000,endMs:15000,text:'reply.'},
  {startMs:16000,endMs:16300,text:' Oh!'},{startMs:17000,endMs:18500,text:' Another reply.'}
 ]}];
 const result=transcriptForUtterance(rows,15300);
 assert.equal(result[0].text,'First reply.');assert.equal(result[0].startMs,12000);assert.equal(result[0].endMs,15000);
 const continuous=[{...rows[0],words:[{startMs:12000,endMs:15300,text:'A continuous '},{startMs:15400,endMs:15800,text:'ending.'}]}];
 assert.equal(transcriptForUtterance(continuous,15300)[0].words?.length,2,'retain final syllables without a pause even if the detector ends early');
});
