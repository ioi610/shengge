import test from 'node:test';
import assert from 'node:assert/strict';
import {printedLetterMinimum} from '../src/visual-caption-reader';
import {VisualTurns} from '../src/visual-turns';

test('low-confidence singing separators do not discard otherwise legible Japanese letters',()=>{
 const text='す・き・や～きなんかすごくおいしい予～感～';
 const probabilities=[.999717,.995362,.999990,.965502,.890230,.631945,.999882,.999999,.999996,.788877,.999765,.999966,.999727,.999467,.999854,.999945,.999757,.999729,.659774,.999928,.935552];
 const glyphs=Array.from(text,(char,i)=>({char,p:probabilities[i]}));
 const reading={text,confidence:probabilities.reduce((a,b)=>a+b,0)/probabilities.length,min:printedLetterMinimum(glyphs)};
 assert.equal(reading.min,.788877);
 const turns=new VisualTurns(88000);
 for(let t=88000;t<=93000;t+=32)turns.hear(t,.9);
 turns.observe(90000,reading);turns.observe(90250,reading);
 assert.equal(turns.observe(91000)?.text,text,'the normal voice and stable-frame checks still apply');
 const weak= glyphs.map(g=>g.char==='か'?{...g,p:.599}:g);
 assert.equal(printedLetterMinimum(weak),.599);
 const rejected=new VisualTurns(88000);
 for(let t=88000;t<=93000;t+=32)rejected.hear(t,.9);
 rejected.observe(90000,{...reading,min:printedLetterMinimum(weak)});
 rejected.observe(90250,{...reading,min:printedLetterMinimum(weak)});
 assert.equal(rejected.observe(91000),undefined,'a weak kana remains rejected');
 assert.equal(printedLetterMinimum([{char:'～',p:.99}]),0);
});
