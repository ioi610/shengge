/** A conservative spelling witness for an already translated, single Latin
 * name. This is not a dictionary or a translator: unmatched words keep the
 * normal translation path, and no source text is rewritten. */
const syllables:Record<string,string>={
 あ:'a',い:'i',う:'u',え:'e',お:'o',か:'ka',き:'ki',く:'ku',け:'ke',こ:'ko',
 さ:'sa',し:'shi',す:'su',せ:'se',そ:'so',た:'ta',ち:'chi',つ:'tsu',て:'te',と:'to',
 な:'na',に:'ni',ぬ:'nu',ね:'ne',の:'no',は:'ha',ひ:'hi',ふ:'fu',へ:'he',ほ:'ho',
 ま:'ma',み:'mi',む:'mu',め:'me',も:'mo',や:'ya',ゆ:'yu',よ:'yo',ら:'ra',り:'ri',る:'ru',れ:'re',ろ:'ro',わ:'wa',を:'o',ん:'n',
 が:'ga',ぎ:'gi',ぐ:'gu',げ:'ge',ご:'go',ざ:'za',じ:'ji',ず:'zu',ぜ:'ze',ぞ:'zo',だ:'da',ぢ:'ji',づ:'zu',で:'de',ど:'do',
 ば:'ba',び:'bi',ぶ:'bu',べ:'be',ぼ:'bo',ぱ:'pa',ぴ:'pi',ぷ:'pu',ぺ:'pe',ぽ:'po',
 きゃ:'kya',きゅ:'kyu',きょ:'kyo',しゃ:'sha',しゅ:'shu',しょ:'sho',ちゃ:'cha',ちゅ:'chu',ちょ:'cho',にゃ:'nya',にゅ:'nyu',にょ:'nyo',
 ひゃ:'hya',ひゅ:'hyu',ひょ:'hyo',みゃ:'mya',みゅ:'myu',みょ:'myo',りゃ:'rya',りゅ:'ryu',りょ:'ryo',
 ぎゃ:'gya',ぎゅ:'gyu',ぎょ:'gyo',じゃ:'ja',じゅ:'ju',じょ:'jo',びゃ:'bya',びゅ:'byu',びょ:'byo',ぴゃ:'pya',ぴゅ:'pyu',ぴょ:'pyo',
};
function reading(kana:string){
 let result='',double=false;
 for(let i=0;i<kana.length;i++){
  if(kana[i]==='っ'){if(double)return;double=true;continue;}
  if(kana[i]==='ー'){if(double||!/[aeiou]$/.test(result))return;result+=result.at(-1);continue;}
  const pair=syllables[kana.slice(i,i+2)],part=pair??syllables[kana[i]];if(!part)return;
  if(double){if(!/^[bcdfghjklmnpqrstvwxyz]/.test(part))return;result+=part.startsWith('ch')?'t':part[0];double=false;}
  result+=part;if(pair)i++;
 }
 return double?undefined:result;
}
export function preservesJapaneseReading(source:string,draft:string){
 if(!/^[a-z]{6,}[.!?]?$/i.test(draft))return false;
 const text=source.normalize('NFKC').replace(/[.!?。！？]+$/u,'').replace(/[ァ-ヶ]/gu,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
 if(!/^[\p{Script=Han}\p{Script=Hiragana}ー]+$/u.test(text))return false;
 const word=draft.toLowerCase().replace(/[.!?]$/u,'');
 const spans=[...text.matchAll(/[\p{Script=Hiragana}ー]+/gu)];
 // An adjective or another clause may add a second kana span. Matching only
 // its final noun must not excuse a draft that omitted the earlier meaning.
 if(spans.length!==1)return false;
 const match=spans[0];if(match[0].length<3)return false;
 const sound=reading(match[0]);if(!sound||sound.length<5)return false;
 const start=match.index===0,end=match.index+match[0].length===text.length;
 return start&&end?word===sound:start?word.startsWith(sound):end?word.endsWith(sound):false;
}
