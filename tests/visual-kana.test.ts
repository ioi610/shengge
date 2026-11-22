import test from 'node:test';
import assert from 'node:assert/strict';
import {corroborateKana,hasIsolatedKana,corroborateKanaGlyph,hasUncertainKanaGlyph} from '../src/visual-kana';
test('a raw reading can restore an isolated kana misread in the cleaned frame',()=>{
 const primary='あんまり変ねらなかったよ', raw='あんまり変わらなかったよ';
 assert.equal(hasIsolatedKana(primary),true);
 assert.equal(corroborateKana(primary,raw),raw);
 assert.equal(corroborateKana(raw,primary),raw);
});

const glyphs=(text:string,p=.999)=>Array.from(text,char=>({char,p}));
test('native pixels recover the weak isolated kanji in the real 00:07.4 kana phrase',()=>{
 const primary=glyphs('こ心なにいっぱいどうしたの'),raw=glyphs('こんなにいっぱいどうしたの');
 primary[1].p=.4859902560710907;raw[1].p=.9995517134666444;
 // A different raw glyph is weak, so accepting the entire raw line would
 // fail or lower confidence. Only the independently supported letter wins.
 raw[6].p=.516323447227478;
 assert.equal(hasUncertainKanaGlyph(primary),true);
 const chosen=corroborateKanaGlyph(primary,raw);
 assert.equal(chosen.map(g=>g.char).join(''),'こんなにいっぱいどうしたの');
 assert.equal(chosen[6],primary[6]);assert.equal(chosen[1],raw[1]);
 assert.equal(primary[1].char,'心');
});
test('kana repair requires one weak isolated kanji and strong agreeing neighbours',()=>{
 const primary=glyphs('こ心なにいっぱい');primary[1].p=.48;
 for(const alt of [glyphs('こんなにいっばい'),glyphs('こんなにいっぱ'),glyphs('こんなにいっぱい',.97),glyphs('こんなにいっぱい',.89)])
  assert.equal(corroborateKanaGlyph(primary,alt),primary);
 const strong=glyphs('こ心なにいっぱい');
 assert.equal(corroborateKanaGlyph(strong,glyphs('こんなにいっぱい')),strong);
 const compound=glyphs('安心なの');compound[1].p=.48;
 assert.equal(corroborateKanaGlyph(compound,glyphs('安んだの')),compound);
});
test('a different word, script or kana size cannot overwrite the primary reading',()=>{
 for(const [primary,raw] of [['これはね','これはわ'],['なんか変ね','なんか変'],['ちょっと','ちよっと'],['ひとりごつ','ひとリごっ']])
  assert.equal(corroborateKana(primary,raw),primary);
 assert.equal(hasIsolatedKana('しょっぱみがあってうま'),false);
});
