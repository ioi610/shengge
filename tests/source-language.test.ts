import test from 'node:test';import assert from 'node:assert/strict';
import {SourceLanguage,languageCode,languageEvidence} from '../src/source-language';
test('a high-confidence English humming token cannot lock later Japanese speech to English',()=>{
 const s=new SourceLanguage();for(let i=0;i<10;i++)s.observe('Hmm.','english');assert.equal(s.language,undefined);
 s.observe('これはおいしいですね。','japanese');assert.equal(s.language,undefined);s.observe('一緒に食べましょう。','ja');assert.equal(s.language,'ja');
});
test('English videos remain English and a new video starts with no inherited language',()=>{
 const a=new SourceLanguage();a.observe('What are you doing today?','english');a.observe('We are going to the park.','en');assert.equal(a.language,'en');assert.equal(new SourceLanguage().language,undefined);a.reset();assert.equal(a.language,undefined);
});
test('script disagreement, short guesses and Japanese interjections do not establish a language',()=>{
 for(const [text,lang] of [['T-Go-On!','english'],['Hello there this is English.','japanese'],['うーん。','japanese']])assert.equal(languageEvidence(text,lang),undefined);
 assert.equal(languageCode('japanese'),'ja');assert.equal(languageCode('auto'),undefined);
});

test('decoder stage directions cannot establish or change the video language',()=>{
 const s=new SourceLanguage();
 for(const text of ['*growls*\n*makes a noise*','*Scream*','[background music]','（背景音楽）']){
  assert.equal(languageEvidence(text,'english'),undefined);s.observe(text,'english');
 }
 assert.equal(s.language,undefined);
 s.observe('これは日本語の会話です。','japanese');s.observe('次の日本語の会話です。','japanese');
 for(let i=0;i<3;i++)s.observe('*growls* *makes a noise*','english');assert.equal(s.language,'ja');
});
