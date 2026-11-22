import {AppError} from './domain';

export type RecordClient={call:(type:string,payload?:Record<string,any>,clipId?:string)=>Promise<any>};

/** Snapshot every matching ID, including pages the UI has not loaded yet. */
export async function collectRecordIds(client:RecordClient,filter:string,signal:AbortSignal):Promise<string[]>{
 const ids=new Set<string>();const cursors=new Set<string>();let cursor=null;
 do{
  if(signal.aborted)throw new AppError('OPERATION_CANCELLED');
  const page=await client.call('LIST_RECORDS',{filter,limit:50,cursor});
  if(signal.aborted)throw new AppError('OPERATION_CANCELLED');
  for(const clip of page.clips)ids.add(clip.id);
  if(!page.hasMore)break;
  const key=JSON.stringify(page.nextCursor);
  if(!page.nextCursor||cursors.has(key))throw new AppError('INVALID_REQUEST');
  cursors.add(key);cursor=page.nextCursor;
 }while(true);
 return [...ids];
}

/** Use existing per-record deletion so leases and delayed writes stay invalidated. */
export async function deleteSelectedRecords(client:RecordClient,ids:Iterable<string>){
 const deleted:string[]=[];const failed:{id:string;error:unknown}[]=[];
 for(const id of new Set(ids)){
  try{await client.call('DELETE_RECORD',{},id);deleted.push(id);}
  catch(error){failed.push({id,error});break;}
 }
 return {deleted,failed};
}
