import test from 'node:test';import assert from 'node:assert/strict';import {prepareTimeline} from '../src/prepare-timeline';
function fake(){let submits=0;const cache=new Map<string,any>();const transport=async(a:string,p:any={})=>{if(a==='analysis-load')return cache.get(p.key);if(a==='analysis-save'){cache.set(p.key,structuredClone(p.checkpoint));return;}if(a==='prepare')return {streaming:true};if(a==='submit'){submits++;return {id:String(submits)};}if(a==='status')return {state:'done',result:{language:'japanese',segments:[{text:'こんにちは。',startMs:100,endMs:1200,confidence:.9,timing:'aligned',words:[{text:'こんにちは。',startMs:100,endMs:1200}]}]}};return {};};return {cache,transport,submits:()=>submits};}
test('completed analysis resumes from checkpoint without repeating any decoder jobs',async()=>{
 const f=fake(),pcm=new Float32Array(32000);const first=await prepareTimeline(pcm,2000,0,new AbortController().signal,()=>{},f.transport);const n=f.submits();const second=await prepareTimeline(pcm,2000,0,new AbortController().signal,()=>{},f.transport);
 assert.equal(n,1);assert.equal(f.submits(),1);assert.equal(first[0].text,second[0].text);assert.ok([...f.cache.values()][0].complete);
});
test('cancelling before analysis cannot submit or create a complete checkpoint',async()=>{
 const f=fake(),c=new AbortController();c.abort();await assert.rejects(prepareTimeline(new Float32Array(32000),2000,0,c.signal,()=>{},f.transport),{name:'AbortError'});assert.equal(f.submits(),0);assert.equal(f.cache.size,0);
});
test('minor player duration drift reuses the same audio checkpoint after refresh',async()=>{
 const f=fake(),pcm=new Float32Array(32000);await prepareTimeline(pcm,2000,0,new AbortController().signal,()=>{},f.transport);await prepareTimeline(pcm,2030,0,new AbortController().signal,()=>{},f.transport);assert.equal(f.submits(),1);
});
test('the fractional final audio frame is submitted with a valid integer duration',async()=>{
 const f=fake();let submittedDuration:number|undefined;
 const transport=async(a:string,p:any={})=>{if(a==='submit'){submittedDuration=p.durationMs;assert.ok(Number.isInteger(p.durationMs));}return f.transport(a,p);};
 await prepareTimeline(new Float32Array(32001),2000,0,new AbortController().signal,()=>{},transport);assert.equal(submittedDuration,2000);
});
test('pause preserves completed windows and a retry only decodes the unfinished remainder',async()=>{
 const f=fake(),c=new AbortController(),cancelled:string[]=[];let pausing=true;
 const transport=async(a:string,p:any={})=>{if(a==='status'&&p.id==='2'&&pausing){c.abort();return {state:'running'};}if(a==='cancel')cancelled.push(p.id);return f.transport(a,p);};
 const pcm=new Float32Array(44000*16);await assert.rejects(prepareTimeline(pcm,44000,0,c.signal,()=>{},transport),{name:'AbortError'});
 assert.equal([...f.cache.values()][0].windows.length,1);assert.equal([...f.cache.values()][0].complete,undefined);assert.ok(cancelled.includes('2'));
 pausing=false;await prepareTimeline(pcm,44000,0,new AbortController().signal,()=>{},transport);assert.equal(f.submits(),4);assert.ok([...f.cache.values()][0].complete);
});
