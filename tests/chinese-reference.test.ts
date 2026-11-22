import test from 'node:test';
import assert from 'node:assert/strict';
import {EnglishTranslation} from '../src/english-translation';
import {chineseReferenceInput} from '../src/chinese-reference';

test('one contiguous predicate keeps its aspect and sentence particles',()=>{
 for(const text of ['中奖了哟','抽中了喔','看见了哟！','摔倒了呀','中獎了喲'])assert.equal(chineseReferenceInput(text),text);
 for(const text of ['他中奖了哟','中奖 了哟','中奖，了哟','中奖了吗？','中奖了哟，抽中了喔']){
  const ordinary=[...new Intl.Segmenter('zh',{granularity:'word'}).segment(text)].map(p=>p.segment.trim()).filter(Boolean).join(' ');
  assert.equal(chineseReferenceInput(text),ordinary);
 }
});

test('a same-frame Chinese question reaches the local translator without becoming an explicit negative',async()=>{
 const inputs:{language:string;text:string}[]=[];
 const q=new EnglishTranslation({availability:async()=>'available',create:async({sourceLanguage})=>({destroy(){},translate:async(text:string)=>{
  inputs.push({language:sourceLanguage,text});
  return sourceLanguage==='ja'?'I feel like I can eat':text==='它 有没有 想要 吃掉 你'?'Does it want to eat you':'It has no wanna eat you';
 }})});
 await q.enable('ja');
 try{
  // Correcting the reference input alone does not resolve the separate Japanese
  // passive/potential ambiguity. Do not synthesize a different source subtitle.
  assert.equal(await q.translate('食べられそうになったり','ja','它有没有想要吃掉你'),'I feel like I can eat');
  assert.equal(inputs.find(input=>input.language==='zh')?.text,'它 有没有 想要 吃掉 你');
  await q.translate('食べられそうになったり','ja','它有没有想要吃掉你');
  assert.equal(inputs.length,2,'one draft and one reference decode; a repeated line uses the cache');
 }finally{q.disable();}
});

test('question boundaries keep both subject and object in their original order',()=>{
 assert.equal(chineseReferenceInput('它有没有想要吃掉你'),'它 有没有 想要 吃掉 你');
 assert.equal(chineseReferenceInput('你有没有想要吃掉它'),'你 有没有 想要 吃掉 它');
 assert.equal(chineseReferenceInput('它有没有吃掉你'),'它 有没有 吃掉 你');
 assert.equal(chineseReferenceInput('你有没有看到它'),'你 有没有 看到 它');
});

test('an independent negative stays negative inside and outside a question',()=>{
 assert.equal(chineseReferenceInput('它有没有不想要吃掉你'),'它 有没有 不 想要 吃掉 你');
 assert.equal(chineseReferenceInput('它没有想要吃掉你'),'它 没有 想要 吃掉 你');
 assert.equal(chineseReferenceInput('它并没有想要吃掉你'),'它 并 没有 想要 吃掉 你');
 assert.equal(chineseReferenceInput('你有沒有不想去'),'你 有沒有 不想 去');
});

test('multiple questions and surrounding punctuation do not merge or lose clauses',()=>{
 assert.equal(chineseReferenceInput('「有没有空？」有没有时间？'),'「 有没有 空 ？ 」 有没有 时间 ？');
 assert.equal(chineseReferenceInput('有没有？有沒有！'),'有没有 ？ 有沒有 ！');
 assert.equal(chineseReferenceInput('它有没有？\n你有没有？'),'它 有没有 ？ 你 有没有 ？');
});

test('word protection cannot manufacture a question across source boundaries',()=>{
 assert.equal(chineseReferenceInput('有 没有空'),'有 没有 空');
 assert.equal(chineseReferenceInput('有，没 有空'),'有 ， 没 有空');
 assert.equal(chineseReferenceInput('有。没有空'),'有 。 没有 空');
 assert.equal(chineseReferenceInput('有\n没有空'),'有 没有 空');
});

test('unrelated reference text retains ordinary segmentation and every source character',()=>{
 const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
 for(const text of ['我们才是要谢谢你们','来公开打印的照片啦','一起去吧','它是不是在吃东西？','这件事会不会发生？','有没有没有买的东西？']){
  const result=chineseReferenceInput(text);
  assert.equal(result.replace(/\s/gu,''),text.replace(/\s/gu,''));
  if(!text.includes('有没有'))assert.equal(result,[...segmenter.segment(text)].map(word=>word.segment.trim()).filter(Boolean).join(' '));
 }
});

test('the real printed invitation preserves its contiguous reduplicated verb in the reference input',async()=>{
 const inputs:{language:string;text:string}[]=[];
 const q=new EnglishTranslation({availability:async()=>'available',create:async({sourceLanguage})=>({destroy(){},translate:async(text:string)=>{
  inputs.push({language:sourceLanguage,text});return sourceLanguage==='ja'?'Yo, wanna ride?':'Yo, get in the car, go out, and go around?';
 }})});
 await q.enable('ja');
 try{
  await q.translate('よう乗っていくか','ja','哟上车出去转转吗');
  assert.equal(inputs.find(input=>input.language==='zh')?.text,'哟 上车 出去 转转 吗');
  await q.translate('よう乗っていくか','ja','哟上车出去转转吗');assert.equal(inputs.length,2);
 }finally{q.disable();}
});

test('two-character reduplication retains its written form without a vocabulary list',()=>{
 for(const [source,expected] of [
  ['出去转转','出去 转转'],['想想','想想'],['走走','走走'],['出去看看','出去 看看'],
  ['转转，想想，再走走。','转转 ， 想想 ， 再 走走 。'],['有没有出去转转？','有没有 出去 转转 ？'],
 ])assert.equal(chineseReferenceInput(source),expected);
});

test('reduplication cannot cross spaces, punctuation or line boundaries',()=>{
 for(const [source,expected] of [['转 转','转 转'],['转，转','转 ， 转'],['转\n转','转 转'],['转、转','转 、 转']]){
  assert.equal(chineseReferenceInput(source),expected);
 }
});

test('no characters are stolen from neighbouring multi-character words or longer repeated runs',()=>{
 const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
 for(const source of ['土地地面','大地地图','你好好学','字字句句','转转转','转转转转','想想想','看看看','有有有没有']){
  const ordinary=[...segmenter.segment(source)].map(token=>token.segment.trim()).filter(Boolean).join(' ');
  const expected=source==='有有有没有'?'有 有 有没有':ordinary;
  assert.equal(chineseReferenceInput(source),expected,source);
 }
});

test('word protection preserves all written characters around independent negatives and questions',()=>{
 for(const source of ['它有没有不想出去转转？','转转，不要看看而已。','有有有没有，转转转。','土地地面想想走走']){
  assert.equal(chineseReferenceInput(source).replace(/\s/gu,''),source.replace(/\s/gu,''));
 }
 assert.equal(chineseReferenceInput('它有没有不想出去转转？'),'它 有没有 不想 出去 转转 ？');
});
