import test from 'node:test';
import assert from 'node:assert/strict';
import {preferredSubtitleTrack,readableSubtitleTracks,readSubtitleCues,SubtitleTrack} from '../src/subtitles';
import {cueFingerprint} from '../src/domain';
const track=(language:string,text:string,mode='hidden'):SubtitleTrack=>({kind:'subtitles',language,label:language,mode,cues:[{startTime:1,endTime:2,text}]});

test('subtitle reading accepts arbitrary languages and unknown language tags without translation',()=>{
 for(const [language,text] of [['en','Hello!'],['zh-Hans','你好！'],['ja','こんにちは。'],['ko','안녕하세요'],['ar','مرحبًا'],['hi','नमस्ते'],['es','¡Hola!'],['xx-custom','Custom dialogue'],['','Unlabelled dialogue']]){
  const result=readableSubtitleTracks([track(language,text)]);assert.equal(result.length,1);assert.equal(result[0].cues[0].text,text);assert.equal(result[0].cues[0].startMs,1000);assert.equal(result[0].cues[0].endMs,2000);
 }
});
test('prefer the visible subtitle track and never merge parallel translations',()=>{
 const choices=readableSubtitleTracks([track('ja','こんにちは'),track('en','Hello','showing'),track('zh','你好')]);
 assert.equal(preferredSubtitleTrack(choices),choices[1]);assert.equal(preferredSubtitleTrack(choices)!.cues.length,1);assert.equal(preferredSubtitleTrack(choices)!.cues[0].text,'Hello');
 assert.notEqual(cueFingerprint(choices[0].cues),cueFingerprint(choices[1].cues));
});
test('subtitle selection falls back to loaded hidden track then first readable track',()=>{
 const choices=readableSubtitleTracks([track('en','Hello','disabled'),track('ar','مرحبا')]);assert.equal(preferredSubtitleTrack(choices),choices[1]);
 choices[1].track.mode='disabled';assert.equal(preferredSubtitleTrack(choices),choices[0]);assert.equal(preferredSubtitleTrack([]),undefined);
});
test('non-dialogue tracks, unavailable cues and invalid intervals are excluded',()=>{
 const base=track('en','Hello');assert.equal(readableSubtitleTracks([{...base,kind:'metadata'},{...base,kind:'chapters'},{...base,cues:null}]).length,0);
 assert.equal(readSubtitleCues({...base,kind:'captions'}).length,1);
 assert.deepEqual(readSubtitleCues({...base,cues:[{startTime:NaN,endTime:2,text:'invalid'},{startTime:-1,endTime:1,text:'invalid'},{startTime:2,endTime:1,text:'invalid'},{startTime:0,endTime:.0001,text:'rounded empty'},{startTime:1,endTime:2,text:' '},{startTime:1,endTime:2}]}),[]);
});
test('re-reading a track keeps its fingerprint stable and leaves the source untouched',()=>{
 const base=track('ar','مرحبًا');const before=JSON.stringify(base);const first=readSubtitleCues(base),second=readSubtitleCues(base);assert.equal(cueFingerprint(first),cueFingerprint(second));assert.notEqual(first[0].id,second[0].id);assert.equal(JSON.stringify(base),before);
});
