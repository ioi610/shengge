// Each read supplies a newly sampled, normalized image. An unchanged image
// has the same deterministic result in this reader's single ONNX session.
export class PrintedInferenceCache<T> {
  private entries:{pixels:Float32Array;result:Promise<T>}[]=[];
  read(pixels:Float32Array, infer:()=>Promise<T>) {
    const index=this.entries.findIndex(entry=>equalPixels(pixels,entry.pixels));
    if(index>=0){
      const [hit]=this.entries.splice(index,1);
      this.entries.unshift(hit);
      return hit.result;
    }
    const entry={pixels,result:infer()};
    this.entries.unshift(entry);
    if(this.entries.length>3)this.entries.pop();
    void entry.result.catch(()=>{
      const current=this.entries.indexOf(entry);
      if(current>=0)this.entries.splice(current,1);
    });
    return entry.result;
  }
  clear(){this.entries=[];}
}
function equalPixels(a:Float32Array,b:Float32Array){
  if(a.length!==b.length)return false;
  for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;
  return true;
}
