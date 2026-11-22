import {compactButton} from './compact-controls';
const key='shengge-youtube-accent-v1';
/** All players default to white; only YouTube offers an optional red accent. */
export function practiceAppearance(root:HTMLElement,videoKey:string){
 root.dataset.accent='white';
 if(!videoKey.startsWith('youtube:'))return null;
 try{if(localStorage.getItem(key)==='red')root.dataset.accent='red';}catch{}
 const control=compactButton('palette','YouTube 红色配色',()=>{
  root.dataset.accent=root.dataset.accent==='red'?'white':'red';
  try{localStorage.setItem(key,root.dataset.accent);}catch{}
  update();
 },{class:'button compact-icon dock-palette','data-focus-key':'youtube-accent'});
 const update=()=>{const red=root.dataset.accent==='red';control.setAttribute('aria-pressed',String(red));control.setAttribute('data-tooltip',red?'切换为白色':'切换为 YouTube 红色');};
 update();return control;
}
