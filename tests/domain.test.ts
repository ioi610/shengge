import test from 'node:test';import assert from 'node:assert/strict';
import {defaults,createClip,resolveSource,validateSegments,splitCues,safeCue,results,estimateMs,gapMs,questionsFor} from '../src/domain';
const seg=(id='a',startMs=0,endMs=5000)=>({id,revision:1,startMs,endMs,source:'manual' as const});
test('precise times retain tenths across floating point and minute boundaries',async()=>{const {formatTime}=await import('../src/domain');assert.equal(formatTime(4100,true),'00:04.1');assert.equal(formatTime(59999,true),'00:59.9');assert.equal(formatTime(60100,true),'01:00.1');assert.equal(formatTime(-100,true),'00:00.0');});
const clip=()=>createClip({videoKey:'youtube:abcdefghijk',url:'https://www.youtube.com/watch?v=abcdefghijk',title:'test',durationMs:50000,segments:[seg(),seg('b',6000,10000)]});
test('A01 canonical links discard tracking tokens and reject other protocols / domains',()=>{for(const url of ['https://youtu.be/abcdefghijk?t=2&token=secret','https://www.youtube.com/watch?v=abcdefghijk&token=secret','https://m.youtube.com/shorts/abcdefghijk'])assert.equal(resolveSource(url).url,'https://www.youtube.com/watch?v=abcdefghijk');for(const url of ['javascript:alert(1)','file:///hello','https://evil.youtube.com/watch?v=abcdefghijk','https://youtube.com/watch?v=no','https://name:secret@youtube.com/watch?v=abcdefghijk'])assert.throws(()=>resolveSource(url));});
test('A03 boundaries finite, integer, known duration, unique and overlap confirmation',()=>{validateSegments([seg()],5000);for(const segments of [[seg('a',-1,100)],[seg('a',0,6000)],[seg('a',2,2)],[seg('a',0.5,200)],[seg(),seg()],[seg(),seg('b',2000,6000)]])assert.throws(()=>validateSegments(segments,5000));assert.throws(()=>validateSegments([seg()],NaN));const a={...seg(),overlapConfirmed:true},b={...seg('b',1000,4000),overlapConfirmed:true};validateSegments([a,b],5000);assert.equal(safeCue([a,b]),false);});
test('A03 subtitle clipping uses intersections and drops empty results',()=>{assert.deepEqual(splitCues([seg('a',0,5000),seg('b',6000,10000)],2000,7000).map(s=>[s.startMs,s.endMs]),[[2000,5000],[6000,7000]]);});
test('A04 formal target is 20; demo target is 3',()=>{const c=clip();assert.equal(c.settings.targetDefault,20);assert.equal(c.progress.a.count,0);assert.equal(createClip(c,'demo',true).progress.a.target,3);});
test('A06 automatic shadow gap clamps and estimation includes last gap',()=>{const s=defaults();assert.equal(gapMs(seg('x',0,200),s,'shadow'),2000);assert.equal(gapMs(seg('x',0,25000),s,'shadow'),10000);s.shadowGap={type:'fixed',ms:3000};assert.equal(estimateMs(Array.from({length:10},(_,i)=>seg(String(i))),s,'shadow'),1600000);assert.equal(estimateMs([seg()],s,'listen'),119000);s.shadowGap={type:'manual'};assert.equal(gapMs(seg(),s,'shadow'),null);});
test('A07 result denominator excludes reveal-only and skipped; zero has no percentage',()=>{const c=clip();c.questions=questionsFor(c);assert.equal(results(c).percent,null);c.questions[0].revealed=true;assert.equal(results(c).percent,null);c.questions[0].rating='skip';assert.equal(results(c).percent,null);assert.equal(results(c).skipped,1);c.questions[0].rating='stuck';assert.equal(results(c).percent,0);c.questions[0].rating='can';assert.equal(results(c).percent,100);});
test('subtitle fingerprint detects text changes but ignores transient cue ids',async()=>{const {cueFingerprint}=await import('../src/domain');const a={...seg('a'),text:'今日は'};assert.equal(cueFingerprint([a]),cueFingerprint([{...a,id:'other'}]));assert.notEqual(cueFingerprint([a]),cueFingerprint([{...a,text:'明日は'}]));});
test('Bilibili canonical links preserve part identity and discard tracking',()=>{
 const base='https://www.bilibili.com/video/BV1isxQ6MEHH/';
 for(const url of [base,base+'?p=1&vd_source=private',base.replace('www.','m.')]){
  const s=resolveSource(url);assert.equal(s.platform,'bilibili');assert.equal(s.videoKey,'bilibili:BV1isxQ6MEHH:p1');assert.equal(s.url,base);
 }
 const p2=resolveSource(base+'?p=2&spm_id_from=tracking#reply');assert.equal(p2.videoKey,'bilibili:BV1isxQ6MEHH:p2');assert.equal(p2.url,base+'?p=2');assert.notEqual(p2.videoKey,resolveSource(base).videoKey);
 assert.equal(resolveSource('https://www.bilibili.com/video/av170001/?p=3').videoKey,'bilibili:av170001:p3');
 assert.equal(resolveSource('https://www.bilibili.com/bangumi/play/ep12345?from=share').url,'https://www.bilibili.com/bangumi/play/ep12345');
});
test('Bilibili rejects spoofed hosts, ambiguous parts, unsupported routes and credentials',()=>{
 for(const url of ['https://evil.bilibili.com/video/BV1isxQ6MEHH/','https://www.bilibili.com.evil.com/video/BV1isxQ6MEHH/','https://user:secret@www.bilibili.com/video/BV1isxQ6MEHH/','https://live.bilibili.com/123','https://www.bilibili.com/bangumi/play/ss123','https://www.bilibili.com/video/BVshort/','https://www.bilibili.com/video/av0/',...['0','-1','1.2','NaN','9007199254740992','2&p=3'].map(p=>'https://www.bilibili.com/video/BV1isxQ6MEHH/?p='+p)])assert.throws(()=>resolveSource(url),url);
});

test('localized Bilibili redirects preserve the video and part',()=>{
 const regular=resolveSource('https://www.bilibili.com/video/BV11N4y127o7/?p=2');
 assert.deepEqual(resolveSource('https://www.bilibili.com/zh-Hans/video/BV11N4y127o7/?p=2'),regular);
});
