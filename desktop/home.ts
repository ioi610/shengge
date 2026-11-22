import {extensionClient} from '../src/client';
import {message,resolveSource,type Clip} from '../src/domain';

const input=document.querySelector<HTMLInputElement>('#url')!;
const note=(s:string)=>{document.querySelector('#notice')!.textContent=s;};
document.querySelector<HTMLFormElement>('form')!.onsubmit=e=>{
 e.preventDefault();try{location.assign(resolveSource(input.value).url);}catch(error){note(message(error));input.focus();}
};
document.querySelector<HTMLButtonElement>('#records')!.onclick=()=>location.assign('index.html#records');
document.querySelector<HTMLButtonElement>('#home')!.onclick=()=>input.focus();
document.querySelector<HTMLButtonElement>('#paste')!.onclick=async()=>{try{input.value=await navigator.clipboard.readText();input.focus();}catch{note('请用 ⌘V 粘贴视频链接。');input.focus();}};
const cards=document.querySelector('#cards')!;
function card(title:string,url:string,demo=false){
 const button=document.createElement('button');button.className='card';
 if(demo){const img=document.createElement('img');img.src='cafe.jpg';img.alt='';button.append(img);}
 const label=document.createElement('span');label.textContent=title;button.append(label);button.onclick=()=>location.assign(url);cards.append(button);
}
async function recent(){
 const client=extensionClient();await client.hello();
 const data=await client.call('LIST_RECORDS',{limit:12});
 const seen=new Set<string>();
 for(const clip of data.clips as Clip[]){if(seen.has(clip.videoKey))continue;seen.add(clip.videoKey);
  const demo=clip.videoKey==='demo:cafe';const target=new URL(demo?chrome.runtime.getURL('practice.html'):resolveSource(clip.url).url);target.hash='shengge='+encodeURIComponent(clip.id);
  card(clip.title,target.href,demo);
 }
 const history=(await chrome.storage.local.get(['legacyRecent','recentVideos']));
 for(const item of [...(history.recentVideos??[]),...(history.legacyRecent??[])]){
  if(seen.has(item.videoKey)||item.videoKey==='demo:cafe')continue;
  try{const src=resolveSource(item.url);if(seen.has(src.videoKey))continue;seen.add(src.videoKey);card(String(item.title),src.url);}catch{}
 }
 if(!seen.has('demo:cafe'))card('駅前のカフェ · 示例视频','practice.html',true);
}
void recent().catch(e=>{note(message(e));card('駅前のカフェ · 示例视频','practice.html',true);});
