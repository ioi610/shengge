import {warmCachedRecognition} from './recognition-warmup';
import {RecognitionHost} from './recognition-host';
import {TurnHost} from './turn-host';
import {AnalysisCache} from './analysis-cache';
const host=new RecognitionHost();
const turns=new TurnHost();
const analysis=new AnalysisCache();
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.target!=='ASR_OFFSCREEN')return;
 if(sender.id!==chrome.runtime.id||sender.tab)return;
 if(message.action?.startsWith('analysis-')){void analysis.request(message.action,message.payload,message.videoKey).then(data=>reply({ok:true,data}),error=>reply({ok:false,error:error.message}));return true;}
 if(message.action?.startsWith('turn-')){void turns.request(message.action,message.payload,message.owner).then(data=>reply({ok:true,data}),error=>reply({ok:false,error:error.message}));return true;}
 if(message.action==='warmup'){void warmCachedRecognition(()=>host.request('prepare',{},message.owner)).then(data=>reply({ok:true,data}),()=>reply({ok:true,data:{warming:false}}));return true;}
 try{reply({ok:true,data:host.request(message.action,message.payload,message.owner)});}catch(error){reply({ok:false,error:(error as Error).message});}
});
