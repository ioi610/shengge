export type AsrTransport=(action:string,payload?:Record<string,unknown>)=>Promise<any>;
export const extensionAsr:AsrTransport=(action,payload={})=>chrome.runtime.sendMessage({type:'LOCAL_ASR',action,...payload}).then(r=>{if(!r?.ok)throw new Error(r?.error??'扩展识别连接失败，请重新加载声格后重试。');return r.data;});
