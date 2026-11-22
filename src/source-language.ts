import {isDialogueText} from './sentence-confirmation';
/** Per-video evidence. Interjections and a single guess cannot lock the decoder. */
const aliases:Record<string,string>={japanese:'ja',english:'en',chinese:'zh',korean:'ko',spanish:'es',french:'fr',german:'de',italian:'it',portuguese:'pt',russian:'ru',arabic:'ar',hindi:'hi'};
 const display=new Intl.DisplayNames(['en'],{type:'language'});for(const code of 'af am ar as az ba be bg bn bo br bs ca cs cy da de el en es et eu fa fi fo fr gl gu ha he hi hr ht hu hy id is it ja jw ka kk km kn ko la lb ln lo lt lv mg mi mk ml mn mr ms mt my ne nl nn no oc pa pl ps pt ro ru sa sd si sk sl sn so sq sr su sv sw ta te tg th tk tl tr tt uk ur uz vi yi yo zh yue'.split(' ')){const label=display.of(code)?.toLowerCase();if(label)aliases[label]=code;}

export function languageCode(value?:string){const name=value?.toLowerCase();return name&&name!=='auto'?(aliases[name]??(/^[a-z]{2,3}$/.test(name)?name:undefined)):undefined;}
export function languageEvidence(text:string,language?:string){
 const code=languageCode(language),clean=text.normalize('NFKC').trim();
 if(!code||!isDialogueText(clean)||/^(?:h+m+|m+h*m+|u+h+|a+h+|o+h+|う[ーん]*|あ[ーあ]*|え[ーえ]*|ん[ーん]*)[\s.!?。！？…〜～]*$/iu.test(clean))return;
 const letters=clean.match(/[\p{L}\p{N}]/gu)??[];
 if(code==='ja')return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(clean)&&letters.length>=4?code:undefined;
 if(code==='zh')return /\p{Script=Han}/u.test(clean)&&letters.length>=4?code:undefined;
 if(code==='ko')return /\p{Script=Hangul}/u.test(clean)&&letters.length>=4?code:undefined;
 return letters.length>=12&&(clean.match(/[\p{L}\p{N}]+/gu)?.length??0)>=3?code:undefined;
}
export class SourceLanguage {
 private votes=new Map<string,number>();private selected?:string;
 get language(){return this.selected;}
 reset(){this.votes.clear();this.selected=undefined;}
 observe(text:string,language?:string){const code=languageEvidence(text,language);if(!code)return;this.votes.set(code,(this.votes.get(code)??0)+1);if((this.votes.get(code)??0)>=2)this.selected=code;}
}
