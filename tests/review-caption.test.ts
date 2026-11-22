import test from 'node:test';import assert from 'node:assert/strict';
import {captionFromReview} from '../src/review-caption';import type {Transcript} from '../src/background-captions';
const audio={durationMs:4000,toMedia:(ms:number)=>10000+ms};
const result:Transcript={language:'japanese',segments:[{startMs:100,endMs:3300,text:'前の文アクセサリー次の文',confidence:.9,timing:'aligned',words:[{startMs:100,endMs:300,text:'前の文'},{startMs:800,endMs:1200,text:'アクセ'},{startMs:1200,endMs:2100,text:'サリー'},{startMs:3000,endMs:3300,text:'次の文'}]}]};
test('covered replay reuses aligned full-prefix words without copying adjacent dialogue',()=>{
 assert.deepEqual(captionFromReview(result,{startMs:10500,endMs:12500},audio,'ja'),{text:'アクセサリー',language:'japanese',confidence:.9});
});
test('a review missing any lead-in or tail must fall back to full replay transcription',()=>{
 assert.equal(captionFromReview(result,{startMs:9800,endMs:12500},audio,'ja'),undefined);
 assert.equal(captionFromReview(result,{startMs:10500,endMs:14500},audio,'ja'),undefined);
});
test('unknown language, mismatched language, weak or unaligned review cannot bypass caption checks',()=>{
 const range={startMs:10500,endMs:12500};
 for(const language of [undefined,'en'])assert.equal(captionFromReview(result,range,audio,language),undefined);
 for(const changes of [{confidence:.3},{timing:undefined},{words:undefined},{words:[{startMs:900,endMs:900,text:'wrong'}]}])assert.equal(captionFromReview({...result,segments:[{...result.segments[0],...changes}]},range,audio,'ja'),undefined);
});

test('an Asian language tag on a foreign-script sentence requires independent caption decoding',()=>{
 const words=[{startMs:800,endMs:1100,text:'and '},{startMs:1200,endMs:1400,text:'oh '},{startMs:1450,endMs:1700,text:'my...'}];
 const wrong={language:'japanese',segments:[{startMs:800,endMs:1700,text:'and oh my...',confidence:.93,timing:'aligned' as const,words}]};
 assert.equal(captionFromReview(wrong,{startMs:10500,endMs:12500},audio,'ja'),undefined);
 assert.equal(captionFromReview({...wrong,language:'english'},{startMs:10500,endMs:12500},audio,'en')?.text,'and oh my...');
 for(const [language,code]of [['chinese','zh'],['korean','ko']])assert.equal(captionFromReview({...wrong,language},{startMs:10500,endMs:12500},audio,code),undefined);
});

test('native-script mixed text and short Latin names can still reuse a covered review',()=>{
 for(const text of ['OK','AI','Macを使う','なんだお前','宝物なわけだ']){
  const r={language:'japanese',segments:[{startMs:800,endMs:1700,text,confidence:.9,timing:'aligned' as const,words:[{startMs:800,endMs:1700,text}]}]};
  assert.equal(captionFromReview(r,{startMs:10500,endMs:12500},audio,'ja')?.text,text);
 }
});
