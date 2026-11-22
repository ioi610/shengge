import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {CaptionLanguageEvidence,completeCaptionRow,type CaptionEvidenceRange} from '../src/caption-language-evidence';
import type {Transcript} from '../src/background-captions';import {SourceLanguage} from '../src/source-language';
const range:CaptionEvidenceRange={start:0,end:2000,audioEnd:2160,mediaStartMs:10000,rate:1};
const row=(text:string,startMs=300,endMs=1000)=>({startMs,endMs,text,confidence:.7,timing:'aligned' as const,words:[{startMs,endMs,text}]});
test('real held decode supplies one short vote; replaying its rolling audio cannot confirm language',async()=>{
 const f=JSON.parse(await readFile(new URL('./fixtures/bilibili-short-language-hold.json',import.meta.url),'utf8'));
 const proof=new CaptionLanguageEvidence(),language=new SourceLanguage();
 const first=proof.observe(f.raw,f.ranges);assert.equal(first?.text,'なるほど');language.observe(first!.text,first!.language);assert.equal(language.language,undefined);
 assert.equal(proof.observe(f.raw,f.ranges),undefined,'derived results from one completed decode cannot vote again');
 assert.equal(proof.observe(structuredClone(f.raw),f.ranges),undefined,'a new decode of the same audio cannot vote again');
 // Even if the next ASR fixes the old second row's timing, it is still audio
 // already heard in the first voting decode, not another independent witness.
 const retry=structuredClone(f.raw) as Transcript;const old=retry.segments[1];old.endMs=4760;old.words=old.words!.map((w,i)=>({...w,startMs:3260+i*200,endMs:3420+i*200}));
 assert.equal(proof.observe(retry,f.ranges),undefined);
 const next=proof.observe({language:'japanese',segments:[row('宝物なわけだ')]},[{...range,mediaStartMs:300000}]);
 assert.equal(next?.text,'宝物なわけだ');language.observe(next!.text,next!.language);assert.equal(language.language,'ja');
});
test('a decode with two complete rows chooses the newest once and reserves both audio ranges',()=>{
 const proof=new CaptionLanguageEvidence(),r=[range,{...range,start:2500,end:4500,audioEnd:4660,mediaStartMs:13000}];
 const result={language:'japanese',segments:[row('なるほど'),row('宝物なわけだ',2800,3500)]};
 assert.equal(proof.observe(result,r)?.text,'宝物なわけだ');assert.equal(proof.observe(structuredClone(result),r),undefined);
});
test('short evidence requires provenance, complete words and independent qualifying dialogue',()=>{
 const samples=[
  {language:'korean',segments:[row('아! 어'),row('뭐야?',1100,1500)]},
  {language:'english',segments:[row('*growls*')]},
  {language:'japanese',segments:[{...row('なるほど'),confidence:.59}]},
  {language:'japanese',segments:[{...row('なるほど'),timing:undefined}]},
  {language:'japanese',segments:[{...row('なるほど'),words:[{startMs:300,endMs:1000,text:'ほど'}]}]},
  {language:'japanese',segments:[{...row('なるほど'),words:[{startMs:200,endMs:1000,text:'なるほど'}]}]},
  {language:'japanese',segments:[row('なるほど',1900,2300)]},
 ];
 for(const sample of samples)assert.equal(new CaptionLanguageEvidence().observe(sample,[range]),undefined);
 assert.equal(new CaptionLanguageEvidence().observe({language:'japanese',segments:[row('なるほど')]},[]),undefined);
 assert.equal(new CaptionLanguageEvidence().observe({language:'japanese',segments:[row('なるほど')]},[{...range,mediaStartMs:NaN}]),undefined);
});
test('an aligned final word may cross the target inside the captured closing margin, without pruning',()=>{
 const r={...range,end:2560,audioEnd:2688};const complete=row('宝物なわけだ',2000,2600);
 assert.equal(completeCaptionRow(complete,r),true);
 assert.equal(completeCaptionRow(complete,{...r,audioEnd:2560}),false);
 assert.equal(completeCaptionRow({...complete,words:[{startMs:2570,endMs:2600,text:complete.text}]},r),false);
 assert.equal(completeCaptionRow(row('宝物なわけだ',2000,2740),{...r,audioEnd:2800}),false);
});
test('short native-script evidence is not a Japanese-only rule and reset drops consumed intervals',()=>{
 const proof=new CaptionLanguageEvidence();for(const [language,text]of [['korean','안녕하세요'],['chinese','这是字幕']]){
  const result={language,segments:[row(text)]};assert.equal(proof.observe(result,[range])?.language,language);proof.reset();
 }
 const long={language:'japanese',segments:[row('これは日本語の会話が続いています。')]};proof.observe(long,[range],true);
 assert.equal(proof.observe({language:'japanese',segments:[row('なるほど')]},[range]),undefined,'existing long evidence cannot be followed by a short vote on the same audio');
});
