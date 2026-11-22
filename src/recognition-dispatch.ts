import {resolveSource} from './domain';
let creating:Promise<void>|undefined;
export async function dispatchRecognition(message:any,sender:chrome.runtime.MessageSender){
 if(sender.id!==chrome.runtime.id||!sender.tab?.id||sender.frameId!==0||!sender.url)throw new Error('INVALID_REQUEST');resolveSource(sender.url);
 if(!['warmup','prepare','health','submit','status','cancel','turn-prepare','turn-analyze','turn-release','analysis-load','analysis-save'].includes(message.action))throw new Error('INVALID_REQUEST');
 const url=chrome.runtime.getURL('recognition-offscreen.html');
 if(!await chrome.offscreen.hasDocument()){
  creating??=chrome.offscreen.createDocument({url,reasons:[chrome.offscreen.Reason.WORKERS],justification:'在扩展内运行离线语音模型，替代用户安装本机组件。'}).finally(()=>{creating=undefined;});
 }
 if(creating)await creating;
 const owner=`${sender.tab.id}:${sender.documentId??sender.url}`;
 const response=await chrome.runtime.sendMessage({target:'ASR_OFFSCREEN',action:message.action,payload:message,owner,videoKey:resolveSource(sender.url).videoKey});
 if(!response?.ok)throw new Error(response?.error??'扩展识别未能启动，请重新加载扩展。');return response.data;
}
