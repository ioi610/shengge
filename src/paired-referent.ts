type ReferentProbe={noun:string;phrase:string;draft:string;modifier:string;start:number;length:number;gloss:string};
const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
const humanHeads=/[人者员員师師友孩童婴嬰男女妈媽爸爹娘]|家伙|先生|小姐/u;
const personWords=/\b(?:guys?|fellows?|dudes?|persons?|people|man|men)\b/giu;

/** A colloquial Japanese relative-clause referent can mean a thing or a person.
 * Ask the already-installed reference translator about one exact Chinese noun
 * and its local attributive phrase; never adopt the whole translated line. */
export function pairedReferentProbe(japanese:string,reference:string|undefined,draft:string,gloss:string|undefined):ReferentProbe|undefined{
 if(!reference||!gloss||japanese.length>160||reference.length>160||draft.length>600||gloss.length>600)return;
 if(/[\r\n「」『』]/u.test(japanese+reference)||japanese.match(/ヤツ|やつ|奴/gu)?.length!==1)return;
 if(!/[ただ](?:ヤツ|やつ|奴)(?![ら等達\p{Script=Katakana}\p{Script=Han}]|たち)/u.test(japanese))return;
 if(draft.match(personWords)?.length!==1)return;
 const matches=[...draft.matchAll(/\b([a-z]{2,}(?:ed|en))\s+(guy|fellow|dude|person|man)\b/giu)];
 if(matches.length!==1)return;
 // Multiple 的 clauses, coordinated heads, classifiers or extra tail clauses
 // are ambiguous. A single final word is the only candidate we will probe.
 const line=reference.normalize('NFKC').replace(/\s+/gu,'').replace(/[。.!?？！…]+$/u,'').replace(/[啦呀啊呢吧哦喔哟嘛呐吗嗎]+$/u,'');
 if(line.match(/的/gu)?.length!==1)return;
 const [before,noun]=line.split('的');
 if(!/^[\p{Script=Han}]{1,8}$/u.test(noun)||humanHeads.test(noun))return;
 const headWords=[...segmenter.segment(noun)].filter(part=>part.isWordLike);
 if(headWords.length!==1||headWords[0].segment!==noun)return;
 const modifiers=[...segmenter.segment(before)].filter(part=>part.isWordLike);
 const modifier=modifiers.at(-1)?.segment;
 if(!modifier||!/^\p{Script=Han}{1,8}$/u.test(modifier)||!before.endsWith(modifier))return;
 const match=matches[0],word=match[2];
 return {noun,phrase:modifier+'的'+noun,draft,modifier:match[1].toLowerCase(),
  start:match.index!+match[0].length-word.length,length:word.length,gloss};
}

/** Only the single referent token changes. Negation, speaker number, every
 * other noun/action/qualifier and punctuation remain byte-for-byte unchanged. */
export function resolvePairedReferent(probe:ReferentProbe,nounEnglish:string|undefined,phraseEnglish:string|undefined){
 if(!nounEnglish||!phraseEnglish)return;
 const noun=nounEnglish.trim().toLowerCase().replace(/[.!]$/u,'');
 // Do not infer singular forms from plural or compound output. In particular,
 // photos/people cannot silently replace a singular person in the draft.
 if(!/^[a-z]{2,32}$/u.test(noun)||/[^s]s$/u.test(noun)||
    /^(?:a|an|the|he|she|it|we|they|you|i|guy|fellow|dude|person|man|woman|boy|girl|child|human)$/u.test(noun))return;
 const forms=[noun,noun+'s',noun+'es'];
 const phrase=phraseEnglish.trim().toLowerCase().replace(/[.!]$/u,'').replace(/^(?:a|an|the)\s+/u,'');
 if(!forms.some(form=>phrase===probe.modifier+' '+form))return;
 const words:string[]=probe.gloss.toLowerCase().match(/[a-z]+/gu)??[];
 if(!forms.some(form=>words.includes(form)))return;
 return probe.draft.slice(0,probe.start)+noun+probe.draft.slice(probe.start+probe.length);
}
