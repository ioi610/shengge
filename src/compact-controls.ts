import {button,h} from './dom';
const paths={volume:'M3 9h4l5-4v14l-5-4H3zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14',settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0',quality:'M3 5h18v14H3zM6 9v6M10 9v6M6 12h4M14 9v6h2l2-2v-2l-2-2z',siteCaptions:'M3 4h18v14H9l-4 3v-3H3zM6 9h3M12 9h6M6 13h6M15 13h3',episodes:'M3 5h3M9 5h12M3 12h3M9 12h12M3 19h3M9 19h12',wide:'M3 6h18v12H3z',pip:'M3 5h18v14H3zM12 11h7v6h-7z',webscreen:'M3 4h18v16H3zM3 8h18',fullscreen:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',palette:'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h4a5 5 0 0 0 0-10zM7 9h.01M10 6h.01M15 6h.01',play:'M9 5l11 7-11 7z',pause:'M6 5h4v14H6zM14 5h4v14h-4z',previous:'M6 5v14M18 5l-9 7 9 7z',next:'M18 5v14M6 5l9 7-9 7z',replay:'M18 8a7 7 0 1 0 1 8M18 3v5h-5',complete:'M4 12l5 5L20 6',extra:'M12 3a9 9 0 1 1-7.8 4.5M3 3v5h5',skip:'M5 5l10 7-10 7zM19 5v14',reset:'M4 9a8 8 0 1 1 0 6M4 3v6h6',captions:'M3 5h18v14H3zM10 9H7v6h3M17 9h-3v6h3',close:'M6 6l12 12M18 6L6 18'} as const;
export function compactButton(name:keyof typeof paths,label:string,action:()=>void,attrs:Record<string,any>={}){
 const control=button('',action,'compact-icon',{'aria-label':label,'data-tooltip':label,'data-icon':name,...attrs});
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
 const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]);svg.append(path);control.append(svg);
 if(name==='extra')control.append(h('span',{class:'icon-five','aria-hidden':'true'},'5'));
 return control;
}
