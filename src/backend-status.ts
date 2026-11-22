import {BUILD_VERSION} from './config';
import {resolveSource} from './domain';

export function requirePageSender(sender:chrome.runtime.MessageSender){
 if(sender.id!==chrome.runtime.id||!Number.isInteger(sender.tab?.id)||sender.tab!.id!<0||sender.frameId!==0||!sender.url)throw new Error('声格未连接当前视频，请重新点击工具栏的声格。');
 const source=resolveSource(sender.url);
 return {tabId:sender.tab!.id!,documentId:sender.documentId,url:sender.url,source};
}
export function backendStatus(sender:chrome.runtime.MessageSender){
 const page=requirePageSender(sender);
 return {buildVersion:BUILD_VERSION,pageAudio:1,analysisCache:1,videoKey:page.source.videoKey,documentTarget:page.documentId?'document':'frame'};
}
export function verifyBackend(response:any,version=BUILD_VERSION){
 // 0.8.25 changes only the content script. The installed 0.8.24 worker
 // implements every request it needs, including saved caption and turn data.
 const compatible=response?.data?.buildVersion===version || version==='0.8.25' && response?.data?.buildVersion==='0.8.24';
 if(!response?.ok||!compatible||response.data?.pageAudio!==1||response.data?.analysisCache!==1){
  const backend=typeof response?.data?.buildVersion==='string'?response.data.buildVersion:'无法确认';
  throw new Error(`声格网页与后台未同步（网页 ${version}，运行后台 ${backend}）。请在 chrome://extensions 点击「声格」卡片的重新加载箭头，再刷新视频页并点击声格。仅刷新视频页不会更新后台；原记录会保留。`);
 }
}
