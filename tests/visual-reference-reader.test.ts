import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {inflateSync} from 'node:zlib';
import {VisualCaptionReader} from '../src/visual-caption-reader';

async function fixture(){return JSON.parse(await readFile(new URL('./fixtures/printed-reference-openings.json',import.meta.url),'utf8'));}
function readerFor(t:import('node:test').TestContext){
 const prior=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({width:0,height:0})}});
 const reader=new VisualCaptionReader() as any;
 t.after(()=>{reader.dispose();if(prior)Object.defineProperty(globalThis,'document',prior);else Reflect.deleteProperty(globalThis,'document');});
 return reader;
}
async function frameContext(sample:any){
 const pixels=new Uint8ClampedArray(inflateSync(await readFile(new URL('./fixtures/'+sample.pixels,import.meta.url))));
 return {getImageData(x:number,y:number,width:number,height:number){assert.equal(x,0);assert.equal(width,sample.width);assert.ok(y>=0&&y+height<=sample.height);return {width,height,data:pixels.slice(y*width*4,(y+height)*width*4)};}};
}
const letters=(pairs:[string,number][])=>pairs.map(([char,p])=>({char,p}));

test('real opening Chinese rows use native pixels and include the horizontal first glyph with one inference',async t=>{
 const samples=(await fixture()).cases,reader=readerFor(t);let count=0;
 for(const sample of samples){
  reader.capture.width=sample.width;reader.capture.height=sample.height;reader.layout=sample.layout;
  const mask=new Float32Array([1]),raw=new Float32Array([2]);let box:any;
  reader.prepare=(candidate:any)=>{box=candidate;return {input:mask,width:320,rawPixels:()=>raw};};
  reader.readPixels=async(_session:any,pixels:Float32Array)=>{count++;return pixels===raw?letters(sample.raw):letters(sample.masked);};
  const before=count,result=await reader.readReference(await frameContext(sample),sample.lower,{});
  assert.equal(result,sample.expected);assert.equal(count-before,1,'reference must not add a second OCR pass');
  assert.ok(box.top>=69&&box.top<=77&&box.height>=34&&box.height<=42,JSON.stringify(box));
  if(sample.expected==='三星饭店吗')assert.ok(box.left>=540&&box.left<=549&&box.left+box.width>=734,JSON.stringify(box));
  assert.ok(box.top+box.height<=sample.lower.top,'the Chinese crop must stay above the original Japanese');
  assert.deepEqual(reader.referenceLayout.color,sample.layout.color);
 }
});

test('a confidently truncated masked phrase cannot replace the complete native-pixel reference',async t=>{
 const sample=(await fixture()).cases[2],reader=readerFor(t),mask=new Float32Array([1]),raw=new Float32Array([2]);
 assert.equal(letters(sample.masked).map(x=>x.char).join(''),'三星店');
 assert.ok(letters(sample.masked).every(x=>x.p>.99),'the observed wrong result defeats a confidence-only fallback');
 reader.capture.width=sample.width;reader.layout=sample.layout;
 reader.prepare=()=>({input:mask,width:320,rawPixels:()=>raw});
 reader.readPixels=async(_session:any,pixels:Float32Array)=>pixels===raw?letters(sample.raw):letters(sample.masked);
 assert.equal(await reader.readReference(await frameContext(sample),sample.lower,{}),'三星饭店吗');
});

test('native reference recognition retains confidence and language guards',async t=>{
 const sample=(await fixture()).cases[0],reader=readerFor(t),raw=new Float32Array([2]);
 reader.capture.width=sample.width;reader.layout=sample.layout;
 reader.prepare=()=>({input:new Float32Array([1]),width:320,rawPixels:()=>raw});
 const ctx=await frameContext(sample);
 for(const result of [
  [{char:'错',p:.71}],
  [{char:'中文',p:.94}],
  [{char:'これってもしかして',p:.999}],
  [{char:'这里 English',p:.999}],
  [],
 ]){reader.readPixels=async(_session:any,pixels:Float32Array)=>{assert.equal(pixels,raw);return result;};assert.equal(await reader.readReference(ctx,sample.lower,{}),undefined);}
});
