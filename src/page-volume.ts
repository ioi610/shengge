import {requirePageSender} from './backend-status';

export type VolumeChange={volume?:number;muted?:boolean};
export function validateVolumeChange(value:any):VolumeChange {
 if(!value||typeof value!=='object'||Object.keys(value).some(k=>k!=='volume'&&k!=='muted')||
  value.volume===undefined&&value.muted===undefined||
  value.volume!==undefined&&(!Number.isFinite(value.volume)||value.volume<0||value.volume>100)||
  value.muted!==undefined&&typeof value.muted!=='boolean')throw new Error('无效的音量设置。');
 return {volume:value.volume,muted:value.muted};
}
/** Runs in the current document's MAIN world; no imported dependencies. */
export function applyYoutubeVolume(url:string,mediaSrc:string,change:VolumeChange){
 const current=new URL(location.href),expected=new URL(url);
 if(current.origin!==expected.origin||current.pathname!==expected.pathname||current.searchParams.get('v')!==expected.searchParams.get('v'))throw new Error('视频已变化，请重新连接声格。');
 const player=document.querySelector('#movie_player') as any;
 const video=player?.querySelector('video') as HTMLVideoElement|undefined;
 if(!video||!mediaSrc||video.currentSrc!==mediaSrc)throw new Error('播放器已变化，请重新连接声格。');
 if(['setVolume','getVolume','mute','unMute','isMuted'].some(k=>typeof player[k]!=='function'))throw new Error('原平台音量控制尚未就绪。');
 // Keep YouTube's own state in sync; HTMLMediaElement assignments are overwritten by it.
 const muted=change.muted??(change.volume===0?true:player.isMuted());
 if(muted)player.mute();
 if(change.volume!==undefined)player.setVolume(change.volume);
 if(!muted)player.unMute();
 return {volume:player.getVolume(),muted:player.isMuted()};
}
export async function dispatchPageVolume(message:any,sender:chrome.runtime.MessageSender){
 const page=requirePageSender(sender),change=validateVolumeChange(message.change);
 if(page.source.platform!=='youtube'||typeof message.mediaSrc!=='string'||!message.mediaSrc||message.mediaSrc.length>16000)throw new Error('无效的播放器音量请求。');
 const target:chrome.scripting.InjectionTarget=page.documentId?{tabId:page.tabId,documentIds:[page.documentId]}:{tabId:page.tabId,frameIds:[0]};
 const rows=await chrome.scripting.executeScript({target,world:'MAIN',func:applyYoutubeVolume,args:[page.url,message.mediaSrc,change]});
 if(rows.length!==1||rows[0].frameId!==0||page.documentId&&rows[0].documentId&&rows[0].documentId!==page.documentId||!rows[0].result)throw new Error('音量调整失败，请重新连接声格。');
 return rows[0].result;
}
