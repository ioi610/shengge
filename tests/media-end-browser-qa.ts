import {VideoAdapter,waitForMetadata} from '../src/player';
const button=document.querySelector<HTMLButtonElement>('#run')!,out=document.querySelector('#output')!,video=document.querySelector('video')!;
button.onclick=async()=>{
 button.disabled=true;const results:any[]=[];let siteEnds=0,practiceEnds=0;
 // Registered before the extension, as on a real site. Native media events only.
 video.addEventListener('ended',()=>siteEnds++);
 await waitForMetadata(video,new AbortController().signal);
 let adapter=new VideoAdapter(video,'bilibili:qa');
 adapter.mediaEnd.addEventListener('ended',()=>practiceEnds++);
 const waitEnd=async()=>{const start=performance.now();while(!video.ended){if(performance.now()-start>7000)throw Error('EOF timeout');await new Promise(r=>setTimeout(r,25));}await new Promise(r=>setTimeout(r,150));};
 const check=(name:string,ok:boolean)=>{results.push({name,ok,siteEnds,practiceEnds,position:video.currentTime,duration:video.duration});out.textContent=JSON.stringify({results},null,2);if(!ok)throw Error(name);};
 try{
  await adapter.seek((video.duration-1.5)*1000);await adapter.play();await waitEnd();
  check('actual EOF stays on practicing video, final audio not truncated',siteEnds===0&&practiceEnds===1&&video.currentTime===video.duration);
  await adapter.seek((video.duration-1)*1000);await adapter.play();await waitEnd();
  check('second repeat reaches EOF and retains practice ownership',siteEnds===0&&practiceEnds===2);
  adapter.dispose();video.currentTime=video.duration-1;await video.play();await waitEnd();
  check('closing extension restores existing site ended handler',siteEnds===1&&practiceEnds===2);
  adapter=new VideoAdapter(video,'bilibili:qa');adapter.mediaEnd.addEventListener('ended',()=>practiceEnds++);
  video.currentTime=video.duration-1;await video.play();await waitEnd();
  check('toolbar connection without starting practice preserves native EOF',siteEnds===2&&practiceEnds===3);
  out.textContent=JSON.stringify({pass:true,results},null,2);
 }catch(e){out.textContent=JSON.stringify({pass:false,error:String(e),results},null,2);}finally{adapter.dispose();}
};
