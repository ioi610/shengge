import {RECOGNITION_MODEL} from './recognition-model';
/** Opening a video may warm an existing model, but never starts its first download. */
export async function warmCachedRecognition(prepare:()=>unknown,storage:CacheStorage=caches){
 if(!await storage.has(RECOGNITION_MODEL.cache))return {warming:false};
 const cache=await storage.open(RECOGNITION_MODEL.cache);
 if(!await cache.match(RECOGNITION_MODEL.url))return {warming:false};
 return prepare();
}
