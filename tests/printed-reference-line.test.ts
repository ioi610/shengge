import test from 'node:test';
import assert from 'node:assert/strict';
import {printedReferenceLine} from '../src/printed-reference-line';

const bottom = {left:610,top:39,width:64,height:19};
const top = {left:612,top:25,width:60,height:19};

test('the two overlapping fragments in the actual opening frame form one complete reference',()=>{
 assert.deepEqual(printedReferenceLine([bottom,top],32,1280,58),{left:605,top:23,width:74,height:35});
});
test('a complete upper subtitle retains its crop and unrelated shapes stay separate',()=>{
 const full={left:500,top:19,width:280,height:38};
 assert.equal(printedReferenceLine([full,top],32,1280,58),full);
 assert.equal(printedReferenceLine([bottom,{...top,left:565}],32,1280,58),undefined);
 assert.equal(printedReferenceLine([bottom,{...top,top:13}],32,1280,58),undefined);
 assert.equal(printedReferenceLine([bottom],32,1280,58),undefined);
});

test('a printed long vowel does not detach the first two kana of the card-battle subtitle',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {inflateSync}=await import('node:zlib');
 const {subtitleLines}=await import('../src/visual-caption-reader');
 // Centered 420×40 strip of the original 06:12 frame. At x=146 the crop
 // already begins with ド. The actual initial カ lies near x=95.
 const pixels=inflateSync(await readFile(new URL('./fixtures/printed-card-row.rgba.zlib',import.meta.url)));
 const frame={data:new Uint8ClampedArray(pixels),width:420,height:40} as ImageData;
 const row=subtitleLines(frame,{color:[72,72,88],box:{left:89,top:4,width:239,height:32}})[0];
 assert.ok(row && row.left<=98 && row.left+row.width>=315,JSON.stringify(row));
});

test('cold detection finds the entire Japanese line below the Chinese at 00:05.94',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {inflateSync}=await import('node:zlib');
 const {subtitleLines}=await import('../src/visual-caption-reader');
 const pixels=inflateSync(await readFile(new URL('./fixtures/printed-opening-rows.rgba.zlib',import.meta.url)));
 const frame={data:new Uint8ClampedArray(pixels),width:280,height:86} as ImageData;
 const [lower,upper]=subtitleLines(frame);
 // Crop is x=500, y=65 on the locator canvas. The lower kana row starts
 // around y=116. Before recovery only the two Chinese fragments were seen.
 assert.ok(lower && lower.top>=48 && lower.top<=54 && lower.height>=24,JSON.stringify(lower));
 assert.ok(lower.left<=77 && lower.left+lower.width>=202,JSON.stringify(lower));
 assert.ok(upper && upper.top+upper.height<lower.top,JSON.stringify(upper));
 const referenceBand={...frame,height:lower.top,data:frame.data.subarray(0,lower.top*frame.width*4)};
 const reference=subtitleLines(referenceBand,undefined,lower.height)[0];
 assert.ok(reference && reference.top<15 && reference.top+reference.height>=45,JSON.stringify(reference));
});

test('a unique centered line still includes adjacent horizontal strokes at its start',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {inflateSync}=await import('node:zlib');
 const {subtitleLines}=await import('../src/visual-caption-reader');
 // Same printed line at 9.5 and 10.5 seconds; crop x=440,y=100 from the
 // actual 1280x173 production locator canvas. The first glyph contains
 // horizontal strokes that the two-axis outline mask omitted at 9.5.
 for(const {at,color,left,width,leftMax,rightMin} of [
  {at:'9.5',color:[72,72,88],left:94,width:221,leftMax:105,rightMin:313},
  {at:'10.5',color:[72,72,88],left:94,width:221,leftMax:105,rightMin:313},
  // Independent longer line later in the same video, with a different
  // learned color and crop, also lost its first horizontal-stroke glyph.
  {at:'64.9',color:[72,72,72],left:61,width:298,leftMax:47,rightMin:355},
 ]){
  const pixels=inflateSync(await readFile(new URL('./fixtures/printed-horizontal-prefix-'+at+'.rgba.zlib',import.meta.url)));
  const frame={data:new Uint8ClampedArray(pixels),width:400,height:50} as ImageData;
  const [row]=subtitleLines(frame,{color,box:{left,top:11,width,height:32}});
  assert.ok(row&&row.left<=leftMax&&row.left+row.width>=rightMin,JSON.stringify({at,row}));
  assert.equal(row.top,11);assert.equal(row.height,32);
 }
});
