import test from 'node:test';
import assert from 'node:assert/strict';
import {EnglishTranslation} from '../src/english-translation';
import {pairedReferentProbe,resolvePairedReferent} from '../src/paired-referent';

const source='プリントしたヤツお披露目',reference='来公开打印的照片啦',draft='Unveiling the printed guy',gloss='to print photos in public';

test('the real paired print/photo ambiguity keeps unveiling and repairs only its referent',async()=>{
 const calls:{source:string;text:string}[]=[],created:string[]=[];
 const translator=new EnglishTranslation({availability:async()=>'available',create:async({sourceLanguage})=>{
  created.push(sourceLanguage);
  return {destroy(){},async translate(text){
   calls.push({source:sourceLanguage,text});
   if(sourceLanguage==='ja')return 'Unveiling the printed guy';
   const compact=text.replace(/\s/gu,'');
   return compact==='照片'?'Photo':compact==='打印的照片'?'printed photo':'to print photos in public';
  }};
 }});
 await translator.enable('ja');
 try{
  const source='プリントしたヤツお披露目',reference='来公开打印的照片啦';
  assert.equal(await translator.translate(source,'ja',reference),'Unveiling the printed photo');
  assert.equal(await translator.translate(source,'ja',reference),'Unveiling the printed photo');
  assert.equal(source,'プリントしたヤツお披露目');
  assert.deepEqual(created,['ja','zh'],'reuse the existing reference translator');
  assert.equal(calls.length,4,'one normal draft/gloss plus two bounded short checks; cached repeats add nothing');
  assert.ok(calls.some(call=>call.text==='打印的照片'),'keep the short attributive phrase intact');
 }finally{translator.disable();}
});

test('the same rule uses independently translated heads for baked cake and written letter',()=>{
 for(const [jp,zh,en,full,noun,phrase,expected] of [
  ['焼いたやつを見せる','给你看看烤的蛋糕','Show the baked guy.','Show the baked cake.','Cake','Baked cake','Show the baked cake.'],
  ['書いた奴を送らない','不要寄写的信',"Don't send the written guy.","Don't send the written letter.",'Letter','Written letter',"Don't send the written letter."],
 ]){
  const request=pairedReferentProbe(jp,zh,en,full);assert.ok(request);
  assert.equal(resolvePairedReferent(request,noun,phrase),expected);
 }
});

test('only the ambiguous noun changes; the rest of a longer question is preserved exactly',()=>{
 const en='Will we unveil only the printed guy again tomorrow, or not?';
 const request=pairedReferentProbe('明日プリントしたヤツだけもう一度お披露目？','明天只再公开打印的照片吗',en,'Will we show the printed photo again tomorrow?');assert.ok(request);
 const result=resolvePairedReferent(request,'Photo','printed photo');
 assert.equal(result,'Will we unveil only the printed photo again tomorrow, or not?');
 assert.equal(result!.replace('photo','guy'),en);
});

test('plural referents and explicit human nouns are not guessed into singular objects',()=>{
 for(const [jp,zh,en] of [
  ['プリントしたヤツらお披露目',reference,draft],
  ['プリントしたやつたちお披露目',reference,draft],
  [source,reference,'Unveiling the printed guys'],
  ['プリントした人を紹介する','介绍打印的人','Introducing the printed guy'],
  ['雇ったヤツを紹介する','介绍雇的员工','Introducing the hired guy'],
  ['買った奴隷を紹介する','介绍买的照片','Introducing the bought guy'],
 ])assert.equal(pairedReferentProbe(jp,zh,en,gloss),undefined);
 const request=pairedReferentProbe(source,reference,draft,gloss)!;
 for(const noun of ['Photos','People','Photo frame','He','Person'])assert.equal(resolvePairedReferent(request,noun,'printed photo'),undefined);
});

test('ambiguous Chinese heads, mismatched modifiers and missing same-line evidence retain the draft',()=>{
 for(const [jp,zh,en,full] of [
  [source,undefined,draft,gloss],
  [source,'照片',draft,gloss],
  [source,'来公开打印的照片和信啦',draft,gloss],
  [source,'来公开昨天的打印的照片啦',draft,gloss],
  [source,'来公开打印的照片，大家看看吧',draft,gloss],
  ['「プリントしたヤツ」と言った',reference,draft,gloss],
  ['プリントしたヤツと焼いたヤツ',reference,draft,gloss],
  [source,reference,'The guy is unveiling the printed guy',gloss],
 ])assert.equal(pairedReferentProbe(jp!,zh,en!,full),undefined);
 const request=pairedReferentProbe(source,reference,draft,gloss)!;
 for(const phrase of ['cropped photo','to print photos in public','printed color photo','no printed photo','printed letter','Photo']){
  assert.equal(resolvePairedReferent(request,'Photo',phrase),undefined);
 }
 const unrelated=pairedReferentProbe(source,reference,draft,'Show the printed letter')!;
 assert.equal(resolvePairedReferent(unrelated,'Photo','printed photo'),undefined);
});

test('failed local corroboration makes no further probes and does not adopt the incorrect whole gloss',async()=>{
 const calls:string[]=[];
 const translator=new EnglishTranslation({availability:async()=>'available',create:async({sourceLanguage})=>({destroy(){},async translate(text){
  calls.push(sourceLanguage+':'+text);
  return sourceLanguage==='ja'?draft:text==='照片'?'Photo':text==='打印的照片'?'cropped photo':gloss;
 }})});
 await translator.enable('ja');
 try{assert.equal(await translator.translate(source,'ja',reference),draft);assert.equal(calls.length,4);}
 finally{translator.disable();}
});

test('ineligible human/plural lines do not incur extra native queries',async()=>{
 for(const [jp,zh,en] of [['プリントした人お披露目',reference,draft],[source,reference,'Unveiling the printed guys']]){
  let calls=0;
  const translator=new EnglishTranslation({availability:async()=>'available',create:async({sourceLanguage})=>({destroy(){},async translate(){calls++;return sourceLanguage==='ja'?en:gloss;}})});
  await translator.enable('ja');
  try{assert.equal(await translator.translate(jp,'ja',zh),en);assert.equal(calls,2);}
  finally{translator.disable();}
 }
});

test('changing language while the short checks run cannot publish their correction',async()=>{
 let finish!:(value:string)=>void,entered!:(value?:unknown)=>void;
 const started=new Promise(resolve=>entered=resolve),late=new Promise<string>(resolve=>finish=resolve);
 const translator=new EnglishTranslation({availability:async()=>'available',create:async({sourceLanguage})=>({destroy(){},async translate(text){
  if(sourceLanguage==='ja')return draft;
  if(text==='照片'){entered();return late;}
  return text==='打印的照片'?'printed photo':gloss;
 }})});
 await translator.enable('ja');
 const result=translator.translate(source,'ja',reference);await started;translator.disable();finish('Photo');
 assert.equal(await result,undefined);
});
