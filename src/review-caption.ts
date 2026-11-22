import type {Transcript} from './background-captions';
import {captionInRange} from './original-captions';
import {languageCode} from './source-language';

/** Reuse a corroborated review only when its audio contains the ENTIRE replay,
 * including the quiet lead-in. A narrower crop must still be transcribed again. */
export function captionFromReview(result:Transcript|undefined,boundary:{startMs:number;endMs:number},audio:{durationMs:number;toMedia:(ms:number)=>number},language?:string){
 const source=languageCode(language);
 if(!result||!source||source!==languageCode(result.language)||boundary.startMs<audio.toMedia(0)||boundary.endMs>audio.toMedia(audio.durationMs))return;
 if(result.segments.some(row=>row.timing!=='aligned'||!row.words?.length||row.words.some(w=>!Number.isFinite(w.startMs)||!Number.isFinite(w.endMs)||w.startMs<0||w.endMs<=w.startMs||w.endMs>audio.durationMs)))return;
 const caption=captionInRange({...result,segments:result.segments.map(row=>({...row,startMs:audio.toMedia(row.startMs),endMs:audio.toMedia(row.endMs),words:row.words!.map(w=>({...w,startMs:audio.toMedia(w.startMs),endMs:audio.toMedia(w.endMs)}))}))},boundary.startMs,boundary.endMs);
 // A review can carry the right language tag but phonetic English words
 // (e.g. Japanese audio tagged Japanese with an all-Latin sentence).
 // Do not publish that shortcut. The full caption path decodes the retained
 // utterance independently; names and genuine code-switching are not censored.
 const native=source==='ja'?/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u:source==='zh'?/\p{Script=Han}/u:source==='ko'?/[\p{Script=Hangul}\p{Script=Han}]/u:undefined;
 if(caption&&native&&caption.text.split(/\n+/).some(line=>!native.test(line)&&(line.match(/\p{L}/gu)?.length??0)>=6&&(line.match(/\p{L}+/gu)?.length??0)>=2))return;
 return caption;
}
