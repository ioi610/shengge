import test from 'node:test';
import assert from 'node:assert/strict';
import { VisualTurns, sameJapaneseSpeech } from '../src/visual-turns';
const caption = (text: string) => ({ text, confidence: 0.99, min: 0.93 });
const utterance = caption('しょっぱみがあってうま');
test('two separate held frames plus contemporaneous voice close at the visible line change', () => {
  const turns = new VisualTurns(920);
  for (const t of [950, 990, 1020]) turns.hear(t, 0.7);
  turns.observe(1000, utterance);
  turns.observe(1200, utterance);
  assert.equal(turns.observe(1390, caption('これは何')), undefined);
  assert.deepEqual(turns.observe(1580, caption('これは何')), {
    startMs: 920,
    endMs: 1320,
    text: utterance.text,
    confidence: 0.99,
  });
  assert.equal(turns.observe(1710), undefined);
});
test('silence, isolated frames, Chinese text, and low-confidence endings cannot start a replay', () => {
  for (const [read, speech, repeat] of [
    [utterance, false, true],
    [utterance, true, false],
    [caption('这个好吃'), true, true],
    [{ ...utterance, min: 0.25 }, true, true],
  ] as const) {
    const turns = new VisualTurns(0);
    if (speech) for (const t of [510, 550, 580]) turns.hear(t, 0.9);
    turns.observe(500, read);
    if (repeat) turns.observe(700, read);
    assert.equal(turns.observe(1030), undefined);
  }
});
test('Japanese print can corroborate an independently identified same-language recording', () => {
  const heard = (language: string, text: string) => ({
    language,
    segments: [{ text, confidence: 0.9, startMs: 0, endMs: 1200 }],
  });
  assert.ok(sameJapaneseSpeech(utterance.text, heard('japanese', 'しょっぱみがあってんの')));
  assert.equal(sameJapaneseSpeech(utterance.text, heard('english', utterance.text)), false);
  assert.equal(sameJapaneseSpeech(utterance.text, heard('ja', 'あなたは誰ですか')), false);
});

test('minor spacing and punctuation changes do not split the same printed utterance', () => {
  const t = new VisualTurns(0);
  for (let ms = 300; ms < 1600; ms += 34) t.hear(ms, 0.7);
  t.observe(320, caption('なんか 掛かってるぞ'));
  t.observe(515, caption('なんか掛かってるぞ。'));
  assert.equal(t.observe(740, caption('なんか掛かってるぞ')), undefined);
  assert.equal(t.observe(1040), undefined);
  assert.equal(t.observe(1270)?.startMs, 170);
});
test('only a complete closed run can supply the entire printed caption',()=>{
 const turns=new VisualTurns(12268),text='スイッチで…洞窟が開いて…友だちになりました';
 for(let at=12418;at<=16250;at+=200)turns.observe(at,caption(text),true);
 turns.observe(16250,caption(text),true);
 assert.equal(turns.completeMatching(12268,16370),undefined,'an open line cannot be assigned wholesale even when an acoustic interval overlaps');
 assert.ok(turns.openLine(12268,14768,16250),'an early acoustic half still belongs to this presently observed run');
 const closed=turns.observe(16900,undefined,true)!;
 assert.equal(closed.endMs,16370);
 assert.equal(turns.completeMatching(12268,14768),undefined);
 assert.equal(turns.completeMatching(14769,16370),undefined);
 assert.equal(turns.completeMatching(12268,16370),closed);
 assert.equal(turns.completeMatching(10000,20000),undefined,'a distant containing interval is not a whole-row caption match');
 assert.equal(turns.openLine(12268,14768,16900),undefined);
});
test('identical words after an observed disappearance remain two separate runs and a new search has no old run',()=>{
 const turns=new VisualTurns(0),read=caption('そうなんですね');
 turns.observe(500,read,true);turns.observe(700,read,true);
 const first=turns.observe(1250,undefined,true)!;
 turns.observe(1500,read,true);turns.observe(1700,read,true);
 const second=turns.observe(2250,undefined,true)!;
 assert.notEqual(first,second);
 assert.equal(turns.completeMatching(350,820),first);assert.equal(turns.completeMatching(1350,1820),second);
 assert.equal(turns.completeMatching(350,1820),undefined,'a broad interval spanning two repetitions cannot choose either by text equality');
 const afterSeek=new VisualTurns(1500);
 assert.equal(afterSeek.completeMatching(350,820),undefined);assert.equal(afterSeek.openLine(350,820,1700),undefined);
});
test('repeated speaker windows cannot manufacture independent voice bins', () => {
  const t = new VisualTurns(0);
  for (let i = 0; i < 20; i++) t.hear(400, 0.99);
  assert.equal(t.hasVoice(300, 600), false);
});
test('a same-frame translation hint needs two agreeing observations of this line', () => {
  const t = new VisualTurns(0);
  t.observe(300, { ...utterance, reference: '咸咸的好吃' }, true);
  t.observe(510, { ...utterance, reference: '完全不同' }, true);
  assert.equal(t.observe(1050, undefined, true)?.reference, undefined);
  t.observe(1300, { ...utterance, reference: '咸咸的好吃' }, true);
  t.observe(1530, { ...utterance, reference: '咸咸的好吃' }, true);
  assert.equal(t.observe(2060, undefined, true)?.reference, '咸咸的好吃');
});

test('later language confirmation returns an earlier spoken subtitle from the same listening window',()=>{
 const turns=new VisualTurns(0);
 for(const ms of [400,450,500,1800,1850,1900])turns.hear(ms,.8);
 turns.observe(400,caption('そうなんだ'));turns.observe(700,caption('そうなんだ'));
 const first=turns.observe(1200)!;
 turns.observe(1800,utterance);turns.observe(2000,utterance);
 const second=turns.observe(2550)!;
 assert.equal(turns.earliestSpokenThrough(second),first);
});

test('a long language check cannot erase contemporaneous voice evidence for an earlier closed line',()=>{
 const turns=new VisualTurns(0);
 for(const ms of [400,450,500])turns.hear(ms,.8);
 turns.observe(400,caption('見るの怖い'));turns.observe(700,caption('見るの怖い'));
 const first=turns.observe(1200)!;
 // Continued speech moves the bounded live voice buffer beyond the first
 // caption while automatic-language review is still waiting for a result.
 for(let ms=1500;ms<18000;ms+=32)turns.hear(ms,.8);
 assert.equal(turns.hasVoice(first.startMs,first.endMs),false);
 turns.observe(18000,utterance);turns.observe(18200,utterance);
 const next=turns.observe(18700,undefined,true)!;
 assert.equal(turns.earliestSpokenThrough(next),first);
});

test('a printed line that never had voice is not rescued by later unrelated speech',()=>{
 const turns=new VisualTurns(0);
 turns.observe(400,caption('見るの怖い'),true);turns.observe(700,caption('見るの怖い'),true);
 turns.observe(1200,undefined,true);
 for(let ms=1500;ms<18000;ms+=32)turns.hear(ms,.8);
 turns.observe(18000,utterance);turns.observe(18200,utterance);
 const next=turns.observe(18700,undefined,true)!;
 assert.equal(turns.earliestSpokenThrough(next),next);
});

test('closed print groups the real common-onset review estimates only for backpressure',async()=>{
 const {readFile}=await import('node:fs/promises');
 const f=JSON.parse(await readFile(new URL('./fixtures/bilibili-opening-printed-hold.json',import.meta.url),'utf8'));
 const turns=new VisualTurns(f.origin),reading=caption(f.line.text);
 for(let at=f.line.startMs+150;at<f.line.endMs-120;at+=500)turns.observe(at,reading,true);
 turns.observe(f.line.endMs-120,reading,true);
 assert.equal(turns.sharesReviewHold(f.reviews[0],f.reviews[1]),false,'an open row cannot justify grouping closed acoustic candidates');
 const closed=turns.observe(f.line.endMs+500,undefined,true)!;
 assert.deepEqual([closed.startMs,closed.endMs],[f.line.startMs,f.line.endMs]);
 assert.equal(turns.sharesReviewHold(f.reviews[0],f.reviews[1]),true);
 assert.equal(turns.sharesReviewHold({startMs:4000,endMs:6300},{startMs:4100,endMs:6400}),true,'strong overlap on both estimates can explain boundary jitter');
 assert.equal(turns.sharesReviewHold(f.reviews[0],f.reviews[2]),false,'disjoint same-print replies remain separate');
 assert.equal(turns.sharesReviewHold(f.reviews[1],f.reviews[2]),false,'a distinct nested onset is not inferred to be the same speaker');
 assert.equal(turns.sharesReviewHold(f.reviews[0],{...f.reviews[1],focused:true}),false);
 assert.equal(turns.sharesReviewHold(f.reviews[0],{...f.reviews[1],reason:'speaker-change'}),false);
 assert.equal(turns.sharesReviewHold({...f.reviews[0],reason:'speaker-change'},f.reviews[1]),false);
 assert.equal(turns.sharesReviewHold(f.reviews[0],{...f.reviews[1],endMs:f.line.endMs+321}),false,'new audio past the existing closing margin must still exert backpressure');
 const unseen=new VisualTurns(f.origin);
 assert.equal(unseen.sharesReviewHold(f.reviews[0],f.reviews[1]),false,'similar endpoints without observed stable print are insufficient');
 assert.equal(turns.spokenLines().length,0,'scheduling hints add neither speech evidence nor a language confirmation');
});
