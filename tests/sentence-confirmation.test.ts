import test from 'node:test';import assert from 'node:assert/strict';import {SentenceConfirmation,encodePcmWav} from '../src/sentence-confirmation';
const first={startMs:400,endMs:3900,text:'这是一个测试音频',confidence:.95};
test('do not loop a provisional last fragment; confirm a complete sentence with stable text and following context',()=>{
 const c=new SentenceConfirmation();assert.equal(c.accept([{...first,endMs:1800,text:'这是一个'}],2000),undefined);assert.equal(c.accept([first],4500),undefined);assert.deepEqual(c.accept([first,{startMs:4300,endMs:5900,text:'下面我们',confidence:.9}],6000),first);
});
test('speaker change closes short replies without requiring a long silence or manual bounds',()=>{
 const c=new SentenceConfirmation(),reply={startMs:200,endMs:700,text:'はい',confidence:.9};assert.equal(c.accept([reply],900),undefined);assert.deepEqual(c.accept([reply],1100,true),reply);
});
test('reject unstable timings, changed wording and low confidence instead of fabricating one sentence',()=>{
 const c=new SentenceConfirmation();c.accept([first],4500);assert.equal(c.accept([{...first,text:'这是不一样的句子'}],4500,true),undefined);assert.equal(c.accept([{...first,confidence:.1}],4500,true),undefined);
});
test('PCM encoding produces exact mono 16 kHz WAV audio rather than a duration placeholder',()=>{const b=encodePcmWav(new Float32Array([0,.5,-.5]));const v=new DataView(b.buffer);assert.equal(new TextDecoder().decode(b.slice(0,4)),'RIFF');assert.equal(v.getUint32(24,true),16000);assert.equal(v.getUint32(40,true),6);assert.equal(v.getInt16(46,true),16384);});

test('do not silently skip an uncertain first utterance in favor of a later sentence',()=>{
 const c=new SentenceConfirmation(),rows=[{...first,confidence:.2},{startMs:4300,endMs:6000,text:'Second sentence.',confidence:.95}];
 c.accept(rows,7000,true);assert.equal(c.accept(rows,7000,true),undefined);
});

test('retain a stable short reply when later context lowers its token probability',()=>{
 const c=new SentenceConfirmation(),reply={startMs:300,endMs:2000,text:'おー',confidence:.84};
 const following={startMs:2290,endMs:4000,text:'やっはー',confidence:.9};
 assert.equal(c.accept([reply,following],6000),undefined);
 assert.deepEqual(c.accept([{...reply,confidence:.17},following],7500),{...reply,confidence:.17});
});

test('join an unfinished introductory clause before confirming a full sentence',()=>{
 const c=new SentenceConfirmation();const a={startMs:0,endMs:1800,text:'非常累的时候',confidence:.9},b={startMs:2000,endMs:4000,text:'我就想休息一下。',confidence:.9};assert.equal(c.accept([a],1900),undefined);assert.equal(c.accept([a,b],4600),undefined);const result=c.accept([a,b],5000);assert(result);assert.equal(result.endMs,4000);assert(result.text.includes('我就想'));
});

test('stable sentence end cannot confirm a drifting sentence beginning',()=>{const c=new SentenceConfirmation();c.accept([{...first,startMs:0}],4500,true);assert.equal(c.accept([{...first,startMs:1500}],4500,true),undefined);assert.equal(c.accept([{...first,startMs:1550}],4500,true)?.startMs,1550);});

test('explicit musical lyrics never become a spoken sentence even with high confidence',()=>{
 const c=new SentenceConfirmation();const song={startMs:0,endMs:3000,text:'♪ 夜に 眩しい 夢の中に ♪',confidence:.99};
 assert.equal(c.accept([song],4000,true),undefined);assert.equal(c.accept([song],4000,true),undefined);
});
test('confidence of confirmed timed words is supported by both readings',()=>{
 const c=new SentenceConfirmation();c.accept([{...first,confidence:.61}],4500,true);assert.equal(c.accept([{...first,confidence:.99}],4500,true)?.confidence,.61);
});

test('standalone recognizer music labels are non-dialogue, not spoken sentences about music',()=>{
 const c=new SentenceConfirmation();
 for(const text of ['音楽','Music','背景音乐']){const row={...first,text};assert.equal(c.accept([row],4500,true),undefined);assert.equal(c.accept([row],4500,true),undefined);}
 const row={...first,text:'I love music.'};c.accept([row],4500,true);assert.deepEqual(c.accept([row],4500,true),row);
});

test('moderate text confidence needs corroborated first-word audio instead of dropping a whole utterance',()=>{
 const rows=[{startMs:680,endMs:3140,text:'えっ! すごい! もう勉強?',confidence:.569,timing:'aligned' as const}];
 const without=new SentenceConfirmation();without.accept(rows,3264,true);assert.equal(without.accept(rows,3264,true),undefined);
 const withVoice=new SentenceConfirmation();withVoice.accept(rows,3264,true,true);assert.equal(withVoice.accept(rows,3264,true,true)?.text,rows[0].text);
});
