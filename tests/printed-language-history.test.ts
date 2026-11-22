import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesPriorPrint,priorPrintedLines} from '../src/printed-language-history';
import type {Clip} from '../src/domain';
test('history cannot transfer a language from YouTube, another episode, or a different line at the same time',()=>{
 const turn={text:'なんか掛かってるぞ白米に',startMs:1100,endMs:3000,confidence:.94};
 const clip={videoKey:'bilibili:test:p1',durationMs:12000,segments:[
  {...turn,source:'turn',language:'ja'}, {...turn,startMs:6000,endMs:8100,text:'隣に見える',source:'turn',language:'ja'}]} as Clip;
 const history=priorPrintedLines([clip],clip.videoKey,12000);
 assert.ok(matchesPriorPrint(turn,history));
 assert.equal(matchesPriorPrint({...turn,text:'違うセリフです'},history),false);
 assert.equal(matchesPriorPrint({...turn,startMs:6000,endMs:8100},history),false);
 assert.deepEqual(priorPrintedLines([clip],'bilibili:test:p2',12000),[]);
 assert.deepEqual(priorPrintedLines([clip],'youtube:test',12000),[]);
 assert.deepEqual(priorPrintedLines([clip],clip.videoKey,13000),[]);
});
