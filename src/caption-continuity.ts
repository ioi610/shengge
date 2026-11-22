export type ContinuousCaptionAudio={pcm:Float32Array;addedPrefixMs:number};

const rate=16; // Samples per millisecond; caption input is mono 16 kHz PCM.
const prefix=400*rate,repair=96*rate,matchStart=128*rate,matchEnd=192*rate;
const tolerance=96*rate,minZeroRun=16*rate;

/** Restore a capture-start defect only from an independently aligned overlap
 * already heard in the previous caption. The caller must establish same video,
 * rate and uninterrupted continuation before supplying the media-time offset.
 * No offset or insufficient evidence leaves the original PCM untouched. */
export function restoreCaptionContinuity(previous:Float32Array,current:Float32Array,expectedOffsetMs?:number):ContinuousCaptionAudio{
 const unchanged={pcm:current,addedPrefixMs:0};
 if(expectedOffsetMs===undefined||!Number.isFinite(expectedOffsetMs)||current.length<matchEnd)return unchanged;
 let run=0,zeroStart=-1,zeroEnd=-1;
 for(let i=0;i<repair;i++){
  if(!Number.isFinite(current[i]))return unchanged;
  if(current[i]===0){run++;if(run>=minZeroRun){zeroStart=i-run+1;zeroEnd=i+1;}}
  else {if(zeroEnd>=0)break;run=0;}
 }
 if(zeroStart<0)return unchanged;
 const predicted=Math.round(expectedOffsetMs*rate);
 const first=Math.max(prefix,predicted-tolerance),last=Math.min(previous.length-matchEnd,predicted+tolerance);
 if(last<first)return unchanged;
 const width=matchEnd-matchStart,template=new Float64Array(width);
 let mean=0;for(let i=0;i<width;i++){const x=current[matchStart+i];if(!Number.isFinite(x))return unchanged;mean+=x;}mean/=width;
 let templateEnergy=0;for(let i=0;i<width;i++){const x=template[i]=current[matchStart+i]-mean;templateEnergy+=x*x;}
 if(templateEnergy/width<.003**2)return unchanged;
 let sum=0,squares=0,products=0;
 for(let i=first+matchStart;i<Math.min(previous.length,last+matchEnd+1);i++){
  const x=previous[i];if(!Number.isFinite(x))return unchanged;
  if(i<first+matchEnd){sum+=x;squares+=x*x;if(i+1<previous.length)products+=x*previous[i+1];}
 }
 const count=last-first+1,cross=new Float64Array(count+1),variance=new Float64Array(count+1),covariance=new Float64Array(count);
 // Compute each integer inner product once. Linear phase scores then use the
 // covariance of adjacent windows, rather than eight more waveform scans.
 for(let i=0;i<=count;i++){
  const start=first+i+matchStart,end=start+width;if(end>previous.length)break;
  let dot=0;for(let j=0;j<width;j++)dot+=previous[start+j]*template[j];
  cross[i]=dot;variance[i]=Math.max(0,squares-sum*sum/width);
  if(end<previous.length){
   const out=previous[start],next=previous[end],nextSum=sum-out+next;
   if(i<count)covariance[i]=products-sum*nextSum/width;
   if(end+1<previous.length)products+=next*previous[end+1]-out*previous[start+1];
   sum=nextSum;squares+=next*next-out*out;
  }
 }
 const scores=new Float64Array(count*8).fill(-1);let best=-1,bestIndex=0;
 for(let i=0;i<count;i++)for(let phase=0;phase<8;phase++){
  const fraction=phase/8,position=first+i+fraction;
  if(position>predicted+tolerance||position+matchEnd>previous.length)continue;
  const a=1-fraction,b=fraction;
  const energy=a*a*variance[i]+b*b*variance[i+1]+2*a*b*covariance[i];
  const score=scores[i*8+phase]=energy>1e-12?(a*cross[i]+b*cross[i+1])/Math.sqrt(energy*templateEnergy):-1;
  if(score>best){best=score;bestIndex=i*8+phase;}
 }
 if(best<.94)return unchanged;
 // Nearby samples describe the same correlation peak. A competing peak more
 // than 1 ms away (including periodic tones) must remain clearly weaker. Every
 // competing position receives the SAME fractional-phase refinement.
 let second=-1;for(let i=0;i<scores.length;i++)if(Math.abs(i-bestIndex)>rate*8)second=Math.max(second,scores[i]);
 if(best-second<.15)return unchanged;
 const position=first+bestIndex/8,lower=Math.floor(position);
 // Matching accounts for resampler phase; output still copies original PCM.
 // At an exact half-sample tie, prefer the stronger integer correlation.
 const bestOffset=bestIndex%8===4&&scores[(lower-first)*8]>=scores[(lower-first+1)*8]?lower:Math.round(position);
 let missingEnergy=0;
 for(let i=bestOffset-prefix;i<bestOffset+repair;i++)if(!Number.isFinite(previous[i]))return unchanged;
 for(let i=zeroStart;i<zeroEnd;i++)missingEnergy+=previous[bestOffset+i]**2;
 // Genuine silence present in both captures is not a startup defect.
 if(missingEnergy/(zeroEnd-zeroStart)<.003**2)return unchanged;
 const pcm=new Float32Array(prefix+current.length);
 pcm.set(previous.subarray(bestOffset-prefix,bestOffset+repair));
 pcm.set(current.subarray(repair),prefix+repair);
 return {pcm,addedPrefixMs:prefix/rate};
}
