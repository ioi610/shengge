export function decodeRecognitionWav(audio:Uint8Array,durationMs:number){
 if(audio.length<44)throw new Error('音频为空。');const v=new DataView(audio.buffer,audio.byteOffset,audio.byteLength);const text=(offset:number,count:number)=>String.fromCharCode(...audio.subarray(offset,offset+count));
 if(text(0,4)!=='RIFF'||text(8,4)!=='WAVE'||text(12,4)!=='fmt '||v.getUint32(16,true)!==16||v.getUint16(20,true)!==1||v.getUint16(22,true)!==1||v.getUint32(24,true)!==16000||v.getUint16(34,true)!==16||text(36,4)!=='data'||v.getUint32(40,true)!==audio.length-44||(audio.length-44)%2||Math.abs((audio.length-44)/32-durationMs)>64)throw new Error('实时音频格式或时间戳不匹配。');
 const pcm=new Float32Array((audio.length-44)/2);for(let i=0;i<pcm.length;i++)pcm[i]=v.getInt16(44+i*2,true)/32768;return pcm;
}
