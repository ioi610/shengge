import {TurnModel} from './turn-model';
const model=new TurnModel(new URL('./vad/',import.meta.url).href);
let tail=Promise.resolve();
self.onmessage=({data})=>{tail=tail.then(async()=>{try{const result=await model.analyze(new Float32Array(data.samples),data.offsetMs,data.ended);self.postMessage({id:data.id,result});}catch(error){self.postMessage({id:data.id,error:String((error as Error).message)});}});};
