import {message} from './domain';
import {button,confirmAction,h,notify,text} from './dom';
import {collectRecordIds,deleteSelectedRecords,type RecordClient} from './record-actions';

export function recordSelectionControls(client:RecordClient,filter:string,signal:AbortSignal,refresh:()=>Promise<void>){
 const selected=new Set<string>();const boxes=new Map<string,HTMLInputElement>();let allIds:string[]|undefined;let busy=false;
 const toggle=h('input',{type:'checkbox','aria-label':filter==='all'?'全选全部学习记录':'全选当前分类的全部记录'});
 const count=text('','muted');
 const remove=button('删除所选',()=>void deleteSelection(),'text danger small',{disabled:true});
 const clear=button('取消选择',()=>{selected.clear();sync();},'text small',{hidden:true});
 const element=h('div',{class:'record-batch',role:'group','aria-label':'批量管理学习记录'},h('label',{class:'record-select-all',title:'选择当前分类的全部记录，包含尚未加载的记录'},toggle,text('全选')),count,clear,remove);
 function sync(){
  for(const [id,box]of boxes){box.checked=selected.has(id);box.disabled=busy;box.closest('article')?.classList.toggle('selected',box.checked);}
  toggle.checked=Boolean(allIds?.length)&&allIds!.every(id=>selected.has(id));toggle.indeterminate=selected.size>0&&!toggle.checked;toggle.disabled=busy||!boxes.size;
  count.textContent=selected.size?`已选 ${selected.size} 条`:'';clear.hidden=!selected.size;clear.disabled=busy;remove.disabled=!selected.size||busy;element.dataset.recordBusy=String(busy);element.dataset.recordSelection=String(selected.size>0);element.setAttribute('aria-busy',String(busy));
 }
 toggle.addEventListener('change',()=>void (async()=>{
  if(!toggle.checked){selected.clear();sync();return;}
  busy=true;sync();
  try{const ids=await collectRecordIds(client,filter,signal);if(signal.aborted)return;allIds=ids;selected.clear();for(const id of ids)selected.add(id);}
  catch(error){if(!signal.aborted)notify(message(error));}
  finally{busy=false;sync();}
 })());
 async function deleteSelection(){
  if(busy||!selected.size)return;
  const ids=[...selected];busy=true;sync();
  try{
   if(!await confirmAction(`删除选中的 ${ids.length} 条记录及其学习进度？此操作无法撤销。`,'删除所选',signal))return;
   const result=await deleteSelectedRecords(client,ids);
   for(const id of result.deleted)selected.delete(id);
   if(result.failed.length)notify(`已删除 ${result.deleted.length} 条，剩余 ${ids.length-result.deleted.length} 条未删除。${message(result.failed[0].error)}`);
   else notify(`已删除 ${result.deleted.length} 条记录。`);
   if(!signal.aborted)await refresh();
  }finally{busy=false;sync();}
 }
 sync();
 return {element,checkbox(id:string,name:string){
  const box=h('input',{type:'checkbox',class:'record-select','aria-label':`选择记录：${name}`,checked:selected.has(id)});
  boxes.set(id,box);box.addEventListener('change',()=>{if(box.checked)selected.add(id);else selected.delete(id);sync();});sync();return box;
 }};
}
