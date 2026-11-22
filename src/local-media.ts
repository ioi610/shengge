/** Identity includes content from both ends; the video itself is never persisted. */
export async function localMediaKey(file:File){
 const size=1024*1024;
 const identity=new Blob([JSON.stringify([file.name,file.size,file.lastModified]),file.slice(0,size),file.slice(Math.max(size,file.size-size))]);
 const digest=await crypto.subtle.digest('SHA-256',await identity.arrayBuffer());
 return 'local-file:'+Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
}
export const isLocalMediaKey=(value:unknown):value is string=>typeof value==='string'&&/^local-file:[a-f0-9]{64}$/.test(value);
