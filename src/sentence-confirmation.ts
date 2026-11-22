export type TextSentence={startMs:number;endMs:number;text:string;confidence?:number;language?:string;timing?:'aligned';words?:{startMs:number;endMs:number;text:string}[]};
const terminal=/[。！？.!?؟۔।][”’"」』）)\]]*$/u;
const normalize=(s:string)=>s.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'').toLocaleLowerCase();
function sameSentence(a:string,b:string){
 const x=normalize(a),y=normalize(b);if(x===y)return true;if(Math.min(x.length,y.length)<6||Math.min(x.length,y.length)/Math.max(x.length,y.length)<.9)return false;
 let row=Array.from({length:y.length+1},(_,i)=>i);for(let i=1;i<=x.length;i++){const next=[i];for(let j=1;j<=y.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(x[i-1]===y[j-1]?0:1));row=next;}return 1-row[y.length]/Math.max(x.length,y.length)>=.88;
}
export const unfinishedClause=(text:string)=>{
 const s=text.trim();if(terminal.test(s))return false;
 return /[，,、：:;；—-]$|(?:的时候|之前|之后|因为|所以|但是|虽然|如果|而且|以及|つまり|けれど|けど|ので|のに|ながら|について|の場合)$/u.test(s)||/\b(?:and|but|because|although|if|when|while|of|to|the|a|an|with)$/iu.test(s)||/^(?:when|if|although|while)\b[^,]*$/iu.test(s);
};
export const isMusicText=(text:string)=>/^[\s]*[♪♫♬]|[♪♫♬][\s]*$/u.test(text)||/^(?:music|background music|instrumental music|音楽|音乐|背景音乐|音樂|背景音樂)$/iu.test(text.trim());
/** Decoder stage directions are not spoken dialogue or language evidence. */
export const isNonSpeechAnnotation=(text:string)=>/^\s*[[(].*[\])]\s*$/u.test(text.normalize('NFKC'))||/^\s*(?:(?:\[[^\[\]]+\]|\([^()]+\)|\*[^*\n]+\*)\s*)+$/u.test(text.normalize('NFKC'));
export const isDialogueText=(text:string)=>/[\p{L}\p{N}]/u.test(text)&&!isMusicText(text)&&!isNonSpeechAnnotation(text)&&!/^([\p{L}\p{N}])\1{5,}$/u.test(text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,''));
export class SentenceConfirmation {
 private previous:TextSentence[]=[];
 stableReadings=0;
 accept(segments:TextSentence[],observedMs:number,turnClosed=false,acousticSupport=false){
  let valid=segments.filter(s=>Number.isFinite(s.startMs)&&Number.isFinite(s.endMs)&&s.endMs>s.startMs&&s.startMs>=0&&s.endMs<=observedMs+100&&isDialogueText(s.text));
  valid=valid.reduce<TextSentence[]>((rows,s)=>{const prior=rows.at(-1);if(prior&&unfinishedClause(prior.text)&&s.startMs-prior.endMs<1200){prior.endMs=s.endMs;prior.text+=' '+s.text;prior.confidence=Math.min(prior.confidence??0,s.confidence??0);}else rows.push({...s});return rows;},[]);
  let confirmed:TextSentence|undefined;if(!valid.length)this.stableReadings=0;
  for(let i=0;i<Math.min(1,valid.length);i++){
   const s=valid[i];if(!turnClosed&&unfinishedClause(s.text))continue;if(!turnClosed&&i===valid.length-1&&(!terminal.test(s.text.trim())||observedMs-s.endMs<500))continue;
   const prior=this.previous.find(p=>sameSentence(p.text,s.text)&&Math.abs(p.endMs-s.endMs)<=250&&Math.abs(p.startMs-s.startMs)<=250);
   this.stableReadings=prior?this.stableReadings+1:1;
   // Short replies can lose token probability as unrelated following speech is appended.
   // Require a matching timed hypothesis and at least one confident reading.
   if(prior&&((s.confidence??0)>=(acousticSupport?.45:.6)||(s.endMs-s.startMs<=2500&&normalize(s.text).length<=16&&(s.confidence??0)>=.15&&(prior.confidence??0)>=.6))){confirmed={...s,confidence:Math.min(s.confidence??0,prior.confidence??0)};break;}
  }
  this.previous=valid.map(s=>({...s}));return confirmed;
 }
}
export function encodePcmWav(samples:Float32Array){
 const bytes=new Uint8Array(44+samples.length*2),v=new DataView(bytes.buffer);const text=(at:number,s:string)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
 text(0,'RIFF');v.setUint32(4,bytes.length-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,samples.length*2,true);
 for(let i=0;i<samples.length;i++)v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);return bytes;
}
