/** A separate detector view with low-frequency score/rumble attenuated.
 * Never feed this copy to playback or overwrite the captured source audio. */
export function speechBand(samples:Float32Array):Float32Array {
 const filtered=new Float32Array(samples.length),alpha=1/(1+2*Math.PI*180/16000);
 let previousInput=0,previousOutput=0;
 for(let i=0;i<samples.length;i++){
  const input=samples[i];
  filtered[i]=previousOutput=alpha*(previousOutput+input-previousInput);
  previousInput=input;
 }
 return filtered;
}
