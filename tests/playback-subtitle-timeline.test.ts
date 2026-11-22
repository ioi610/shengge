import test from 'node:test';
import assert from 'node:assert/strict';
import {PlaybackSubtitleTimeline} from '../desktop/playback-subtitle-timeline';

test('late lines in one result each get screen time, including the last line at EOF',()=>{
 const subtitles=new PlaybackSubtitleTimeline();
 subtitles.add({start:1,end:2,text:'第一句'});
 subtitles.add({start:2,end:3,text:'第二句'});
 subtitles.add({start:2.1,end:3.1,text:'第二句。'});
 subtitles.add({start:4,end:4.4,text:'第三句'});
 assert.deepEqual([0,.5,1,2,3].map(clock=>subtitles.text(15,clock)),['第一句','第一句','第二句','第三句','']);
});

test('a seek clears late display work and restores cached text by media time',()=>{
 const subtitles=new PlaybackSubtitleTimeline();
 subtitles.add({start:8,end:10,text:'八秒'});
 subtitles.add({start:12,end:13,text:'十二秒'});
 assert.equal(subtitles.text(20,0),'八秒');
 subtitles.seek();
 assert.equal(subtitles.text(12.5,.1),'十二秒');
 assert.equal(subtitles.text(8.5,.2),'八秒');
 assert.equal(subtitles.text(0,.3),'');
});
