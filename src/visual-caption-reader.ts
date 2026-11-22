import * as ort from 'onnxruntime-web/wasm';
import characters from './visual-character-dictionary.json';
import {corroborateCompound,hasUncertainCompound} from './visual-kanji';
import {corroborateKana, hasIsolatedKana, corroborateKanaGlyph, hasUncertainKanaGlyph} from './visual-kana';
import {PrintedInferenceCache} from './printed-inference-cache';
import {printedReferenceLine, type PrintedBox as Line} from './printed-reference-line';
import { verifiedModel } from './recognition-model';

// One PP-OCRv5 session recognizes both printed lines in the observed frame.
const model = {
  url: 'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx',
  bytes: 16631306,
  sha256: '5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5',
  cache: 'shengge-visual-ocr-v5',
};

// Locate the light strokes of outlined captions. Look in the lower part of
// the frame and require a centered row with several closely spaced glyphs.
type Layout = { box: Line; color: number[] };
export function subtitleLines(image: ImageData, prior?: Layout, referenceLineHeight?: number): Line[] {
  const { width, height, data } = image;
  const light = new Uint8Array(width * height),
    mask = new Uint8Array(width * height);
  const colors = new Uint16Array(4096);
  for (let i = 0; i < light.length; i++) {
    const p = i * 4;
    light[i] = Number(Math.min(data[p], data[p + 1], data[p + 2]) >= 218);
  }
  const bin = (p: number) => (data[p] >> 4) * 256 + (data[p + 1] >> 4) * 16 + (data[p + 2] >> 4);
  for (let y = 3; y < height - 3; y++)
    for (let x = 3; x < width - 3; x++) {
      const i = y * width + x,
        p = i * 4;
      if (Math.max(data[p], data[p + 1], data[p + 2]) > 145) continue;
      if ((light[i - 3 * width] || light[i + 3 * width]) && (light[i - 3] || light[i + 3])) {
        mask[i] = 1;
        colors[bin(p)]++;
      }
    }
  if (prior) {
    const { box, color } = prior;
    const top = Math.max(0, box.top - 1),
      bottom = Math.min(height, box.top + box.height + 2);
    const centeredRuns = (includeStraightStrokes:boolean) => {
      const runs: number[][] = [];
      for (let x = 3; x < width - 3; x++) {
        let hits = 0;
        for (let y = top; y < bottom; y++) {
          const i = y * width + x;
          const nearInk = mask[i] || includeStraightStrokes &&
            (light[i-3] || light[i+3] || light[i-3*width] || light[i+3*width]);
          if (nearInk && color.every((v, c) => Math.abs(data[4*i+c]-v) <= 25) && ++hits >= 2) break;
        }
        if(hits < 2) continue;
        const last = runs.at(-1);
        if (last && x-last[1] < box.height*1.3) last[1]=x;
        else runs.push([x,x]);
      }
      return runs.filter(([l,r]) => r-l >=16 && Math.abs((r+l-width)/2)<Math.max(18,(r-l)*0.1));
    };
    let centered = centeredRuns(false);
    const withStraightStrokes = centeredRuns(true);
    // A horizontal ー has no interior neighbour along one axis. Recover
    // its row if the stricter scan split the word into off-centre pieces.
    if (centered.length !== 1) centered = withStraightStrokes;
    else if (withStraightStrokes.length === 1) {
      // The remaining text may itself be centered after losing a narrow
      // first/last glyph. Inspect that same row's adjacent outline even when
      // the strict scan found one candidate, rather than learning its clip.
      const [left,right]=centered[0], [wholeLeft,wholeRight]=withStraightStrokes[0];
      if(wholeLeft<=left && wholeRight>=right &&
         left-wholeLeft<=box.height*1.3 && wholeRight-right<=box.height*1.3)
        centered=withStraightStrokes;
    }
    if (centered.length === 1) {
      const [l, r] = centered[0];
      // A narrow vertical stroke at the end of a kanji can have no white
      // neighbor along the horizontal axis. Check the existing crop edges
      // for the learned outline before treating either as whitespace.
      const margin = 7;
      const touchesOutline = (x: number) => {
        if (x < 0 || x >= width) return false;
        let count = 0;
        for (let y = top + 2; y < bottom - 2; y++) {
          const offset = (y * width + x) * 4;
          if (color.every((v, c) => Math.abs(data[offset + c] - v) <= 25)) count++;
        }
        return count >= Math.max(4, box.height * 0.15);
      };
      const clipped = [-1, 0, 1].some(dx => touchesOutline(l - margin + dx) || touchesOutline(r + margin + dx));
      const padding = margin + (clipped ? Math.ceil(box.height / 4) : 0);
      const left = Math.max(0, l - padding);
      // The previous line's height can clip just a few lower outline pixels.
      // That opens the white interiors to the mask's background flood-fill,
      // erasing whole glyphs even when the remaining OCR is very confident.
      // Recheck only this row's nearby matching outline, keeping separate
      // upper/lower rows apart; no additional OCR or inferred words are used.
      const verticalMargin=Math.ceil(box.height/2),bands:{top:number;bottom:number}[]=[];
      let first=-1,last=-1;
      const addBand=()=>{if(first>=0)bands.push({top:Math.max(0,first-4),bottom:Math.min(height,last+5)});};
      for(let y=Math.max(3,box.top-verticalMargin);y<Math.min(height-3,box.top+box.height+verticalMargin);y++){
        let hits=0;
        for(let x=l;x<=r;x++){
          const i=y*width+x;
          if(mask[i]&&color.every((value,c)=>Math.abs(data[4*i+c]-value)<=25)&&++hits>=4)break;
        }
        if(hits<4)continue;
        if(first<0||y-last>3){addBand();first=y;}
        last=y;
      }
      addBand();
      const sameRow=bands.filter(row=>
        row.bottom-row.top>=box.height*.65&&row.bottom-row.top<=box.height*1.6&&
        Math.abs((row.top+row.bottom)/2-(box.top+box.height/2))<=box.height*.4&&
        row.top>=box.top-verticalMargin&&row.bottom<=box.top+box.height+verticalMargin&&
        Math.max(row.bottom,box.top+box.height)-Math.min(row.top,box.top)<=box.height*1.6);
      const row=sameRow.length===1?sameRow[0]:undefined;
      const rowTop=row?Math.min(box.top,row.top):box.top;
      const rowBottom=row?Math.max(box.top+box.height,row.bottom):box.top+box.height;
      return [{ left, top: rowTop, width: Math.min(width, r + padding + 1) - left, height: rowBottom-rowTop }];
    }
  }
  let dominant = 0;
  for (let i = 1; i < colors.length; i++) if (colors[i] > colors[dominant]) dominant = i;
  if (colors[dominant] < 16) return [];
  const color = [dominant >> 8, (dominant >> 4) & 15, dominant & 15].map((x) => x * 16 + 8);
  const lines: Line[] = [];
  const rows = new Uint16Array(height);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    if (color.some((value, c) => Math.abs(data[4 * i + c] - value) > 26)) {
      mask[i] = 0;
      continue;
    }
    rows[Math.floor(i / width)]++;
  }
  const collect = (first: number, last: number, target: Line[]) => {
    const h = last - first + 1;
    if (h < 10 || h > 52) return;
    const columns = new Uint16Array(width);
    for (let y = first; y <= last; y++)
      for (let x = 0; x < width; x++) columns[x] += mask[y * width + x];
    let left = -1,
      right = -1;
    const add = () => {
      if (
        right - left < h * 0.95 ||
        Math.abs((right + left) / 2 - width / 2) > Math.max(32, (right - left) * 0.15)
      )
        return;
      const l = Math.max(0, left - 6),
        t = Math.max(0, first - 4);
      target.push({
        left: l,
        top: t,
        width: Math.min(width, right + 7) - l,
        height: Math.min(height, last + 5) - t,
      });
    };
    for (let x = 0; x < width; x++)
      if (columns[x] >= 2) {
        // A word space in a small subtitle can exceed 1.35 glyph heights
        // after the outline mask thins its edge strokes. Keep the measured
        // 26-pixel space in a 19-pixel row together; centering and row-height
        // checks still exclude separate scene lettering.
        if (x - right > Math.max(22, h * 1.5)) {
          if (left >= 0) add();
          left = -1;
        }
        if (left < 0) left = x;
        right = x;
      }
    if (left >= 0) add();
  };
  const findRows = (start: number, step: number, target: Line[]) => {
    let first = start, last = start - step - 1;
    for (let y = start; y < height - 3; y++) {
      if (rows[y] < 4) continue;
      if (y - last > step) {
        collect(first, last, target);
        first = y;
      }
      last = y;
    }
    collect(first, last, target);
  };
  findRows(3, 1, lines);
  const upper = lines.at(-1);
  if (referenceLineHeight !== undefined) {
    // This band already ends at the separate Japanese line. A short upper
    // fragment can look like a whole glyph even when its top is missing.
    const joined: Line[] = [];
    findRows(3, 3, joined);
    const whole = joined.reverse().find(row => row.height <= referenceLineHeight * 1.65 &&
      height - row.top - row.height <= referenceLineHeight * 0.5 &&
      (!upper || row.top < upper.top && row.top + row.height >= upper.top + upper.height - 2 &&
        row.left <= upper.left + 3 && row.left + row.width >= upper.left + upper.width - 3));
    if (whole) return [whole];
    return lines.reverse();
  }
  if (!prior && upper) {
    // Fine kana can have one or two empty scanlines across the whole row.
    // Recover a separate row below a printed line without merging the two
    // languages or changing the geometry of any already complete row.
    const below: Line[] = [];
    const bottom = upper.top + upper.height;
    findRows(bottom, 3, below);
    const lower = below.find(row => row.top >= bottom - 2 &&
      row.top - bottom <= upper.height * 0.7 &&
      row.height >= upper.height * 0.65 && row.height <= upper.height * 1.65);
    if (lower) lines.push(lower);
  }
  return lines.reverse();
}
async function decode(
  session: ort.InferenceSession,
  pixels: Float32Array,
  width: number,
  alphabet: string[],
) {
  const tensor = new ort.Tensor('float32', pixels, [1, 3, 48, width]);
  try {
    const outputs = await session.run({ [session.inputNames[0]]: tensor });
    try {
      const out = outputs[session.outputNames[0]],
        scores = out.data as Float32Array;
      const classes = out.dims[2];
      if (classes !== alphabet.length) return;
      let previous = -1;
      const letters: { char: string; p: number }[] = [];
      for (let i = 0; i < scores.length; i += classes) {
        let best = 0;
        for (let k = 1; k < classes; k++) if (scores[i + k] > scores[i + best]) best = k;
        if (best && best !== previous) {
          letters.push({ char: alphabet[best], p: scores[i + best] });
        }
        previous = best;
      }
      return letters;
    } finally {
      Object.values(outputs).forEach((x) => x.dispose());
    }
  } finally {
    tensor.dispose();
  }
}
export class VisualCaptionReader {
  private decoded = new PrintedInferenceCache<Awaited<ReturnType<typeof decode>>>();
  private readPixels(session:ort.InferenceSession,pixels:Float32Array,width:number){
    return this.decoded.read(pixels,()=>decode(session,pixels,width,characters));
  }
  private capture = document.createElement('canvas');
  private sourceBand = document.createElement('canvas');
  private line = document.createElement('canvas');
  private controller = new AbortController();
  private session?: Promise<ort.InferenceSession>;
  private referenceLayout?: Layout;
  private referenceFailed = false;
  private failed = false;
  private layout?: Layout;
  async read(video: HTMLVideoElement, withReference = false) {
    if (this.failed || !video.videoWidth || video.readyState < 2) return;
    try {
      const width = 1280,
        height = Math.round((width * video.videoHeight) / video.videoWidth);
      if (height < 200 || height > 1600) return;
      const band = Math.round(height * 0.24);
      if (this.capture.width !== width || this.capture.height !== band) {
        this.capture.width = width;
        this.capture.height = band;
        this.layout = undefined;
        this.referenceLayout = undefined;
      }
      // Locate rows on the smaller canvas, but read their glyphs straight
      // from the native frame. Tiny kana and voicing marks lose detail when
      // the locator is downsampled and then enlarged again for recognition.
      const sourceWidth = Math.min(video.videoWidth, 1920);
      const sourceHeight = Math.round(video.videoHeight * 0.24 * sourceWidth / video.videoWidth);
      if (this.sourceBand.width !== sourceWidth || this.sourceBand.height !== sourceHeight) {
        this.sourceBand.width = sourceWidth;
        this.sourceBand.height = sourceHeight;
      }
      this.sourceBand.getContext('2d')!.drawImage(
        video,
        0,
        video.videoHeight * 0.76,
        video.videoWidth,
        video.videoHeight * 0.24,
        0,
        0,
        sourceWidth,
        sourceHeight,
      );
      const ctx = this.capture.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(this.sourceBand, 0, 0, width, band);
      const pixels = ctx.getImageData(0, 0, width, band);
      const candidates = subtitleLines(pixels, this.layout);
      if (!candidates.length) return;
      // Copy the observed frame before starting any asynchronous work.
      const box = candidates[0],
        dimensions = this.prepare(box);
      if (!dimensions) return;
      if (!this.session) {
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false;
        ort.env.wasm.wasmPaths = chrome.runtime.getURL('vad/');
        this.session = verifiedModel(() => {}, this.controller.signal, model).then((bytes) =>
          ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }),
        );
      }
      const session = await this.session;
      this.controller.signal.throwIfAborted();
      let letters = await this.readPixels(session, dimensions.input, dimensions.width);
      if (!letters?.length) return;
      let text = letters.map((x) => x.char).join('');
      if (hasIsolatedKana(text) || hasUncertainCompound(letters) || hasUncertainKanaGlyph(letters)) {
        const raw = await this.readPixels(session, dimensions.rawPixels(), dimensions.width);
        if (raw?.length && hasUncertainKanaGlyph(letters)) {
          letters = corroborateKanaGlyph(letters,raw);
          text = letters.map(x=>x.char).join('');
        }
        if (raw?.length && hasUncertainCompound(letters)) {
          letters = corroborateCompound(letters,raw);
          text = letters.map(x=>x.char).join('');
        }
        if (raw?.length && raw.every(letter => letter.p >= 0.65) && raw.reduce((sum, letter) => sum + letter.p, 0) / raw.length >= 0.94)
          text = corroborateKana(text, raw.map(letter => letter.char).join(''));
      }
      // Stylized song captions use low-confidence waves and dot separators.
      // Completeness requires every letter/number to be readable; retain all
      // glyphs in the mean so punctuation-heavy noise still fails confidence.
      const min = printedLetterMinimum(letters);
      const mean = letters.reduce((total, x) => total + x.p, 0) / letters.length;
      if (
        mean > 0.96 &&
        min > 0.72 &&
        /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) &&
        box.width > box.height * 4
      ) {
        // Learn the outline and height from a confidently read line, so short
        // replies and spaces do not cause the last glyphs to be cut off.
        const colors = new Uint16Array(4096);
        const { data } = pixels;
        for (let y = box.top; y < box.top + box.height; y++)
          for (let x = box.left; x < box.left + box.width; x++) {
            const i = (y * pixels.width + x) * 4;
            if (Math.max(data[i], data[i + 1], data[i + 2]) > 144) continue;
            if (
              ![-3, 3, -3 * pixels.width, 3 * pixels.width].some(
                (offset) =>
                  Math.min(data[i + 4 * offset], data[i + 4 * offset + 1], data[i + 4 * offset + 2]) >
                  218,
              )
            )
              continue;
            colors[(data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4)]++;
          }
        let best = 0;
        for (let i = 1; i < 4096; i++) if (colors[i] > colors[best]) best = i;
        if (colors[best] > 20)
          this.layout = { box, color: [best >> 8, (best >> 4) & 15, best & 15].map((x) => x * 16 + 8) };
      }
      const reference =
        withReference && mean >= 0.93 && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)
          ? await this.readReference(ctx, box, session)
          : undefined;
      return { text: text.trim(), confidence: mean, min, box, reference };
    } catch {
      this.failed = true;
    }
  }
  private async readReference(ctx: CanvasRenderingContext2D, lower: Line, session: ort.InferenceSession) {
    if (this.referenceFailed) return;
    const top = Math.max(0, lower.top - Math.ceil(lower.height * 1.8)),
      height = lower.top - top;
    if (height < 16) return;
    const band = ctx.getImageData(0, top, this.capture.width, height);
    const rows = subtitleLines(band, this.referenceLayout, lower.height);
    let upper = printedReferenceLine(rows, lower.height, band.width, height);
    const fragment = rows[0];
    if (this.layout && fragment && fragment.height < lower.height * 0.65 &&
        height - fragment.top - fragment.height < lower.height * 0.3) {
      // On short lines, the row above a real bottom fragment may join the
      // character artwork. Locate the matching outline in the adjacent row.
      const expectedHeight = Math.min(height,Math.round(lower.height*1.2));
      const prior = {color:this.layout.color,box:{...fragment,top:height-expectedHeight,height:expectedHeight}};
      const candidate = subtitleLines(band,prior)[0];
      if(candidate && candidate.height === expectedHeight &&
         candidate.left <= fragment.left+2 && candidate.left+candidate.width >= fragment.left+fragment.width-2)
        upper = candidate;
    }
    if (!upper) return;
    if (this.layout && upper.width < lower.height*3.5 && upper.height < lower.height*1.15) {
      // In a short Chinese row, clipping the tops of both square glyphs
      // can still yield a very confident one-character reading.
      const end=Math.min(height,upper.top+upper.height);
      const start=Math.max(0,end-Math.round(lower.height*1.2));
      upper={...upper,top:start,height:end-start};
    }
    if (this.layout) {
      // Cold localization can miss a Chinese glyph made of horizontal strokes.
      // Recheck only this row using the already learned subtitle outline; do
      // not pull in a different row or expand into distant scene lettering.
      const bounded = subtitleLines(band,{box:upper,color:this.layout.color})[0];
      const margin = Math.ceil(lower.height*1.3),right = upper.left+upper.width;
      if (bounded && bounded.top===upper.top && bounded.height===upper.height &&
          bounded.left<=upper.left+2 && bounded.left+bounded.width>=right-2 &&
          bounded.left>=upper.left-margin && bounded.left+bounded.width<=right+margin)
        upper=bounded;
    }
    const prepared = this.prepare({ ...upper, top: upper.top + top });
    if (!prepared) return;
    try {
      // The enclosed-white-stroke mask used for small kana can erase parts of
      // Chinese glyphs, sometimes leaving a confident but incomplete phrase.
      // Recognize the observed reference pixels directly, with one inference.
      const result = await this.readPixels(session, prepared.rawPixels(), prepared.width);
      if (
        !result?.length ||
        result.some((x) => x.p < 0.72) ||
        result.reduce((s, x) => s + x.p, 0) / result.length < 0.95
      )
        return;
      const text = result
        .map((x) => x.char)
        .join('')
        .trim();
      if (
        text.length <= 90 &&
        /\p{Script=Han}/u.test(text) &&
        /^[\p{Script=Han}\p{N}\p{P}\s]+$/u.test(text)
      ) {
        if (this.layout) this.referenceLayout = { box: upper, color: this.layout.color };
        return text;
      }
    } catch {
      this.referenceFailed = true;
    }
  }
  private prepare(box: Line) {
    const scaled = Math.ceil((48 * box.width) / box.height);
    if (scaled > 1400) return;
    const width = Math.max(320, Math.ceil(scaled / 8) * 8);
    this.line.width = scaled;
    this.line.height = 48;
    const ctx = this.line.getContext('2d', { willReadFrequently: true })!;
    const sx = this.sourceBand.width / this.capture.width, sy = this.sourceBand.height / this.capture.height;
    ctx.drawImage(this.sourceBand, box.left * sx, box.top * sy, box.width * sx, box.height * sy, 0, 0, scaled, 48);
    const rgba = ctx.getImageData(0, 0, scaled, 48).data,
      plane = width * 48,
      input = new Float32Array(3 * plane);
    // The light interiors of outlined letters form enclosed components.
    // Preserve those strokes on a plain background for short stylized text.
    const n = 48 * scaled,
      exterior = new Uint8Array(n),
      queue = new Uint32Array(n);
    let head = 0,
      tail = 0;
    const visit = (i: number) => {
      if (exterior[i] || Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) < 150) return;
      exterior[i] = 1;
      queue[tail++] = i;
    };
    for (let x = 0; x < scaled; x++) {
      visit(x);
      visit(47 * scaled + x);
    }
    for (let y = 0; y < 48; y++) {
      visit(y * scaled);
      visit((y + 1) * scaled - 1);
    }
    while (head < tail) {
      const i = queue[head++],
        x = i % scaled;
      if (x > 0) visit(i - 1);
      if (x + 1 < scaled) visit(i + 1);
      if (i >= scaled) visit(i - scaled);
      if (i + scaled < n) visit(i + scaled);
    }
    for (let y = 0; y < 48; y++)
      for (let x = 0; x < scaled; x++) {
        const pixel = (y * scaled + x) * 4,
          offset = y * width + x;
        const white = Math.min(rgba[pixel], rgba[pixel + 1], rgba[pixel + 2]);
        const ink = exterior[y * scaled + x] ? 0 : Math.min(1, Math.max(0, (white - 155) / 70));
        for (let c = 0; c < 3; c++) {
          input[c * plane + offset] = 1 - 2 * ink;
        }
      }
    const rawPixels = () => {
      const raw = new Float32Array(3 * plane);
      for (let y = 0; y < 48; y++)
        for (let x = 0; x < scaled; x++)
          for (let c = 0; c < 3; c++)
            raw[c * plane + y * width + x] = rgba[(y * scaled + x) * 4 + 2 - c] / 127.5 - 1;
      return raw;
    };
    return { width, input, rawPixels };
  }
  dispose() {
    this.decoded.clear();
    this.controller.abort();
    void this.session?.then((s) => s.release()).catch(() => {});
  }
}

export function printedLetterMinimum(letters:{char:string;p:number}[]){
  const spoken=letters.filter(g=>/[\p{L}\p{N}]/u.test(g.char));
  return spoken.length?Math.min(...spoken.map(g=>g.p)):0;
}
