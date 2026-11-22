import {requirePageSender} from './backend-status';
import {resolveSource} from './domain';

/** sender.url can retain the original document URL after history.pushState. */
export function readCurrentPageUrl(){return location.href;}
export async function currentPageSender(sender:chrome.runtime.MessageSender):Promise<chrome.runtime.MessageSender>{
 const page=requirePageSender(sender);
 const target:chrome.scripting.InjectionTarget=page.documentId?{tabId:page.tabId,documentIds:[page.documentId]}:{tabId:page.tabId,frameIds:[0]};
 const rows=await chrome.scripting.executeScript({target,world:'ISOLATED',func:readCurrentPageUrl});
 const row=rows[0];
 if(rows.length!==1||row.frameId!==0||page.documentId&&row.documentId!==page.documentId||typeof row.result!=='string')throw new Error('视频文档已变化，请重新点击声格连接。');
 if(new URL(row.result).origin!==new URL(page.url).origin)throw new Error('视频来源已变化，请重新点击声格连接。');
 resolveSource(row.result);
 return {...sender,url:row.result};
}
