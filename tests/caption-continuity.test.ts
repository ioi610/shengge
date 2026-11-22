import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {restoreCaptionContinuity} from '../src/caption-continuity';

function signal(length:number,seed=123456){
 const pcm=new Float32Array(length);let value=0;
 for(let i=0;i<length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;value=.8*value+.2*((seed>>>0)/0x100000000-.5);pcm[i]=value*.2;}
 return pcm;
}
function unchanged(previous:Float32Array,current:Float32Array,offset?:number){
 const result=restoreCaptionContinuity(previous,current,offset);assert.equal(result.pcm,current);assert.equal(result.addedPrefixMs,0);
}
function captured(){
 const previous=signal(24000),offset=12800,current=previous.slice(offset,offset+6144);current.fill(0,0,512);
 return {previous,current,offset};
}

test('actual startup capture restores only its damaged lead from the prior overlapping PCM',async()=>{
 const fixture=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/bilibili-caption-startup.json.gz',import.meta.url))).toString());
 const pcm=(data:string)=>{const b=Buffer.from(data,'base64');return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
 const previous=pcm(fixture.previous),current=pcm(fixture.current),before=current.slice();
 const result=restoreCaptionContinuity(previous,current,fixture.expectedOffsetMs);
 assert.equal(result.addedPrefixMs,400);assert.equal(result.pcm.length,current.length+6400);
 assert.deepEqual(result.pcm.slice(0,6400+1536),previous.slice(fixture.matchedOffsetSamples-6400,fixture.matchedOffsetSamples+1536));
 assert.deepEqual(result.pcm.slice(6400+1536),current.slice(1536));
 assert.deepEqual(current,before,'the original capture remains immutable');
});

test('actual 192.5–255 ms overlap remains sufficient despite a half-sample capture-phase difference',async()=>{
 const fixture=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/bilibili-caption-startup.json.gz',import.meta.url))).toString());
 const pcm=(data:string)=>{const b=Buffer.from(data,'base64');return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
 const full=pcm(fixture.previous),current=pcm(fixture.current);
 for(const overlapMs of [192.5,200,224,255]){
  const previous=full.slice(0,fixture.matchedOffsetSamples+overlapMs*16);
  const result=restoreCaptionContinuity(previous,current,fixture.expectedOffsetMs);
  assert.equal(result.addedPrefixMs,400,`${overlapMs} ms overlap`);
  assert.deepEqual(result.pcm.slice(0,6400+1536),previous.slice(fixture.matchedOffsetSamples-6400,fixture.matchedOffsetSamples+1536));
  assert.deepEqual(result.pcm.slice(6400+1536),current.slice(1536));
 }
});

test('repair preserves the target duration and every sample after its first 96 ms',()=>{
 const {previous,current,offset}=captured(),originalPrevious=previous.slice(),originalCurrent=current.slice();
 const result=restoreCaptionContinuity(previous,current,offset/16+20);
 assert.equal(result.addedPrefixMs,400);assert.equal(result.pcm.length-6400,current.length);
 assert.deepEqual(result.pcm.slice(6400,6400+1536),previous.slice(offset,offset+1536));
 assert.deepEqual(result.pcm.slice(6400+1536),current.slice(1536));
 assert.deepEqual(previous,originalPrevious);assert.deepEqual(current,originalCurrent);
});

test('healthy starts, genuine silence and shorter zero runs remain untouched',()=>{
 const {previous,current,offset}=captured();
 unchanged(previous,previous.slice(offset,offset+6144),offset/16);
 const short=previous.slice(offset,offset+6144);short.fill(0,0,255);unchanged(previous,short,offset/16);
 previous.fill(0,offset,offset+512);unchanged(previous,current,offset/16);
});

test('missing or conflicting media continuity cannot authorize copying earlier audio',()=>{
 const {previous,current,offset}=captured();
 unchanged(previous,current);unchanged(previous,current,NaN);unchanged(previous,current,Infinity);
 unchanged(previous,current,offset/16+200);
 unchanged(signal(previous.length,98765),current,offset/16);
});

test('periodic audio and two equal candidate matches do not establish a unique overlap',()=>{
 const periodic=Float32Array.from({length:24000},(_,i)=>.04*Math.sin(2*Math.PI*i/64));
 const current=periodic.slice(12800,18944);current.fill(0,0,512);unchanged(periodic,current,800);
 const previous=signal(24000),first=720*16,second=880*16,reply=previous.slice(first,first+6144);
 previous.set(previous.slice(first+2048,first+4096),second+2048);reply.fill(0,0,512);
 unchanged(previous,reply,800);
});

test('a similar but altered stable window does not justify replacing the opening',()=>{
 const {previous,current,offset}=captured(),noise=signal(2048,998877);
 for(let i=0;i<2048;i++)current[2048+i]+=noise[i]*.5;
 unchanged(previous,current,offset/16);
});

test('insufficient preceding context, overlap or usable waveform refuses repair',()=>{
 const {previous,current,offset}=captured();
 unchanged(previous.slice(0,offset+190*16),current,offset/16);
 unchanged(previous.slice(offset-300*16),current,300);
 unchanged(previous,current.slice(0,191*16),offset/16);
 const quiet=current.map(x=>x*.001);unchanged(previous.map(x=>x*.001),quiet,offset/16);
 const invalid=current.slice();invalid[2048]=NaN;unchanged(previous,invalid,offset/16);
});
