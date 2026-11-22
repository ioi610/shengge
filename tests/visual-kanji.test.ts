import test from 'node:test';
import assert from 'node:assert/strict';
import {corroborateCompound,hasUncertainCompound} from '../src/visual-kanji';
const glyphs=(text:string,p=0.99)=>Array.from(text,char=>({char,p}));
test('the weak 千 in the real frame recovers 干渉 without disturbing a confident 入',()=>{
 const primary=glyphs('入れるものが千渉してる'), raw=glyphs('人れるものが干渉してる');
 const i=primary.findIndex(g=>g.char==='千');primary[i].p=.58;raw[i].p=.84;
 assert.equal(hasUncertainCompound(primary),true);
 const chosen=corroborateCompound(primary,raw);
 assert.equal(chosen.map(g=>g.char).join(''),'入れるものが干渉してる');
 assert.equal(chosen[i].p,.84);
 assert.equal(primary[i].char,'千');
});
test('a conflicting neighbour, ambiguous second reading or strong first reading stays intact',()=>{
 const weak=glyphs('千渉');weak[0].p=.58;
 for(const alt of [glyphs('干歩'),glyphs('干渉',.7),glyphs('千渉'),glyphs('干')])assert.equal(corroborateCompound(weak,alt),weak);
 const strong=glyphs('千渉');assert.equal(hasUncertainCompound(strong),false);
 assert.equal(corroborateCompound(strong,glyphs('干渉')),strong);
});
