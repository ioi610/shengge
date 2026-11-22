import test from 'node:test';
import assert from 'node:assert/strict';
import {preservesJapaneseReading} from '../src/japanese-reading';
test('preserves a matching single Latin name, including a kana spelling beside kanji',()=>{
 for(const [source,draft]of [['焼きそば!','Yakisoba!'],['ヤキソバ','Yakisoba'],['ちいかわ!','Chiikawa!'],['ふりかけ','Furikake'],['ひらがな','Hiragana'],['カタカナ','Katakana'],['ｶﾀｶﾅ！','Katakana!']])assert.equal(preservesJapaneseReading(source,draft),true,source);
});
test('different names, idioms, ordinary glosses and full sentences remain eligible for refinement',()=>{
 for(const [source,draft]of [['焼きそば!','Yakiniku!'],['振りかけ!','Sprinkle!'],['お手柄','Hands-on'],['ふりかけを買って','Buy furikake.'],['焼きそばを食べた','Yakisoba'],['焼きそば、ください','Yakisoba'],['美味しい焼きそば','Yakisoba'],['食べたい焼きそば','Yakisoba'],['焼きそばと焼きそば','Yakisoba'],['かき氷','Shaved ice!'],['うん','Uh-huh!'],['んんん','Nnnnnn'],['漢字','Kanji'],['ちいかわ','Chikawa']])assert.equal(preservesJapaneseReading(source,draft),false,source);
});
test('a name witness remains position-sensitive and rejects incomplete kana sequences',()=>{
 for(const [source,draft]of [['焼きそば','Kisobayaki'],['ちいかわ焼','Yakichiikawa'],['焼ちいかわ焼','Chiikawa'],['ふっっかけ','Fuffukake'],['っあかけ','Aakake'],['ちいかわっ','Chiikawa'],['ーちいかわ','Chiikawa'],['ちぃかわ','Chiikawa']])assert.equal(preservesJapaneseReading(source,draft),false,source);
 assert.equal(preservesJapaneseReading('マッチャ','Matcha'),true);
});
