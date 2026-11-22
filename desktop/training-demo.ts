import {desktopPlayer,desktopPage} from './player-view';
import {Workspace} from '../src/workspace';
import {extensionClient} from '../src/client';
import {VideoAdapter,waitForMetadata} from '../src/player';
import {demoCues} from '../tests/fixtures/demo';
import {message} from '../src/domain';

async function openDemo(){
 const video=document.createElement('video');
 video.src='cafe.mp4';video.preload='auto';
 const main=document.querySelector('main')!;
 const surface=document.createElement('div');surface.append(video);main.append(surface);
 const view=desktopPlayer();
 const lifetime=new AbortController();
 window.addEventListener('pagehide',()=>lifetime.abort(),{once:true});
 await waitForMetadata(video,lifetime.signal);
 const client=extensionClient();
 await client.hello();
 const saved=(await chrome.storage.local.get('lines:demo:cafe'))['lines:demo:cafe'];
 const adapter=new VideoAdapter(video,'demo:cafe',Array.isArray(saved)?saved:[...demoCues]);

 const workspace=new Workspace(adapter,client,{demo:true,preAnalyze:true,onExit:()=>desktopPage('home'),onRecords:()=>desktopPage('records')});
 const host=document.createElement('div');const shadow=host.attachShadow({mode:'open'});
 const styles=document.createElement('link');styles.rel='stylesheet';styles.href=chrome.runtime.getURL('app.css');shadow.append(styles,workspace.root);
 view.attach(video,host);view.bind(workspace);
 const params=new URLSearchParams(location.hash.slice(1));
 const id=params.get('shengge');
 if(id){
  const clip=await client.call('GET_RECORD',{},id);
  if(clip.videoKey!=='demo:cafe')throw new Error('记录与示例不匹配');
  await workspace.resume(clip);
  if(params.get('hard')==='1')await workspace.retryHard();
  else if(params.get('restart')==='1')await workspace.restart();
 }
 window.addEventListener('pagehide',()=>{workspace.dispose();adapter.dispose();void client.dispose();},{once:true});
}
void openDemo().catch(e=>{document.querySelector('[role=status]')!.textContent=message(e);});
