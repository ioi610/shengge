import {BackgroundCaptions,Caption,Transcript} from './background-captions';
import {SourceLanguage,languageCode,languageEvidence} from './source-language';
import {isDialogueText} from './sentence-confirmation';
import {restoreCaptionContinuity} from './caption-continuity';
import {CaptionLanguageEvidence,completeCaptionRow,type CaptionEvidenceRange} from './caption-language-evidence';
export type CaptionContext={prefixMs:number;suffixMs?:number;mediaStartMs?:number;rate?:number;continuation?:boolean;printed?:{text:string;confidence:number}};
type Entry={pcm:Float32Array;prefixMs:number;suffixMs:number;separator:number;mediaStartMs?:number;rate?:number;printed?:CaptionContext['printed'];provisional?:Caption;attemptedLanguage?:string;attemptedRevision?:number;resolve?: (value:Caption|undefined)=>void};
const printedText=(text:string)=>text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'');
/** Brief exclamations can look confidently like another language. Require a
 * substantial utterance before publishing the first automatically tagged text. */
function initialLanguageEvidence(text:string,language?:string){return (text.match(/\p{L}/gu)?.length??0)>=12?languageEvidence(text,language):undefined;}
/** Extract only words aligned to this utterance. Context is never displayed as
 * the current subtitle, and uncertain words never become a playback boundary. */
export function captionInRange(result:Transcript,start:number,end:number,capturedEnd=end):Caption|undefined{
 const rows=result.segments.filter(s=>Number.isFinite(s.startMs)&&Number.isFinite(s.endMs)&&s.startMs>=0&&s.endMs>s.startMs&&s.startMs<end&&s.endMs>start).map(s=>{
  if(!s.words?.length)return s.startMs>=start&&s.endMs<=end+160?s:undefined;
  const words=s.words.filter(w=>w.startMs>=start&&w.startMs<end);
  if(!words.length||words.some(w=>!Number.isFinite(w.startMs)||!Number.isFinite(w.endMs)||w.endMs<=w.startMs))return;
  // Alignment can put the final small kana of the SAME sound just beyond
  // the acoustic boundary (や + っ!). Recover only a bounded suffix already
  // captured in the real closing margin, never the next lexical word.
  const tail=s.words.slice(s.words.lastIndexOf(words.at(-1)!)+1),suffix=tail.map(w=>w.text).join('');
  if(s.timing==='aligned'&&words.at(-1)!.endMs>=end-160&&/[\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(words.at(-1)!.text)&&/[っッゃャゅュょョぁァぃィぅゥぇェぉォゎヮー]/u.test(suffix)&&/^[っッゃャゅュょョぁァぃィぅゥぇェぉォゎヮー\s\p{P}]+$/u.test(suffix)&&tail.every(w=>Number.isFinite(w.startMs)&&Number.isFinite(w.endMs)&&w.startMs>=end&&w.endMs>w.startMs&&w.endMs<=Math.min(end+320,capturedEnd)))words.push(...tail);
  const text=words.map(w=>w.text).join('').trim();
  // Alignment can put a prior phrase's final small kana after the range start.
  // Do not turn that orphaned suffix into its own subtitle (e.g. やっ! -> っ!).
  // A complete short utterance is retained; this only applies after pruning.
  if(words.length<s.words.length&&s.words[0].startMs<start&&/^[っッゃャゅュょョぁァぃィぅゥぇェぉォゎヮー\s\p{P}\p{S}]+$/u.test(text))return;
  return {...s,text};
 }).filter(s=>s&&isDialogueText(s.text));
 if(!rows.length||rows.some(s=>!Number.isFinite(s!.confidence)||s!.confidence!<.6))return;
 return {text:rows.map(s=>s!.text.trim()).join('\n'),language:result.language,confidence:Math.min(...rows.map(s=>s!.confidence!))};
}
/** A per-video rolling audio context. Early short replies wait for language
 * evidence and are backfilled. All audio was already heard; no future seek. */
export class OriginalCaptions {
 private corroborated?:string;private printVerifiedByAudio=false;private profile=new SourceLanguage();private shortEvidence=new CaptionLanguageEvidence();private reviewedResults=new WeakSet<Transcript>();private forced?:string;private generation=0;private entries:Entry[]=[];private busy=false;private revision=0;private calls=0;private disposed=false;
 constructor(private decoder:BackgroundCaptions){}
 get language(){return this.forced??this.profile.language??this.corroborated;}
 get audioConfirmedLanguage(){return this.profile.language??(this.printVerifiedByAudio?this.corroborated:undefined);}
 /** A restored earlier practice turn must not inherit PCM or a pending caption
  * from the later window that finally established its source language. */
 discardAfter(mediaEndMs:number){
  const keep=this.entries.filter(entry=>entry.mediaStartMs!==undefined&&entry.rate!==undefined&&entry.mediaStartMs+(entry.pcm.length/16-entry.suffixMs)*entry.rate<=mediaEndMs);
  if(keep.length===this.entries.length)return;
  this.generation++;this.revision++;
  for(const entry of this.entries)if(!keep.includes(entry)){entry.resolve?.(undefined);entry.resolve=undefined;}
  this.entries=keep;void this.pump();
 }
 setLanguage(value?:string){this.clear();this.corroborated=undefined;this.printVerifiedByAudio=false;this.forced=languageCode(value);}
 confirmFromPrintedSpeech(audioVerified=true){
  if(audioVerified)this.printVerifiedByAudio=true;
  if(this.language)return;
  this.corroborated='ja';this.revision++;this.releaseProvisional();void this.pump();
 }
 recheckPrintedLanguage(result:Transcript){
  if(this.forced || !this.corroborated || languageCode(result.language)==='ja')return;
  const row=result.segments.find(s=>(s.confidence??0)>=.75 && languageEvidence(s.text,result.language));
  if(row){this.corroborated=undefined;this.printVerifiedByAudio=false;this.learn(row.text,result.language);}
 }
 private releaseProvisional(){
  // Both audio and independently corroborated print can establish the source.
  // A complete aligned caption already decoded in that language needs no new
  // inference, which may otherwise delay or fail the first short subtitle.
  for(const entry of this.entries)if(entry.resolve&&entry.provisional&&languageCode(entry.provisional.language)===this.language){entry.resolve(entry.provisional);entry.resolve=undefined;}
 }
 private learn(text:string,language?:string){const before=this.language;this.profile.observe(text,language);if(before!==this.language){this.revision++;this.releaseProvisional();void this.pump();}}
 observe(text:string,language?:string){if(this.language||initialLanguageEvidence(text,language))this.learn(text,language);}
 /** A boundary review may hear reliable language even when its word timing
  * cannot safely define a replay. Reuse that evidence without another decode. */
 observeTranscript(result:Transcript|undefined,range?:CaptionEvidenceRange){
  if(!result)return;
  if(range){if(this.reviewedResults.has(result))return;this.reviewedResults.add(result);}
  const text=result.segments.filter(s=>(s.confidence??0)>=.6&&isDialogueText(s.text)).map(s=>s.text).join(' ');
  if(!this.language&&range){
   const short=this.shortEvidence.observe(result,[range],Boolean(initialLanguageEvidence(text,result.language)));
   if(short){this.learn(short.text,short.language);return;}
  }
  this.observe(text,result.language);
 }
 enqueue(pcm:Float32Array,verified?:Caption,context?:CaptionContext):Promise<Caption|undefined>{
  if(this.disposed||pcm.length<1600)return Promise.resolve(undefined);
  return new Promise(resolve=>{
   // A full-range, aligned review can supply this caption immediately. Retain
   // its audio in rolling context so earlier unresolved replies still benefit.
   // Its independent decode already supplied language evidence; the derived
   // caption must not turn one inference into another confirmation vote.
   let prefixMs=Math.max(0,context?.prefixMs??0);
   const rate=typeof context?.rate==='number'&&Number.isFinite(context.rate)&&context.rate>0?context.rate:undefined;
   let mediaStartMs=typeof context?.mediaStartMs==='number'&&Number.isFinite(context.mediaStartMs)&&context.mediaStartMs>=0&&rate!==undefined?context.mediaStartMs:undefined;
   const previous=this.entries.at(-1);
   // Only the caller can establish uninterrupted playback in this video. The
   // overlap matcher independently verifies the captured waveform; metadata
   // alone must never authorize copying earlier audio into a new caption.
   if(this.language&&!verified&&context?.continuation===true&&prefixMs<400&&rate!==undefined&&mediaStartMs!==undefined&&previous?.rate===rate&&previous.mediaStartMs!==undefined){
    const repaired=restoreCaptionContinuity(previous.pcm,pcm,(mediaStartMs-previous.mediaStartMs)/rate);
    pcm=repaired.pcm;prefixMs+=repaired.addedPrefixMs;mediaStartMs-=repaired.addedPrefixMs*rate;
   }
   const trimmed=Math.max(0,pcm.length-192000)/16;
   if(mediaStartMs!==undefined&&rate!==undefined)mediaStartMs+=trimmed*rate;
   this.entries.push({pcm:pcm.slice(-192000),prefixMs:Math.max(0,prefixMs-trimmed),suffixMs:Math.max(0,context?.suffixMs??0),separator:context?0:3200,mediaStartMs,rate,printed:context?.printed?{...context.printed}:undefined,resolve:verified?undefined:resolve});this.revision++;
   if(verified)resolve(verified);
   while(this.entries.length>8||this.entries.length>1&&this.entries.reduce((n,e)=>n+e.pcm.length,0)>192000)this.entries.shift()!.resolve?.(undefined);
   void this.pump();
  });
 }
 private async pump(){
  if(this.busy||this.disposed||!this.entries.some(e=>e.resolve))return;
  let source=this.language;
  const unresolved=this.entries.filter(e=>e.resolve&&(!source||e.attemptedLanguage!==source||e.attemptedRevision!==this.revision));
  if(!unresolved.length)return;
  // Once the source is known, a failed old caption must not repeatedly drag
  // completed audio into the current decode. Prioritize the newest utterance,
  // then backfill waiting entries using their retained natural lead-in/tail.
  // Previously failed entries may still benefit from NEW rolling context,
  // after the current caption, once per revision rather than in a retry loop.
  const newestPending=unresolved.at(-1)!;
  const contextRetry=source&&newestPending.attemptedLanguage===source;
  const entries=source&&!contextRetry?[newestPending]:[...this.entries],length=entries.reduce((n,e)=>n+e.pcm.length,0);
  if(source)for(const entry of entries)if(entry.resolve){entry.attemptedLanguage=source;entry.attemptedRevision=this.revision;}
  // A closed live turn already includes real trailing audio and media mapping.
  // Start its first language probe during replay rather than waiting for a
  // second turn to reach three seconds. Publication still requires the same
  // independent language evidence and complete-word alignment below.
  const closedShort=entries.length===1&&newestPending.mediaStartMs!==undefined&&newestPending.rate!==undefined&&newestPending.suffixMs>=128&&newestPending.prefixMs+newestPending.suffixMs<length/16;
  if(!source&&length<(closedShort?32000:48000))return;
  this.busy=true;const generation=this.generation,revision=this.revision;
  // A brief separator retains turn boundaries when the original silent gap is
  // long. It changes decoder context only, never the player's timeline.
  // Live chunks retain their real quiet lead-in and need no fabricated silence.
  // Only words after prefixMs belong to the caption; context stays invisible.
  const audio=new Float32Array(length+entries.slice(1).reduce((n,e)=>n+e.separator,0));const ranges:{entry:Entry;start:number;end:number}[]=[];let offset=0;
  for(const [index,entry]of entries.entries()){if(index)offset+=entry.separator;audio.set(entry.pcm,offset);ranges.push({entry,start:offset/16+entry.prefixMs,end:(offset+entry.pcm.length)/16-entry.suffixMs});offset+=entry.pcm.length;}
  try{
   const probe=!source||!this.forced&&++this.calls%6===0;
   const result=await this.decoder.transcribe(audio,probe?undefined:source,30000,false);
   if(generation!==this.generation||!result)return;
   // A review may confirm another source while this decode is queued. A
   // result forced to the old language cannot undo that newer evidence.
   if(!probe&&source!==this.language)return;
   // An automatic probe also becomes stale if another independent result
   // confirmed a different source while it was pending. Stable-source periodic
   // probes remain eligible to discover a real language change.
   if(probe&&this.language&&source!==this.language&&languageCode(result.language)!==this.language)return;
   const evidence=result.segments.filter(s=>(s.confidence??0)>=.6&&isDialogueText(s.text)).map(s=>s.text).join(' ');
   let shortObserved=false;
   if(!this.language){
    const windows=ranges.map(({entry,start,end})=>entry.mediaStartMs!==undefined&&entry.rate!==undefined?{start,end,audioEnd:end+entry.suffixMs,mediaStartMs:entry.mediaStartMs+entry.prefixMs*entry.rate,rate:entry.rate}:undefined);
    // Cache only whole aligned captions. A later independent language vote
    // can publish them without another ASR; clipped rows are never evidence.
    for(const [i,{entry,start,end}]of ranges.entries()){
     const window=windows[i];if(!entry.resolve||!window)continue;
     const rows=result.segments.filter(row=>isDialogueText(row.text)&&row.startMs<end&&row.endMs>start);
     if(rows.length&&rows.every(row=>completeCaptionRow(row,window))){
      entry.provisional=captionInRange(result,start,end,end+entry.suffixMs);
      // A short reply cannot establish the video's source language by itself.
      // It can still fill its already accepted acoustic interval when the
      // independently decoded ENTIRE aligned row exactly agrees with stable
      // same-time print. Never use cropped words, fuzzy matching or print alone.
      const printed=entry.printed,normalized=printed&&printedText(printed.text);
      if(rows.length===1&&entry.provisional&&languageCode(result.language)==='ja'&&printed&&printed.confidence>=.93&&normalized&&normalized.length>=2&&/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized)&&normalized===printedText(rows[0].text)){
       entry.resolve(entry.provisional);entry.resolve=undefined;
      }
     }
    }
    const short=this.shortEvidence.observe(result,windows.filter((r):r is CaptionEvidenceRange=>Boolean(r)),Boolean(initialLanguageEvidence(evidence,result.language)));
    if(short){shortObserved=true;this.learn(short.text,short.language);}
   }
   // A decode requested in a known source is not an automatic language probe.
   // A mismatched tag must not switch the source and recursively retry the
   // same unusable audio in alternating languages without any new evidence.
   if(!shortObserved&&(probe||languageCode(result.language)===source))this.observeTranscript(result);
   source=this.language??source??(probe?initialLanguageEvidence(evidence,result.language):undefined);
   if(source&&languageCode(result.language)===source){
    for(const {entry,start,end} of ranges){if(!entry.resolve)continue;const caption=captionInRange(result,start,end,end+entry.suffixMs);if(caption){entry.resolve(caption);entry.resolve=undefined;}}
   }
   // A context row may straddle the turn with unreliable word alignment. Retry
   // only the newest unresolved utterance in the now-known source language.
   const newest=entries.at(-1)!;
   if(source&&newest.resolve){const before=this.language;const value=await this.decoder.enqueue(newest.pcm.slice(Math.round(newest.prefixMs*16),Math.max(Math.round(newest.prefixMs*16),newest.pcm.length-Math.round(newest.suffixMs*16))),source);if(generation!==this.generation||before!==this.language&&source!==this.language)return;if(value&&languageCode(value.language)===source){this.observe(value.text,value.language);newest.resolve(value);newest.resolve=undefined;}}
  }finally{this.busy=false;if(generation!==this.generation||revision!==this.revision||this.language&&this.entries.some(e=>e.resolve&&(e.attemptedLanguage!==this.language||e.attemptedRevision!==this.revision)))void this.pump();}
 }
 private clear(){this.generation++;for(const entry of this.entries)entry.resolve?.(undefined);this.entries=[];this.profile.reset();this.shortEvidence.reset();this.reviewedResults=new WeakSet();this.calls=0;}
 dispose(){this.disposed=true;this.clear();}
}
