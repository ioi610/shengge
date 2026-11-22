import {ContextTranslation} from './context-translation';
import {languageCode} from './source-language';
import {punctuateBareQuestion} from './english-question';
import {preservesJapaneseReading} from './japanese-reading';
import {printedStarRating} from './printed-star-rating';
import {pairedReferentProbe,resolvePairedReferent} from './paired-referent';
import {chineseReferenceInput} from './chinese-reference';
type TranslatorSession={translate:(text:string)=>Promise<string>;destroy:()=>void};
type TranslatorFactory={availability:(o:{sourceLanguage:string;targetLanguage:string})=>Promise<string>;create:(o:{sourceLanguage:string;targetLanguage:string;monitor?:(m:EventTarget)=>void})=>Promise<TranslatorSession>};
// Keep the complete action when the two printed lines disambiguate an
// English verb followed by an infinitive (e.g. pretend to, want to).
export function choosePairedTranslation(refined:string|undefined,draft:string,reference?:string){
 if(!reference?.trim() || reference.length>4000)return refined??draft;
 const candidate=refined??draft;
 const verbs=[...reference.toLowerCase().matchAll(/\bto ([a-z]{3,}) (?=to [a-z]+\b)/gu)]
  .map(m=>m[1]);
 if(verbs.some(verb=>!new RegExp('\\b'+verb+'(?:s|ed|ing)?\\b','iu').test(candidate)))return reference.trim();
 return candidate;
}
/** A Japanese negative question can be an invitation. Require matching
 * invitations in the two printed lines before using the English gloss. */
export function pairedInvitation(japanese:string,chinese:string|undefined,gloss:string|undefined){
 if(!chinese || !gloss || !/(?:一緒に|いっしょに).+(?:ない|ません)(?:か)?[？?！!。\s]*$/u.test(japanese))return;
 if(!/(?:一起|一块|一塊)/u.test(chinese) || !/(?:要不要|想不想)|[吧吗嗎][？?！!。\s]*$/u.test(chinese))return;
 if(!/^(?:let[’']s |shall we |would you like to |do you want to |how about |why don[’']t we )/iu.test(gloss.trim()))return;
 return gloss.trim();
}
// Both printed lines must be short prohibitions. A bare "Don't call" has
// no object to preserve; the other demonstrably negative line can resolve
// the verb. Longer commands keep their qualifiers in the ordinary translator.
export function pairedProhibition(japanese:string,chinese:string|undefined,draft:string,gloss:string|undefined){
 if(!chinese || !gloss || !/^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]{1,9}[うくぐすつぬぶむる]な[！!。]*$/u.test(japanese))return;
 if(!/^(?:不[许許准準]|不要|别|別)\p{Script=Han}{1,6}[！!。]*$/u.test(chinese.trim()))return;
 if(!/^(?:don['’]t|do not) [a-z]+[.!]?$/iu.test(draft.trim()))return;
 const verb=/^(?:not allowed to|don['’]t|do not) ([a-z]+)[.!]?$/iu.exec(gloss.trim())?.[1];
 if(verb)return "Don't "+verb.toLowerCase()+".";
}
// In speech, a kana spelling may also be a dictionary noun. The printed
// translation can establish that a short utterance is a call to act. Ask the
// same Japanese translator for that reading and keep only a matching reaction.
function marksReadiness(text:string, reference?:string){
 if(!reference)return false;
 return /^(?:よ[ーっ]*し|よっしゃ[あぁー]*)$/u.test(text) &&
  /^(?:来吧|來吧|好(?:了|吧|嘞)?|行|开始吧|開始吧|上吧)[！!。\s]*$/u.test(reference.trim());
}
const readyReaction = /^(?:all right|alright|okay|ok|right|come on|here (?:we|I) go|let[’']s (?:go|do (?:it|this)))[.!\s]*$/iu;

// In a bare affirmative, 当たる may mean either "hit" or "win". Only a
// same-line explicit prize win licenses the concrete sense. Keep reactions,
// questions, named prizes and other speakers on the ordinary translation path.
function printedPrizeInput(japanese:string,reference?:string){
 if(!reference||!/^我?中[奖獎](?:了[啦哟喲喔哦呀]?|啦)[。！!]?$/u.test(reference.trim()))return;
 if(!/^当た(?:った(?:ん(?:だ|です))?|りました)[。！!]?$/u.test(japanese))return;
 return '賞品が'+japanese;
}

// A surprised reaction can keep its impersonal draft grammar. Change only
// the ambiguous noun sense when both printed lines explicitly agree on a win;
// do not insert a speaker, money, a named prize or a whole replacement clause.
export function pairedPrizeReaction(japanese:string,chinese:string|undefined,draft:string){
 if(!chinese || !/^(?:え[っッ]?[、,！!\s]*)?すごい[、,！!\s]*当たった(?:んだ|んです)?[。！!\s]*$/u.test(japanese))return;
 if(!/^(?:[诶誒欸哎][，,！!\s]*)?好?[厉厲]害[，,！!\s]*中[奖獎](?:了[啦哟喲哦喔呀]?|啦)?[。！!\s]*$/u.test(chinese.trim()))return;
 if(!/\ba (?:great|big|huge) hit\b/iu.test(draft) || /[?？]/u.test(draft))return;
 return draft.replace(/\b(a (?:great|big|huge)) hit\b/iu,'$1 win');
}

// Japanese often leaves the speaker number implicit. In a contrastive
// relative clause the ordinary draft can introduce the wrong singular.
// A modal after "who" stays unchanged when its antecedent becomes plural.
export function pairedSpeakerNumber(japanese:string,chinese:string|undefined,english:string,gloss?:string){
 if(!chinese || !gloss || !/^(?:我们|我們|咱们|咱們)/u.test(chinese.trim()) ||
    !/^we\b/iu.test(gloss.trim()) || !/こそ/u.test(japanese))return english;
 if(/[私僕俺]|わたし|あたし|おれ|ぼく|[「」『』]/u.test(japanese) ||
    /\b(?:me|my|mine|myself)\b/iu.test(english))return english;
 return english.replace(/^I (?:am|was) the one who (?=(?:should|can|could|will|would|must|may|might)\b)/u,
  prefix=>prefix.startsWith('I was')?'We were the ones who ':'We are the ones who ');
}
/** Separate local text translation; no audio, playback, ASR queue or source-text mutation. */
export class EnglishTranslation {
 private referenceSession?:TranslatorSession;private referenceLoading?:Promise<TranslatorSession|undefined>;private ready=false;private contextual=new ContextTranslation();private session?:TranslatorSession;private source?:string;private generation=0;private cache=new Map<string,string>();private pending=new Map<string,Promise<string|undefined>>();
 constructor(private factory:TranslatorFactory|undefined=(globalThis as unknown as {Translator?:TranslatorFactory}).Translator){}
 async canResume(language:string){
  try{return (await this.factory?.availability({sourceLanguage:language,targetLanguage:'en'}))==='available';}catch{return false;}
 }
 get activeLanguage(){return this.source;}
 get enabled(){return this.ready&&Boolean(this.session);}
 get supported(){return Boolean(this.factory);}
 async enable(language:string,onProgress?:(fraction:number)=>void){
  const code=languageCode(language);if(!code||code==='en')throw new Error('请先识别出非英语原文，再开启英文译文。');
  if(!this.factory)throw new Error('当前浏览器不支持本机翻译；原文字幕仍可使用。');
  this.disable();const generation=this.generation;
  // Called directly from a user gesture, as required for a first model download.
  let timer:ReturnType<typeof setTimeout>|undefined;
  const created=this.factory.create({sourceLanguage:code,targetLanguage:'en',...(onProgress?{monitor:(m:EventTarget)=>m.addEventListener('downloadprogress',e=>{if(generation===this.generation)onProgress(Number((e as Event&{loaded:number}).loaded));})}:{})}).then(session=>{if(generation!==this.generation){session.destroy();throw new Error('翻译准备已取消。');}return session;});
  let session:TranslatorSession;
  try{session=await Promise.race([created,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{this.generation++;reject(new Error('本机翻译模型尚未就绪，请稍后重新开启；原文字幕和复读不受影响。'));},60000);})]);}finally{clearTimeout(timer);}
  if(generation!==this.generation){session.destroy();return;}
  this.session=session;this.source=code;
  this.ready=true;
  // The basic translator can already display this line while the optional
  // local refinement model initializes. Each has its own cancellation guard.
  void this.contextual.enable(code).catch(()=>{});
 }
 private referenceGloss(text:string,keepPhrase=false){
  const generation=this.generation;
  this.referenceLoading??=this.factory!.availability({sourceLanguage:'zh',targetLanguage:'en'}).then(async status=>{
   if(status!=='available'||this.generation!==generation)return;
   const translator=await this.factory!.create({sourceLanguage:'zh',targetLanguage:'en'});
   if(this.generation!==generation){translator.destroy();return;}
   this.referenceSession=translator;
   return translator;
  }).catch(()=>undefined);
  // The local Chinese pack can collapse adjacent predicates in unspaced
  // subtitles. Word boundaries are supplied only to the translator.
  return this.referenceLoading.then(session=>session?.translate(keepPhrase?text:chineseReferenceInput(text))).catch(()=>undefined);
 }
 async translate(text:string,language?:string,reference?:string){
  if(!this.enabled||!this.session||languageCode(language)!==this.source||!text.trim())return;
  const key=JSON.stringify([this.source,text,reference]);if(this.cache.has(key))return this.cache.get(key);
  if(this.pending.has(key))return this.pending.get(key);
  const generation=this.generation,session=this.session;
  const task=(async()=>{
   // Preserve ASR clause boundaries: translating a newline-joined paragraph
   // can silently omit its later sentences in the browser language pack.
   const clauses=text.split(/\n+/).map(s=>s.trim()).filter(Boolean),parts:string[]=[];
   for(const clause of clauses){
    if(generation!==this.generation)return '';
    const hint=clauses.length===1 && this.source==='ja'?reference:undefined;
    const rating=printedStarRating(clause,hint);
    if(rating?.fragment){parts.push(rating.fragment);continue;}
    const prizeInput=printedPrizeInput(clause,hint);
    if(prizeInput){
     const prize=(await session.translate(prizeInput).catch(()=>'')).trim();
     if(generation!==this.generation)return '';
     if(/^(?:I (?:got|won|received)|I['’]ve (?:won|received)) (?:a|the) prize[.!]?$/iu.test(prize)){
      parts.push(prize);continue;
     }
    }
    const part=await session.translate(rating?.input??clause);if(!part.trim())return '';
    const original=part.trim(),draft=punctuateBareQuestion(original);
    const prizeReaction=pairedPrizeReaction(clause,hint,draft);
    if(prizeReaction){parts.push(prizeReaction);continue;}
    // A question mark we supplied proves only the draft's existing grammar.
    // Keep that exact wording; a second model cannot safely infer more from
    // our punctuation. Publish immediately without a redundant model pass.
    // A single Latin name whose spelling matches the source kana already
    // preserves that name. Another model can change it to a different object
    // (observed: 焼きそば / Yakisoba -> Yakiniku) without adding useful context.
    if(draft!==original||rating?.ratingInEnglish.test(draft)||this.source==='ja'&&preservesJapaneseReading(clause,draft)){parts.push(draft);continue;}
    if(marksReadiness(clause,hint)){
     if(readyReaction.test(draft)){parts.push(draft);continue;}
     const spoken=await session.translate(clause+'！').catch(()=>'');
     if(readyReaction.test(spoken.trim())){parts.push(spoken.trim());continue;}
    }
    if(generation!==this.generation)return '';
    const crosscheck=hint?await this.referenceGloss(hint):undefined;
    const prohibition=pairedProhibition(clause,hint,draft,crosscheck);
    if(prohibition){parts.push(prohibition);continue;}
    const invitation=pairedInvitation(clause,hint,crosscheck);
    if(invitation){parts.push(invitation);continue;}
    const referent=pairedReferentProbe(clause,hint,draft,crosscheck);
    if(referent&&generation===this.generation){
     // Two short native checks at most. Keeping the attributive phrase intact
     // preserves its past participle; the whole Chinese gloss remains evidence,
     // never a replacement subtitle or an instruction for a new model.
     const [noun,phrase]=await Promise.all([this.referenceGloss(referent.noun,true),this.referenceGloss(referent.phrase,true)]);
     if(generation!==this.generation)return '';
     const resolved=resolvePairedReferent(referent,noun,phrase);
     if(resolved){parts.push(resolved);continue;}
    }
    const refined=await this.contextual.translate(clause,draft,hint,crosscheck);
    parts.push(pairedSpeakerNumber(clause,hint,choosePairedTranslation(refined,draft,crosscheck),crosscheck));
   }
   return parts.join(' ');
  })().then(value=>{if(generation!==this.generation)return;const result=value.trim();if(!result||result.length>4000)return;this.cache.set(key,result);if(this.cache.size>100)this.cache.delete(this.cache.keys().next().value!);return result;}).catch(()=>undefined).finally(()=>{if(this.pending.get(key)===task)this.pending.delete(key);});
  this.pending.set(key,task);return task;
 }
 disable(){this.ready=false;this.referenceSession?.destroy();this.referenceSession=undefined;this.referenceLoading=undefined;this.generation++;this.contextual.disable();this.session?.destroy();this.session=undefined;this.source=undefined;this.pending.clear();this.cache.clear();}
}
