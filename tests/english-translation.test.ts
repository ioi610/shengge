import test from 'node:test';import assert from 'node:assert/strict';import {EnglishTranslation} from '../src/english-translation';
import {readFile} from 'node:fs/promises';
import {printedStarRating} from '../src/printed-star-rating';
import {pairedSpeakerNumber} from '../src/english-translation';
import {pairedPrizeReaction} from '../src/english-translation';

test('the paired prize reaction repairs the hit sense without guessing its subject',async()=>{
 const q=new EnglishTranslation({availability:async()=>'unavailable',create:async()=>({destroy(){},translate:async()=> 'Wow, that was a great hit'})});
 await q.enable('ja');
 try{assert.equal(await q.translate('えッすごい当たったんだ','ja','诶好厉害中奖啦'),'Wow, that was a great win');}
 finally{q.disable();}
 for(const [source,hint,draft] of [
  ['ボールが当たった','诶好厉害中奖啦','That was a great hit'],
  ['えッすごい当たったんだ','好厉害没中奖','Wow, that was a great hit'],
  ['えッすごい当たったんだ','诶好厉害中奖了吗','Wow, that was a great hit'],
  ['えッすごい当たったんだ','好厉害中奖啦','Was it a great hit?'],
  ['えッすごい当たったんだ','好厉害中奖啦','Wow, you hit the ball'],
 ])assert.equal(pairedPrizeReaction(source,hint,draft),undefined);
});

test('a printed prize win resolves a bare Japanese hit/win without another translation pass',async()=>{
 const calls:string[]=[];
 const translator=new EnglishTranslation({availability:async()=>'available',create:async()=>({destroy(){},translate:async text=>{
  calls.push(text);return text.startsWith('賞品が')?'I got a prize':'It hit.';
 }})});
 await translator.enable('ja');
 try{
  for(const [source,hint] of [['当たったんです','中奖了哟'],['当たりました！','我中獎了喲！']]){
   calls.length=0;
   assert.equal(await translator.translate(source,'ja',hint),'I got a prize');
   assert.equal(await translator.translate(source,'ja',hint),'I got a prize');
   assert.deepEqual(calls,['賞品が'+source]);
  }
  for(const [source,hint] of [['当たったんです','他中奖了哟'],['当たったんです','中奖了吗？'],['当たったんです','没中奖'],
   ['当たったんです','猜中了哟'],['当たったんです',''],['宝くじが当たった','中奖了哟'],['当たったの？','中奖了哟'],
   ['えッすごい当たったんだ','诶好厉害中奖啦'],['ボールが当たった','中奖了哟'],['当たらなかった','中奖啦']]){
   calls.length=0;await translator.translate(source,'ja',hint);
   assert.ok(!calls.some(text=>text.startsWith('賞品が')),source+' / '+hint);
  }
 }finally{translator.disable();}
});

test('a clarified prize reading cannot introduce money, a named award or another person',async()=>{
 for(const value of ['I won the lottery','He won a prize','I got a cash prize','I got the award','']){
  const translator=new EnglishTranslation({availability:async()=>'unavailable',create:async()=>({destroy(){},translate:async input=>input.startsWith('賞品が')?value:'It hit.'})});
  await translator.enable('ja');
  try{assert.equal(await translator.translate('当たったんです','ja','中奖了哟'),'It hit.');}finally{translator.disable();}
 }
});

test('explicit plural gratitude retains the contrast and the original action',()=>{
 const draft='I am the one who should thank you';
 const gloss='We just want to thank you';
 assert.equal(pairedSpeakerNumber('こちらこそありがとう','我们才是要谢谢你们',draft,gloss),'We are the ones who should thank you');
 for(const [source,reference,translation] of [['私こそありがとう','我们才是要谢谢你们',gloss],
  ['こちらこそありがとう','我才是要谢谢你','I should thank you'],['こちらこそありがとう','我们才是要谢谢你们','They should thank you']]){
  assert.equal(pairedSpeakerNumber(source,reference,draft,translation),draft);
 }
 assert.equal(pairedSpeakerNumber('こちらこそ','我们才是','I am the one who knows',gloss),'I am the one who knows');
});

test('matching printed star ratings preserve the count, establishment and question',async()=>{
 const q=new EnglishTranslation({availability:async()=>'available',create:async()=>({destroy(){},translate:async()=>{throw Error('a numeric rating needs no model');}})});
 await q.enable('ja');
 try{
  assert.equal(await q.translate('ミツ星レストラン','ja','三星饭店吗'),'A three-star restaurant?');
  assert.equal(await q.translate('三ツ星レストラン','ja','三星饭店吗'),'A three-star restaurant?');
  assert.equal(await q.translate('５つ星のホテル','ja','五星級酒店'),'A five-star hotel.');
  assert.equal(await q.translate('一つ星の旅館？','ja','一星旅馆'),'A one-star inn?');
 }finally{q.disable();}
});

test('ambiguous names, extra clauses and disagreements keep the regular translation',()=>{
 for(const [jp,zh] of [['サムスンホテル','三星饭店吗'],['三ツ星レストラン','二星餐厅吗'],
  ['ツ星レストラン','三星饭店吗'],['四つ星ホテル','四星餐廳'],['三ツ星レストラン','三星餐厅的菜单'],
  ['ミツ星レストラン','三星'],['三ツ星レストラン','十三星餐厅吗']]){
  assert.equal(printedStarRating(jp,zh),undefined);
 }
});

test('a confirmed rating within a longer sentence retains the whole source clause',async()=>{
 const inputs:string[]=[];
 const q=new EnglishTranslation({availability:async()=>'available',create:async()=>({destroy(){},translate:async(line)=>{
  inputs.push(line);
  return line.endsWith('じゃない')?'Not a 3 star restaurant':'Welcome to a 3 star restaurant';
 }})});
 await q.enable('ja');
 try{
  assert.equal(await q.translate('ミツ星レストランにようこそ','ja','欢迎来到三星饭店'),'Welcome to a 3 star restaurant');
  assert.equal(await q.translate('三ツ星レストランじゃない','ja','不是三星餐厅'),'Not a 3 star restaurant');
  assert.deepEqual(inputs,['3つ星のレストランにようこそ','3つ星のレストランじゃない']);
 }finally{q.disable();}
});
test('translation receives original text and leaves it intact, coalescing duplicate work',async()=>{
 let calls=0;const q=new EnglishTranslation({availability:async()=>'available',create:async o=>{assert.deepEqual(o,{sourceLanguage:'ja',targetLanguage:'en'});return {destroy(){},async translate(text){assert.equal(text,'こんにちは。');calls++;return 'Hello.';}};}});
 await q.enable('japanese');assert.deepEqual(await Promise.all([q.translate('こんにちは。','ja'),q.translate('こんにちは。','japanese')]),['Hello.','Hello.']);assert.equal(calls,1);assert.equal(await q.translate('こんにちは。','en'),undefined);q.disable();
});
test('late translation cannot publish after disabling or changing language',async()=>{
 let release!:(v:string)=>void;let destroyed=0;const q=new EnglishTranslation({availability:async()=>'available',create:async()=>({destroy(){destroyed++;},translate:()=>new Promise(r=>release=r)})});
 await q.enable('ja');const pending=q.translate('原文','ja');await new Promise(r=>setImmediate(r));q.disable();release('obsolete');assert.equal(await pending,undefined);assert.equal(destroyed,1);
});
test('fallback translates every ASR clause separately instead of losing a later line',async()=>{
 const calls:string[]=[];const q=new EnglishTranslation({availability:async()=>'available',create:async()=>({destroy(){},async translate(text){calls.push(text);return text==='最初の文'?'First sentence.':'Second sentence.';}})});
 await q.enable('ja');assert.equal(await q.translate('最初の文\n次の文','ja'),'First sentence. Second sentence.');assert.deepEqual(calls,['最初の文','次の文']);q.disable();
});

test('each clause is refined independently so an interjection cannot rewrite neighbouring dialogue',async t=>{
 const inputs:string[]=[];const original=Object.getOwnPropertyDescriptor(globalThis,'LanguageModel');
 Object.defineProperty(globalThis,'LanguageModel',{configurable:true,value:{availability:async()=>'available',create:async()=>({destroy(){},clone:async()=>({destroy(){},prompt:async(input:string)=>{const {dialogue}=JSON.parse(input);inputs.push(dialogue);return JSON.stringify({translation:dialogue==='やっ!'?'Hey!':'Okay!'});}})})}});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'LanguageModel',original);else Reflect.deleteProperty(globalThis,'LanguageModel');});
 const q=new EnglishTranslation({availability:async()=>'available',create:async()=>({destroy(){},translate:async()=> 'Okay!'})});await q.enable('ja');
 assert.equal(await q.translate('やっ!\nいい!','ja'),'Hey! Okay!');assert.deepEqual(inputs,['やっ!','いい!']);q.disable();
});

test('a bare browser question publishes without asking the optional model to reinterpret it',async t=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'LanguageModel');let translates=0,prompts=0;
 Object.defineProperty(globalThis,'LanguageModel',{configurable:true,value:{availability:async()=>'available',create:async()=>({destroy(){},clone:async()=>({destroy(){},prompt:async(input:string)=>{assert.equal(JSON.parse(input).dialogue,'なんだお前');prompts++;return JSON.stringify({translation:'What are you!'});}})})}});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'LanguageModel',original);else Reflect.deleteProperty(globalThis,'LanguageModel');});
 const q=new EnglishTranslation({availability:async()=>'available',create:async()=>({destroy(){},async translate(text){assert.equal(text,'なんだお前');translates++;return 'What are you';}})});
 try{
  await q.enable('ja');assert.equal(await q.translate('なんだお前','ja'),'What are you?');
  assert.equal(await q.translate('なんだお前','ja'),'What are you?');assert.equal(translates,1);assert.equal(prompts,0);
 }finally{q.disable();}
});

test('fallback completes only bare questions and preserves the browser draft existing exclamation',async()=>{
 let draft='What are you';const q=new EnglishTranslation({availability:async()=>'available',create:async()=>({destroy(){},translate:async()=>draft})});
 try{
  await q.enable('ja');assert.equal(await q.translate('最初の問い','ja'),'What are you?');
  draft='How could you!';assert.equal(await q.translate('驚いた声','ja'),'How could you!');
  draft="It's a treasure";assert.equal(await q.translate('宝物なわけだ','ja'),"It's a treasure");
 }finally{q.disable();}
});

test('adding a question mark cannot authorize the real observed semantic rewrite',async t=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/bilibili-question-refinement.json',import.meta.url),'utf8'));
 const original=Object.getOwnPropertyDescriptor(globalThis,'LanguageModel');let translates=0,prompts=0;
 Object.defineProperty(globalThis,'LanguageModel',{configurable:true,value:{availability:async()=>'available',create:async()=>({destroy(){},clone:async()=>({destroy(){},prompt:async(input:string)=>{assert.equal(JSON.parse(input).dialogue,fixture.text);prompts++;return fixture.raw;}})})}});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'LanguageModel',original);else Reflect.deleteProperty(globalThis,'LanguageModel');});
 const q=new EnglishTranslation({availability:async()=>'available',create:async()=>({destroy(){},translate:async()=>{translates++;return fixture.draft;}})});
 try{
  await q.enable('ja');assert.equal(await q.translate(fixture.text,'ja'),'What are you?');
  assert.equal(await q.translate(fixture.text,'ja'),'What are you?');assert.equal(translates,1);assert.equal(prompts,0);
 }finally{q.disable();}
});

test('only newly punctuated drafts bypass refinement, preserving other guarded refinements',async t=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'LanguageModel');let draft='',refined='',prompts=0;
 Object.defineProperty(globalThis,'LanguageModel',{configurable:true,value:{availability:async()=>'available',create:async()=>({destroy(){},clone:async()=>({destroy(){},prompt:async()=>{prompts++;return JSON.stringify({translation:refined});}})})}});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'LanguageModel',original);else Reflect.deleteProperty(globalThis,'LanguageModel');});
 const q=new EnglishTranslation({availability:async()=>'available',create:async()=>({destroy(){},translate:async()=>draft})});
 try{
  await q.enable('ja');let i=0;
  for(const [before,after,expected] of [
   ['Where is the key','Where is the key? What happened?','Where is the key?'],
   ['What are you','Who are you?','What are you?'],
   ['How do you open it','HOW  do you open it?','How do you open it?'],
   ['Where is the key?','Where is your key?','Where is your key?'],
   ["Don't go there","Don't enter there.","Don't enter there."],
   ['How could you!','How could you!','How could you!'],
  ]){draft=before;refined=after;assert.equal(await q.translate('質問の言葉'+i++,'ja'),expected);}
  assert.equal(prompts,3);
 }finally{q.disable();}
});


test('a source-matched name publishes without the observed rewrite into a different dish',async t=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/japanese-name-refinement.json',import.meta.url),'utf8'));
 const original=Object.getOwnPropertyDescriptor(globalThis,'LanguageModel');let prompts=0;
 Object.defineProperty(globalThis,'LanguageModel',{configurable:true,value:{availability:async()=>'available',create:async()=>({destroy(){},clone:async()=>({destroy(){},prompt:async()=>{prompts++;return fixture.raw;}})})}});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'LanguageModel',original);else Reflect.deleteProperty(globalThis,'LanguageModel');});
 const q=new EnglishTranslation({availability:async()=>'available',create:async()=>({destroy(){},translate:async()=>fixture.draft})});
 try{await q.enable('ja');assert.equal(await q.translate(fixture.text,'ja'),fixture.draft);assert.equal(prompts,0);}
 finally{q.disable();}
});

test('an optional model starting slowly does not withhold the ready English subtitle',async t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'LanguageModel');
 let finish!:(v:string)=>void;
 Object.defineProperty(globalThis,'LanguageModel',{configurable:true,value:{availability:()=>new Promise(r=>{finish=r;})}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'LanguageModel',previous);else Reflect.deleteProperty(globalThis,'LanguageModel');});
 const translator=new EnglishTranslation({availability:async()=>'available',create:async()=>({destroy(){},translate:async()=>'Hello.'})});
 try{await translator.enable('ja');assert.equal(await translator.translate('こんにちは','ja'),'Hello.');}
 finally{finish('unavailable');translator.disable();}
});

test('an aligned printed translation preserves a missing predicate before an infinitive',async()=>{
 const {choosePairedTranslation}=await import('../src/english-translation');
 const gloss='It seems that it was very natural to pretend to be cute just now.';
 assert.equal(choosePairedTranslation('It seems to be cute just now.',"It's kind of like nature now",gloss),gloss);
 assert.equal(choosePairedTranslation('I want to go.','Go.','They want to go.'),'I want to go.');
 assert.equal(choosePairedTranslation('It seems to be quiet.','Quiet.'),'It seems to be quiet.');
});

test('an invitation requires independent Japanese and Chinese evidence from the same line',async()=>{
 const {pairedInvitation}=await import('../src/english-translation');
 const gloss="Let's have lunch together";
 assert.equal(pairedInvitation('お昼ごはん一緒に食べない','午饭我们一起吃吧',gloss),gloss);
 assert.equal(pairedInvitation('一緒に行きませんか','要不要一起去','Shall we go together?'),'Shall we go together?');
 assert.equal(pairedInvitation('一緒に食べない','我们不一起吃饭',gloss),undefined);
 assert.equal(pairedInvitation('一緒に食べない','午饭我们一起吃吧',"I don't eat lunch together"),undefined);
 assert.equal(pairedInvitation('一人で食べる','午饭我们一起吃吧',gloss),undefined);
 assert.equal(pairedInvitation('一緒に食べない',undefined,gloss),undefined);
});

test('a remembered translation preference cannot download a model without a fresh gesture',async()=>{
 for(const state of ['available','downloading','downloadable','unavailable']){
  let creates=0;
  const q=new EnglishTranslation({availability:async()=>state,create:async()=>{creates++;throw Error('unexpected download');}});
  assert.equal(await q.canResume('ja'),state==='available');
  assert.equal(creates,0);
 }
});

test('same-frame encouragement disambiguates standalone よし while a reed remains a reed',async()=>{
 const calls:string[]=[];
 const q=new EnglishTranslation({availability:async()=>'unavailable',create:async()=>({destroy(){},async translate(line){
  calls.push(line);return line==='よし！'?'All right!':'Reed';
 }})});
 await q.enable('ja');
 try{
  assert.equal(await q.translate('よし','ja','来吧'),'All right!');
  assert.equal(await q.translate('よし','ja','芦苇'),'Reed');
  assert.equal(await q.translate('よし','ja'),'Reed');
  assert.equal(await q.translate('葦','ja','来吧'),'Reed');
  assert.equal(calls.filter(s=>s==='よし！').length,1);
 }finally{q.disable();}
});

test('a paired short prohibition retains its polarity and the object-specific verb',async()=>{
 const {pairedProhibition}=await import('../src/english-translation');
 assert.equal(pairedProhibition('かけるな','不许加',"Don't call",'Not allowed to add'),"Don't add.");
 assert.equal(pairedProhibition('かけるな','别打电话',"Don't add","Don't call"),"Don't call.");
 assert.equal(pairedProhibition('かけるな','不许加',"Don't call your friend",'Not allowed to add'),undefined);
 assert.equal(pairedProhibition('かけるな','可以加',"Don't call",'Add'),undefined);
 assert.equal(pairedProhibition('かけるな','不许加',"Don't call",'You should add'),undefined);
 assert.equal(pairedProhibition('かけて','不许加',"Don't call",'Not allowed to add'),undefined);
 assert.equal(pairedProhibition('かけるな',undefined,"Don't call",'Not allowed to add'),undefined);
});
