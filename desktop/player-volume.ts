export class PlayerVolume {
 private video?:HTMLVideoElement;
 private level=.7;
 private muted=false;
 private remembered=false;
 private ready:Promise<void>;
 private abort?:AbortController;
 private writing=false;
 private revision=0;
 constructor(private toggle:HTMLButtonElement,private slider:HTMLInputElement,private error:(message:string)=>void){
  this.ready=chrome.storage.local.get('desktopSound').then(({desktopSound:s})=>{
   if(s&&typeof s.level==='number'&&s.level>0&&s.level<=1&&typeof s.muted==='boolean'){
    this.level=s.level;this.muted=s.muted;this.remembered=true;
   }
  });
  toggle.onclick=()=>{const v=this.video;if(v)this.change(this.level,!(v.muted||v.volume===0));};
  slider.oninput=()=>{const level=Number(slider.value)/100;this.change(level||this.level,level===0);};
 }
 private change(level:number,muted:boolean){
  this.level=level;this.muted=muted;this.remembered=true;
  void chrome.storage.local.set({desktopSound:{level,muted}});
  void this.apply(!muted);
 }
 private async apply(restoreTab=false){
  const v=this.video;if(!v)return;
  const revision=++this.revision;
  v.volume=this.level;v.muted=this.muted;this.render();
  if(restoreTab)void chrome.runtime.sendMessage({type:'DESKTOP_ENABLE_SOUND'}).catch(()=>{});
  if(!v.closest('#movie_player'))return;
  // Serialize updates to the platform player so dragging the slider cannot
  // leave an older volume request applied after the latest one.
  if(this.writing)return;this.writing=true;
  try{
   const r=await chrome.runtime.sendMessage({type:'PAGE_VOLUME',mediaSrc:v.currentSrc,change:{volume:Math.round(this.level*100),muted:this.muted}});
   if(!r?.ok&&this.video===v&&revision===this.revision)this.error('原站音量暂未就绪，请再点一次音量。');
  }finally{this.writing=false;if(this.revision!==revision&&this.video)void this.apply();else this.render();}
 }
 private render(){
  const v=this.video,silent=!v||v.muted||v.volume===0;
  this.toggle.textContent=silent?'取消静音':'声音开';
  this.toggle.setAttribute('aria-label',silent?'取消静音':'静音');this.toggle.setAttribute('aria-pressed',String(silent));
  this.slider.value=String(silent?0:Math.round(v!.volume*100));this.toggle.disabled=this.slider.disabled=!v;
 }
 bind(video?:HTMLVideoElement){
  this.abort?.abort();this.video=video;this.render();if(!video)return;
  const signal=(this.abort=new AbortController()).signal;
  video.addEventListener('volumechange',()=>this.render(),{signal});
  const initialize=async()=>{
   await this.ready;if(signal.aborted)return;
   if(!this.remembered&&video.volume>0)this.level=video.volume;
   await this.apply(!this.muted);
  };
  // The website may choose muted autoplay. A user's first play uses the
  // desktop preference even if the website reset it after attaching.
  video.addEventListener('play',()=>void initialize(),{once:true,signal});
  void initialize();
 }
}
