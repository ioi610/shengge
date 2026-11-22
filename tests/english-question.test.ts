import test from 'node:test';import assert from 'node:assert/strict';
import {punctuateBareQuestion} from '../src/english-question';

test('bare questions with wh and auxiliary order gain only a terminal question mark',()=>{
 for(const draft of ['What are you','Where is the key','Why can you go','How do you open it','When will they arrive','WHO  IS THERE'])assert.equal(punctuateBareQuestion(draft),draft+'?');
});

test('existing punctuation, statements, fragments and compound drafts are not reinterpreted',()=>{
 for(const draft of [
  'What are you!','What are you?','What are you.','What are you…',
  "It's a treasure",'What a treasure','What you need','What are',
  "What is James'",'Where is the key, he asked','Where is the key; tell me',
  'Where is the key\nTell me','Where is the key. Tell me','Where is the key — tell me',
  '"Where is the key"','Where is Dr. Smith','',
 ])assert.equal(punctuateBareQuestion(draft),draft);
});
