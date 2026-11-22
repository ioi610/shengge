/** The player is paused while decoding. Allow GPU cold/thermal latency without
 * accepting an unfinished sentence, but keep a finite escape for hung work. */
export function recognitionDeadlineMs(audioMs:number){
 return Math.max(45000,Math.min(90000,audioMs*2));
}
