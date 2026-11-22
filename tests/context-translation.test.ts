import test from 'node:test';import assert from 'node:assert/strict';import {ContextTranslation,type DialogueSession} from '../src/context-translation';
test('each translation has isolated history, only receives the current phrase and its draft',async()=>{
 const inputs:any[]=[];let clones=0,destroyed=0;const base={clone:async()=>{clones++;return {destroy(){destroyed++;},async prompt(text:string,options:any){inputs.push({data:JSON.parse(text),options});return '{"translation":"Well done."}';}} as DialogueSession;},destroy(){},prompt:async()=>''};
 const q=new ContextTranslation({availability:async()=>'available',create:async()=>base});await q.enable('ja');assert.equal(await q.translate('お手柄','Hands-on'), 'Well done.');await q.translate('続き','Continuation');assert.equal(clones,2);assert.equal(destroyed,2);assert.deepEqual(inputs[0].data,{dialogue:'お手柄'});q.disable();
});
test('unavailable model never downloads; malformed or stale outputs cannot publish',async()=>{
 let creates=0;const unavailable=new ContextTranslation({availability:async()=>'downloadable',create:async()=>{creates++;throw Error();}});await unavailable.enable('ja');assert.equal(creates,0);assert.equal(await unavailable.translate('お手柄','Hands-on'),undefined);
 let release!:(x:string)=>void;const session={destroy(){},clone:async()=>session,prompt:()=>new Promise<string>(r=>release=r)};const q=new ContextTranslation({availability:async()=>'available',create:async()=>session});await q.enable('ja');const task=q.translate('原文','Original');await new Promise(r=>setImmediate(r));q.disable();release('{"translation":"obsolete"}');assert.equal(await task,undefined);
});
test('rejects an invented question instead of publishing the observed context leak',async()=>{
 const session={destroy(){},clone:async()=>session,async prompt(input:string){assert.deepEqual(JSON.parse(input),{dialogue:'なるほど'});return JSON.stringify({translation:'Oh, I see! What happened? Altar!'});}};
 const q=new ContextTranslation({availability:async()=>'available',create:async()=>session});await q.enable('ja');assert.equal(await q.translate('なるほど','I see.'),undefined);q.disable();
});
test('Japanese-only output cannot masquerade as an English translation',async()=>{
 const session={destroy(){},clone:async()=>session,async prompt(){return JSON.stringify({translation:'手柄'});}};const q=new ContextTranslation({availability:async()=>'available',create:async()=>session});await q.enable('ja');assert.equal(await q.translate('お手柄','Hands-on'),undefined);q.disable();
});
test('refinement cannot invent or remove explicit English negation',async()=>{
 let output='';const session={destroy(){},clone:async()=>session,async prompt(){return JSON.stringify({translation:output});}};
 const q=new ContextTranslation({availability:async()=>'available',create:async()=>session});await q.enable('ja');
 for(const value of ["It can't be treasure.",'It can’t be treasure.','It is not treasure.','No treasure.']){output=value;assert.equal(await q.translate('宝物なわけ',"It's a treasure"),undefined);}
 output='Go in there.';assert.equal(await q.translate('そこには入らないで',"Don't go there"),undefined);
 output="He wasn't that dangerous! No! There's a reason for this!";
 assert.equal(await q.translate('危ないやつだったのか!\n違う!\nわけがあるんだ!',"Was it a dangerous guy? No! There's a reason!"),undefined);
 output="Don't enter there.";assert.equal(await q.translate('そこには入らないで',"Don't go there"),output);
 output='No!';assert.equal(await q.translate('違う!','No!'),output);
 output='Excellent work.';assert.equal(await q.translate('お手柄','Hands-on'),output);q.disable();
});

test('refinement preserves a question even when Japanese ASR ended it with an exclamation mark',async()=>{
 const session={destroy(){},clone:async()=>session,async prompt(){return JSON.stringify({translation:'He was a dangerous type!'});}};
 const q=new ContextTranslation({availability:async()=>'available',create:async()=>session});await q.enable('ja');assert.equal(await q.translate('危ないやつだったのか!', 'Was it a dangerous guy?'),undefined);q.disable();
});

test('refinement cannot introduce a first-person participant absent from source and draft',async()=>{
 let output="It's a treasure, I say.";const session={destroy(){},clone:async()=>session,async prompt(){return JSON.stringify({translation:output});}};
 const q=new ContextTranslation({availability:async()=>'available',create:async options=>{assert.equal((options as any).temperature,0);assert.equal((options as any).topK,1);return session;}});await q.enable('ja');
 assert.equal(await q.translate('宝物なわけだ',"It's a treasure"),undefined);output="You're a credit to us.";assert.equal(await q.translate('お手柄','Hands-on'),undefined);q.disable();
});

test('refinement cannot erase the only concrete content of a full draft sentence',async()=>{
 let output="That's what it is, you know.";const session={destroy(){},clone:async()=>session,async prompt(){return JSON.stringify({translation:output});}};
 const q=new ContextTranslation({availability:async()=>'available',create:async()=>session});await q.enable('ja');assert.equal(await q.translate('宝物なわけだ',"It's a treasure"),undefined);
 output="It is a treasure.";assert.equal(await q.translate('宝物なわけだ',"It's a treasure"),output);
 output='Bravo!';assert.equal(await q.translate('お手柄','Hands-on'),output);q.disable();
});

test('an unchanged English wh-question can recover only its missing final punctuation',async()=>{
 let output='';const session={destroy(){},clone:async()=>session,async prompt(){return JSON.stringify({translation:output});}};
 const q=new ContextTranslation({availability:async()=>'available',create:async()=>session});await q.enable('ja');
 try{
  for(const [text,draft,value]of [
   ['なんだお前','What are you','What are you?'],
   ['鍵はどこ','Where is the key','Where is the key?'],
   ['なぜ行ける','Why can you go','Why can you go?'],
   ['どうやって開ける','How do you open it!','HOW  do you open it?'],
  ]){output=value;assert.equal(await q.translate(text,draft),value);}
 }finally{q.disable();}
});

test('missing punctuation repair cannot turn statements or exclamations into questions',async()=>{
 let output='';const session={destroy(){},clone:async()=>session,async prompt(){return JSON.stringify({translation:output});}};
 const q=new ContextTranslation({availability:async()=>'available',create:async()=>session});await q.enable('ja');
 try{
  for(const [text,draft,value]of [
   ['宝物なわけだ',"It's a treasure","It's a treasure?"],
   ['なんて宝物だ','What a treasure!','What a treasure?'],
   ['必要なもの','What you need','What you need?'],
   ['名前の所有形',"What is James'",'What is James?'],
   ['なんだお前','What are you','Who are you?'],
   ['なんだお前','What are you','What are you doing?'],
   ['なんだお前','What are you','What are you? What happened?'],
   ['宝物なわけだ',"It's a treasure","That's what it is, isn't it?"],
  ]){output=value;assert.equal(await q.translate(text,draft),undefined);}
 }finally{q.disable();}
});

test('question punctuation exception cannot bypass existing negation and person guards',async()=>{
 let output='';const session={destroy(){},clone:async()=>session,async prompt(){return JSON.stringify({translation:output});}};
 const q=new ContextTranslation({availability:async()=>'available',create:async()=>session});await q.enable('ja');
 try{
  output="Why can you go?";assert.equal(await q.translate('なぜ行けない',"Why can't you go"),undefined);
  output='What am I?';assert.equal(await q.translate('なんだお前','What are you'),undefined);
  output="Don't go in there.";assert.equal(await q.translate('そこには入らないで',"Don't go there"),output);
 }finally{q.disable();}
});
