export function h<K extends keyof HTMLElementTagNameMap>(tag:K,attrs:Record<string,any>|null={},...children:(Node|string|number|null|undefined|false)[]):HTMLElementTagNameMap[K]{const e=document.createElement(tag);for(const [key,value] of Object.entries(attrs??{})){if(value===undefined||value===null)continue;if(key.startsWith('on')&&typeof value==='function')e.addEventListener(key.slice(2).toLowerCase(),value);else if(key==='class')e.className=value;else if(key==='checked'||key==='disabled'||key==='hidden') (e as any)[key]=Boolean(value);else if(key==='value')(e as HTMLInputElement).value=String(value);else e.setAttribute(key,String(value));}for(const child of children){if(child===null||child===undefined||child===false)continue;e.append(child instanceof Node?child:document.createTextNode(String(child)));}if(attrs?.value!==undefined)(e as any).value=String(attrs.value);return e;}
export const button=(label:string,fn:()=>any,kind='',attrs:Record<string,any>={})=>h('button',{type:'button',class:`button ${kind}`,onclick:fn,...attrs},label);
export const text=(content:string,className='')=>h('span',{class:className},content);
export function status(content:string,action?:{label:string;run:()=>void},error=false){return h('div',{class:`status ${error?'warning':''}`,role:error?'alert':'status'},text(content),action&&button(action.label,action.run,'small'));}
export function field(label:string,input:HTMLElement){return h('label',{class:'field'},text(label),input);}
function activeElement():HTMLElement|null{let el=document.activeElement as HTMLElement|null;while(el?.shadowRoot?.activeElement)el=el.shadowRoot.activeElement as HTMLElement;return el;}
const focusKey=(el:HTMLElement)=>`${el.tagName}:${el.dataset.focusKey??el.getAttribute('aria-label')??el.textContent}`;
const canFocus=(el:HTMLElement)=>el.isConnected&&!el.closest('[hidden],[inert]')&&!el.matches(':disabled')&&el.getClientRects().length>0;
/** Restore a removed control after rendering, without stealing a later user focus. */
export function captureFocus(root:HTMLElement,fallback:(previous:HTMLElement)=>HTMLElement|null):()=>void{
 const previous=activeElement();if(!previous||!root.contains(previous))return ()=>{};
 const key=focusKey(previous),scope=root.getRootNode();
 return ()=>{
  if(!root.isConnected)return;
  const current=activeElement();
  if(current&&current!==previous&&current!==document.body&&current!==document.documentElement&&!(scope instanceof ShadowRoot&&current===scope.host))return;
  if(canFocus(previous))return;
  const replacement=Array.from(root.querySelectorAll<HTMLElement>('button,input,select,summary')).find(el=>focusKey(el)===key&&canFocus(el));
  const target=replacement??fallback(previous);if(target&&canFocus(target))target.focus();
 };
}
export function notify(message:string){document.querySelector('.toast')?.remove();const el=h('div',{class:'toast',role:'status'},message);document.body.append(el);setTimeout(()=>el.remove(),4500);}
export function confirmAction(content:string,accept='确认',signal?:AbortSignal):Promise<boolean>{return new Promise(resolve=>{if(signal?.aborted){resolve(false);return;}let previous=document.activeElement as HTMLElement|null;while(previous?.shadowRoot?.activeElement)previous=previous.shadowRoot.activeElement as HTMLElement;const scope=previous?.getRootNode();const dialog=h('dialog',{class:'sg confirm-dialog','aria-label':'确认操作'},h('h2',null,'确认操作'),h('p',null,content));const theme=previous?.closest<HTMLElement>('[data-theme]')?.dataset.theme??document.documentElement.dataset.theme;if(theme)dialog.dataset.theme=theme;let settled=false;const finish=(result:boolean)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);if(dialog.open)dialog.close();dialog.remove();previous?.focus();resolve(result);};const cancel=()=>finish(false);signal?.addEventListener('abort',cancel,{once:true});dialog.append(h('div',{class:'inline'},button('取消',()=>finish(false),'soft'),button(accept,()=>finish(true),'primary')));dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});(scope instanceof ShadowRoot?scope:document.body).append(dialog);dialog.showModal();});}
