import {resolveSource} from './domain';
import {requirePageSender} from './backend-status';

export class AudioSourceUnavailable extends Error {readonly code='AUDIO_SOURCE_UNAVAILABLE';}

export function allowedAudioUrl(value:unknown,platform:'bilibili'|'youtube'):string|undefined {
 if(typeof value!=='string'||value.length>16000)return;
 try{const u=new URL(value);const suffix=platform==='bilibili'?'bilivideo.com':'googlevideo.com';
  const knownBiliCdn=platform==='bilibili'&&u.hostname==='upos-hz-mirrorakam.akamaized.net';
  if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(knownBiliCdn||u.hostname===suffix||u.hostname.endsWith('.'+suffix)))return u.href;
 }catch{/* The page is untrusted; never fetch arbitrary origins. */}
}

/** Runs in the current page's MAIN world; contains no imported dependencies. */
export function readPageAudio(){
 const page=window as unknown as {__playinfo__?:any;__INITIAL_STATE__?:any;ytInitialPlayerResponse?:any;player?:any};
 const videos=Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
 const video=videos.find(v=>v.closest('#movie_player')&&v.getBoundingClientRect().width>100&&v.getBoundingClientRect().height>50)??videos.find(v=>v.getBoundingClientRect().width>100&&v.getBoundingClientRect().height>50)??(videos.length===1?videos[0]:undefined);
 if(location.hostname.endsWith('bilibili.com')){
  const state=page.__INITIAL_STATE__,data=page.__playinfo__?.data;
  let manifest:any;try{manifest=page.player?.getManifest?.();}catch{/* Player is switching episodes. */}
  const part=Number(manifest?.p??state?.p??1),cid=Number(manifest?.cid??state?.videoData?.pages?.find((p:any)=>p.page===part)?.cid??state?.videoData?.cid);
  // The initial response can survive SPA navigation. Only retain this CID's
  // audio files, preferring URLs already used by the live player.
  const currentAudio=(value:unknown)=>{try{const p=new URL(String(value)).pathname;return Number.isSafeInteger(cid)&&cid>0&&new RegExp(`^/upgcxcode/\\d+/\\d+/${cid}/${cid}-[\\d-]+-302\\d{2}\\.m4s$`).test(p);}catch{return false;}};
  const observed=performance.getEntriesByType('resource').map(r=>r.name).reverse().filter(currentAudio);
  const supplied=(data?.dash?.audio??[]).filter((a:any)=>a.mimeType==='audio/mp4'||a.mime_type==='audio/mp4').sort((a:any,b:any)=>(b.bandwidth??0)-(a.bandwidth??0)).slice(0,4).flatMap((a:any)=>[a.baseUrl??a.base_url,...(a.backupUrl??a.backup_url??[])]).filter(currentAudio);
  return {url:location.href,id:manifest?.bvid??state?.videoData?.bvid??state?.bvid,aid:manifest?.aid??state?.videoData?.aid,part,cid,durationMs:video?video.duration*1000:data?.timelength,
   candidates:[...new Set([...observed,...supplied])].slice(0,24),mediaSrc:video?.currentSrc};
 }
 const id=new URL(location.href).searchParams.get('v')??location.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1];
 let current:any;try{current=(document.querySelector('#movie_player') as any)?.getPlayerResponse?.();}catch{/* SPA player may be replacing its response. */}
 const data=current?.videoDetails?.videoId===id?current:page.ytInitialPlayerResponse?.videoDetails?.videoId===id?page.ytInitialPlayerResponse:undefined;
 return {url:location.href,id:data?.videoDetails?.videoId,durationMs:Number(data?.videoDetails?.lengthSeconds)*1000,
  candidates:(data?.streamingData?.adaptiveFormats??[]).filter((a:any)=>String(a.mimeType).startsWith('audio/')&&typeof a.url==='string').sort((a:any,b:any)=>(b.bitrate??0)-(a.bitrate??0)).slice(0,4).map((a:any)=>a.url),streamOnly:Boolean(data?.streamingData?.serverAbrStreamingUrl),mediaSrc:video?.currentSrc};
}

export function validatePageAudio(data:any,pageUrl:string){
 const source=resolveSource(pageUrl);
 if(!data||resolveSource(data.url).videoKey!==source.videoKey||!Number.isFinite(data.durationMs)||data.durationMs<=0)throw new Error('视频信息已变化，请刷新原站后重试分析。');
 if(source.platform==='bilibili'){
  const page=Number(new URL(source.url).searchParams.get('p')??1);
  if((source.id.startsWith('BV')?data.id!==source.id:source.id!==`av${data.aid}`)||Number(data.part)!==page)throw new Error('当前分集音轨尚未就绪，请刷新原站后重试分析。');
  if(!Number.isSafeInteger(data.cid)||data.cid<=0)throw new Error('当前分集音轨身份尚未就绪，请重新连接后分析。');
 }else if(data.id!==source.id)throw new Error('视频音轨尚未更新，请刷新原站后重试分析。');
 const urls=[...new Set((Array.isArray(data.candidates)?data.candidates:[]).map((u:unknown)=>allowedAudioUrl(u,source.platform)).filter((u:unknown):u is string=>typeof u==='string'&&(source.platform!=='bilibili'||new RegExp(`^/upgcxcode/\\d+/\\d+/${data.cid}/${data.cid}-[\\d-]+-302\\d{2}\\.m4s$`).test(new URL(u).pathname))))];
 if(!urls.length)throw new AudioSourceUnavailable(source.platform==='youtube'&&data.streamOnly?'此 YouTube 视频使用分段音轨，暂不能快速预读。可先从头播放采集完整音轨，再分析和练习；采集期间不能跳转，停止或刷新后需重新采集。':'原站未提供可整段读取的音轨。可先从头播放采集，再分析和练习；停止或刷新后需重新采集。');
 return {videoKey:source.videoKey,durationMs:data.durationMs,urls,mediaSrc:data.mediaSrc};
}

export async function dispatchPageAudio(sender:chrome.runtime.MessageSender){
 const page=requirePageSender(sender);
 const target:chrome.scripting.InjectionTarget=page.documentId?{tabId:page.tabId,documentIds:[page.documentId]}:{tabId:page.tabId,frameIds:[0]};
 const rows=await chrome.scripting.executeScript({target,world:'MAIN',func:readPageAudio});
 if(rows.length!==1||rows[0].frameId!==0||page.documentId&&rows[0].documentId&&rows[0].documentId!==page.documentId)throw new Error('视频文档已变化，请重新点击声格连接。');
 return validatePageAudio(rows[0]?.result,page.url);
}
