import { languageCode } from './source-language';
import type { Transcript } from './background-captions';
import type {SpeakerFrame} from './speaker-turns';
import type {SpeakerWindow} from './turn-model';
import type {PendingTurn} from './pending-turns';
export type Reading = { text: string; confidence: number; min: number; reference?: string };
export type VisualTurn = {
  text: string;
  confidence: number;
  startMs: number;
  endMs: number;
  reference?: string;
};
type Run = VisualTurn & { last: number; hits: number; refHits: number };

export class VisualTurns {
  private current?: Run;
  private previous?: Run;
  private voice = new Set<number>();
  private closed: VisualTurn[] = [];
  private spokenClosed = new WeakSet<VisualTurn>();
  private lateVoice = new WeakMap<VisualTurn,{
    startMs:number;endMs:number;closedAt:number;
    prior?:SpeakerWindow&{bins:Set<number>};
    supportedLate?:boolean;
  }>();
  constructor(private origin: number) {}
  hear(time: number, probability: number) {
    const bin = Math.floor(time / 32);
    if (probability >= 0.35) this.voice.add(bin);
    if (this.voice.size > 440) for (const old of this.voice) if (old < bin - 435) this.voice.delete(old);
  }
  hasVoice(startMs: number, endMs: number) {
    let count = 0;
    for (let bin = Math.floor((startMs - 150) / 32); bin <= Math.floor((endMs + 120) / 32); bin++) {
      if (this.voice.has(bin) && ++count >= 3) return true;
    }
    return false;
  }
  /** A later rolling window may resolve quiet speech that its trailing edge
   * missed. Only independently shifted raw windows supporting the SAME bins
   * inside a recent, already-stable printed line can mark that line spoken.
   * This never seeds the global voice buffer or establishes source language. */
  corroborateSpeakerWindow(frames:SpeakerFrame[],window:SpeakerWindow,position:number){
    if(window.ended||window.clockAligned!==true||![window.startMs,window.endMs,position].every(Number.isFinite)||
       window.endMs<=window.startMs||position<window.endMs||position-window.endMs>1000)return;
    for(const turn of this.closed){
      const range=this.lateVoice.get(turn);
      if(!range||this.spokenClosed.has(turn))continue;
      if(position<range.closedAt||position-range.endMs>4000||window.endMs<range.closedAt){range.prior=undefined;continue;}
      const bins=new Set(frames.filter(f=>Number.isFinite(f.atMs)&&Number.isFinite(f.confidence)&&f.speaker>=0&&f.confidence>=.72&&
        f.atMs>=range.startMs&&f.atMs<=range.endMs&&f.atMs>=window.startMs&&f.atMs<=window.endMs).map(f=>Math.floor(f.atMs/32)));
      if(bins.size<3)continue;
      const prior=range.prior;
      if(prior&&window.startMs-prior.startMs>=128&&window.endMs-prior.endMs>=128&&window.endMs-prior.endMs<=1000&&
         [...bins].filter(bin=>prior.bins.has(bin)).length>=3){
        this.spokenClosed.add(turn);range.supportedLate=true;range.prior=undefined;continue;
      }
      // Recomputing or flushing the same PCM is never another witness.
      if(!prior||window.startMs>=prior.startMs&&window.endMs>prior.endMs)range.prior={...window,bins};
    }
  }
  private supported(run: Run) {
    return (
      run.hits >= 2 &&
      run.last - run.startMs >= 120 &&
      run.last - run.startMs <= 10000 &&
      this.hasVoice(run.startMs, run.last)
    );
  }
  preview(time: number) {
    const r = this.current;
    if (r && this.supported(r) && time - r.last <= 360)
      return { text: r.text, reference: r.refHits >= 2 ? r.reference : undefined };
  }
  observe(time: number, reading?: Reading, canCheckAudio = false): VisualTurn | undefined {
    const valid =
      reading &&
      reading.confidence >= 0.93 &&
      reading.min >= 0.65 &&
      reading.text.length <= 90 &&
      /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(reading.text) &&
      /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{P}\p{N}\sー〜～]+$/u.test(reading.text);
    if (
      valid &&
      this.current &&
      normalize(this.current.text) === normalize(reading.text) &&
      time - this.current.last <= 800
    ) {
      if (reading.reference) {
        if (reading.reference === this.current.reference) this.current.refHits++;
        else {
          this.current.reference = reading.reference;
          this.current.refHits = 1;
        }
      }
      this.current.last = time;
      this.current.hits++;
      this.current.confidence = Math.min(this.current.confidence, reading.confidence);
    } else if (valid) {
      if (this.current && this.current.hits >= 2) this.previous = this.current;
      this.current = {
        text: reading.text,
        confidence: reading.confidence,
        startMs: time,
        endMs: time,
        last: time,
        hits: 1,
        reference: reading.reference,
        refHits: reading.reference ? 1 : 0,
      };
    }
    if (!valid && this.current && time - this.current.last >= 460) {
      if (this.current.hits >= 2) this.previous = this.current;
      this.current = undefined;
    }
    const prev = this.previous;
    if (!prev || (this.current?.hits === 1 && time - prev.last < 450)) return;
    this.previous = undefined;
    if (
      (!this.supported(prev) &&
        !(
          canCheckAudio &&
          prev.hits >= 2 &&
          prev.last - prev.startMs >= 120 &&
          prev.last - prev.startMs <= 10000
        )) ||
      time - prev.last > 900
    )
      return;
    const turn = {
      ...(prev.refHits >= 2 ? { reference: prev.reference } : {}),
      text: prev.text,
      confidence: prev.confidence,
      startMs: Math.max(this.origin, prev.startMs - 150),
      endMs: Math.min(time, this.current?.startMs ?? time, prev.last + 120),
    };
    this.closed.push(turn);
    this.lateVoice.set(turn,{startMs:prev.startMs,endMs:prev.last,closedAt:time});
    // A slow language check may outlive the bounded rolling voice buffer.
    // Keep the evidence already observed for this closed line; later speech
    // must neither erase it nor make an originally silent line spoken.
    if(this.hasVoice(turn.startMs,turn.endMs))this.spokenClosed.add(turn);
    if (this.closed.length > 12) this.closed.shift();
    return turn;
  }
  earliestSpokenThrough(turn:VisualTurn){
    return this.closed.find(prior=>prior.endMs<=turn.startMs &&
      (this.spokenClosed.has(prior)||this.hasVoice(prior.startMs,prior.endMs)))??turn;
  }
  spokenLines(){
    return this.closed.filter(turn=>this.spokenClosed.has(turn)||this.hasVoice(turn.startMs,turn.endMs)).map(turn=>({...turn}));
  }
  /** Closing a printed row can precede an in-flight speaker result. Recheck
   * only that same recent row, with clock-proven trailing frames or the
   * already corroborated two-window evidence. Old global voice is not a vote. */
  reconsiderSpoken(frames:SpeakerFrame[],window:SpeakerWindow,position:number){
    if(window.ended||window.clockAligned!==true||![window.startMs,window.endMs,position].every(Number.isFinite)||
       window.endMs<=window.startMs||position<window.endMs||position-window.endMs>1000)return;
    for(const turn of this.closed){
      const range=this.lateVoice.get(turn);
      if(!range||position<range.closedAt||position-range.endMs>4000)continue;
      const bins=new Set(frames.slice(-18).filter(f=>Number.isFinite(f.atMs)&&Number.isFinite(f.confidence)&&
        f.speaker>=0&&f.confidence>=.72&&f.atMs>=range.startMs&&f.atMs<=range.endMs&&
        f.atMs>=window.startMs&&f.atMs<=window.endMs).map(f=>Math.floor(f.atMs/32)));
      if(bins.size>=3){this.spokenClosed.add(turn);range.supportedLate=true;}
      if(range.supportedLate)return turn;
    }
  }
  /** A scheduling hint only: both estimates still need their normal review.
   * A closed printed line can explain a longer endpoint with the same onset,
   * but cannot merge adjacent replies, distinct nested onsets or speakers. */
  sharesReviewHold(a:PendingTurn,b:PendingTurn){
    if(Boolean(a.focused)!==Boolean(b.focused)||a.reason==='speaker-change'||b.reason==='speaker-change')return false;
    const overlap=Math.min(a.endMs,b.endMs)-Math.max(a.startMs,b.startMs);
    const shorter=Math.min(a.endMs-a.startMs,b.endMs-b.startMs),longer=Math.max(a.endMs-a.startMs,b.endMs-b.startMs);
    if(overlap<=0||shorter<=0||overlap/shorter<.7||Math.abs(a.startMs-b.startMs)>32&&overlap/longer<.7)return false;
    const linesFor=(candidate:PendingTurn)=>this.closed.filter(line=>
      candidate.startMs>=line.startMs-320&&candidate.endMs<=line.endMs+320&&
      Math.min(candidate.endMs,line.endMs)-Math.max(candidate.startMs,line.startMs)>=.7*Math.min(candidate.endMs-candidate.startMs,line.endMs-line.startMs));
    const first=linesFor(a),second=linesFor(b);
    return first.length===1&&second.length===1&&first[0]===second[0];
  }
  matching(start: number, end: number, checkWithAudio = false) {
    const runs: VisualTurn[] = [...this.closed];
    if (this.current && this.current.hits >= 2 && (checkWithAudio || this.supported(this.current)))
      runs.push({
        ...this.current,
        reference: this.current.refHits >= 2 ? this.current.reference : undefined,
        startMs: Math.max(this.origin, this.current.startMs - 150),
        endMs: this.current.last + 100,
      });
    const matches = runs.filter(
      (r) =>
        Math.min(end, r.endMs) - Math.max(start, r.startMs) >= Math.min(280, (end - start) * 0.6) &&
        Math.abs(r.startMs - start) < 1150 &&
        Math.abs(r.endMs - end) < 1200,
    );
    return matches.length === 1 ? matches[0] : undefined;
  }
  /** A whole printed sentence is a caption only for its whole observed run.
   * A broad overlap match is useful for review, but cannot label each partial
   * acoustic interval with the same complete on-screen sentence. */
  completeMatching(start:number,end:number){
    const run=this.matching(start,end,true);
    return run&&this.closed.includes(run)&&start<=run.startMs&&end>=run.endMs?run:undefined;
  }
  /** Recent repeated observations, rather than text equality across searches,
   * show that this same on-screen run has not closed yet. This only postpones
   * a provisional boundary; it supplies neither voice nor language evidence. */
  openLine(start:number,end:number,time:number){
    const run=this.current;
    if(run&&run.hits>=2&&time-run.last<700&&time-run.startMs<8000&&
      Math.min(end,run.last+100)-Math.max(start,run.startMs-150)>=Math.min(280,(end-start)*.6))
      return {startMs:Math.max(this.origin,run.startMs-150),endMs:run.last+100};
  }
  recentLine(time: number) {
    const r = this.current;
    return Boolean(r && r.hits >= 2 && time - r.last < 700 && time - r.startMs < 8000);
  }
  forTranscript(result: Transcript | undefined, toMedia: (ms: number) => number) {
    if (!result) return;
    for (const row of result.segments) {
      const start = toMedia(row.startMs),
        end = toMedia(row.endMs);
      const turn = this.matching(start, end, true);
      if (turn && sameJapaneseSpeech(turn.text, { language: result.language, segments: [row] }))
        return turn;
    }
  }
  activeAt(start: number, end: number) {
    const r = this.current;
    return (
      r &&
      this.supported(r) &&
      end - r.last < 400 &&
      start >= r.startMs - 600 &&
      start <= r.last + 120 &&
      end - r.startMs < 7500
    );
  }
}
const normalize = (text: string) => text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
/** Check a same-time audio hypothesis before learning that the visible Japanese
 * line is in the source language. A dubbed video's printed translation alone
 * cannot establish the language of its soundtrack. */
export function sameJapaneseSpeech(reading: string, transcript?: Transcript) {
  if (languageCode(transcript?.language) !== 'ja') return false;
  const text = normalize(reading);
  if (text.length < 4) return false;
  return transcript!.segments.some((row) => {
    if ((row.confidence ?? 0) < 0.6) return false;
    const heard = normalize(row.text);
    if (heard.length < 4) return false;
    const pairs = new Set(Array.from(text.slice(1), (_, i) => text.slice(i, i + 2)));
    let matched = 0;
    for (const pair of pairs) if (heard.includes(pair)) matched++;
    return (
      matched >= 3 &&
      matched / pairs.size >= 0.55 &&
      Math.min(heard.length, text.length) / Math.max(heard.length, text.length) >= 0.45
    );
  });
}
