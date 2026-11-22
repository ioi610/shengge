import test from 'node:test';import assert from 'node:assert/strict';import {analysisOffsets,AnalysisWindow,timelineSegments,validCheckpoint,needsReview} from '../src/timeline-plan';import {validateSegments} from '../src/domain';
const row=(text:string,startMs:number,endMs:number,confidence=.9)=>({text,startMs,endMs,confidence,timing:'aligned' as const,words:[{text,startMs,endMs}]});
const window=(offsetMs:number,segments:AnalysisWindow['segments'],durationMs=24000):AnalysisWindow=>({offsetMs,durationMs,segments,language:'japanese'});
test('full analysis covers the tail and treats overlapping windows as corroboration, not extra sentences',()=>{
 assert.deepEqual(analysisOffsets(0,630764).slice(-2),[600000,620000]);
 const segments=timelineSegments([window(0,[row('一つ目',1000,2200),row('二つ目',21000,23000)]),window(20000,[row('二つ目',1010,3010),row('三つ目',5000,6500)])],44000);
 assert.equal(segments.length,3);validateSegments(segments,44000);assert.ok(segments[1].startMs>=20000);assert.ok(segments.every(s=>s.source==='asr'&&s.onsetVerified));
});
test('a weak unaligned guess or a music marker never creates an interval',()=>{
 assert.equal(timelineSegments([window(0,[row('♪音楽♪',1000,4000),{...row('目が光ってる',6000,8000),timing:undefined}])],24000).length,0);
 assert.equal(needsReview(window(0,[row('目立てる',13300,14300,.4)])),true);
});
test('a later contextual decode rescues weak dialogue with its aligned timestamps',()=>{
 const segments=timelineSegments([window(380000,[row('目立てる',13400,14320,.4)]),window(385000,[row('目が光ってる！',8380,9900,.787)])],630764);
 assert.equal(segments.length,1);assert.equal(segments[0].text,'目が光ってる！');assert.equal(segments[0].startMs,393180);assert.equal(segments[0].endMs,395220);
});
test('unconfirmed humming is suppressed; timed agreement in a different window retains a real short reply',()=>{
 const a=window(0,[row('ん',10000,10160,.93)]);assert.equal(timelineSegments([a],24000).length,0);
 const b=window(5000,[row('ん',5020,5180,.7)]);assert.equal(timelineSegments([a,b],29000).length,1);
});
test('padding cannot overlap adjoining replies or exceed EOF',()=>{
 const segments=timelineSegments([window(0,[row('はい',100,500),row('次です',510,1200),row('終わり',23000,24000)])],24000);
 validateSegments(segments,24000);assert.equal(segments.at(-1)!.endMs,24000);assert.ok(segments[0].endMs<=segments[1].startMs);
});
test('an interior chunk with a clipped ending cannot masquerade as a complete sentence',()=>{
 assert.equal(timelineSegments([window(0,[row('続いています',22000,24000)])],50000).length,0);
});
test('checkpoints reject missing bounds, wrong versions and oversized windows',()=>{
 const good={version:1,durationMs:24000,originMs:0,windows:[window(0,[])],reviewed:[]};assert.ok(validCheckpoint(good,24000,0));
 assert.equal(validCheckpoint({...good,version:2},24000,0),false);assert.equal(validCheckpoint({version:1,windows:[],reviewed:[]},undefined as any,undefined as any),false);
 assert.equal(validCheckpoint({...good,windows:[window(0,[],25000)]},24000,0),false);
});
