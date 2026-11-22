import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {subtitleLines} from '../src/visual-caption-reader';
const samples=JSON.parse(readFileSync(new URL('./fixtures/printed-vertical-rows.json',import.meta.url),'utf8')).cases;
const pixels=(sample:any)=>({width:sample.width,height:sample.height,data:new Uint8ClampedArray(inflateSync(readFileSync(new URL('./fixtures/'+sample.pixels,import.meta.url))))}) as ImageData;
for(const sample of samples){
 test(`tracked ${sample.time}s row restores the observed lower outline from height ${sample.prior.box.height}`,()=>{
  const box=subtitleLines(pixels(sample),sample.prior)[0];
  assert.deepEqual(box,sample.after.box,'the crop must match the real-model regression evidence');
  assert.equal(sample.after.text,sample.expected);assert.ok(sample.after.mean>.99&&sample.after.min>.98);
  assert.ok(box);assert.ok(box.top<=115&&box.top+box.height>=141,JSON.stringify(box));
  assert.equal(box.left,sample.before.box.left);assert.equal(box.width,sample.before.box.width,'vertical repair must not pull in neighbouring artwork');
  assert.ok(box.top>=sample.prior.box.top-Math.ceil(sample.prior.box.height/2));
  assert.ok(box.height<=sample.prior.box.height*1.6);
  assert.ok(box.top>=111,'the distinct upper Chinese row is not merged');
 });
}
test('the real truncated camera phrase is confident enough to defeat a text-confidence retry',()=>{
 const wrong=samples.find((sample:any)=>sample.time==='580.5'&&sample.prior.box.height===24).before;
 assert.equal(wrong.text,'カメラ大そ');assert.ok(wrong.mean>.96&&wrong.min>.93);
 const box=subtitleLines(pixels(samples[0]),samples[0].prior)[0];
 assert.ok(box.top+box.height>wrong.box.top+wrong.box.height,'repair must inspect visible strokes before accepting confident incomplete OCR');
});
test('already complete tracked rows retain their crop, including separate reference text above',()=>{
 for(const sample of samples.filter((s:any)=>s.prior.box.height===24)){
  const prior={...sample.prior,box:{left:500,top:111,width:280,height:32}};
  const box=subtitleLines(pixels(sample),prior)[0];
  assert.deepEqual(box,sample.time==='580.5'?{left:544,top:111,width:189,height:32}:{left:479,top:111,width:316,height:32});
 }
});
