import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,mkdtemp,rename,rm,copyFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

const version='158.0.8127.36';
const digest='b86d3b393def1f87d369b022abff0a51acb015d6fcb79ddfd1c379c9d72fbbe2';
const name='Google Chrome for Testing.app';
async function valid(archive,expected=digest){
 try{
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(archive))hash.update(chunk);
  return hash.digest('hex')===expected;
 }catch(error){if(error.code==='ENOENT')return false;throw error;}
}
export async function buildTraining(root,contents){
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('此桌面运行时需要 Apple 芯片 Mac。');
 const cache=path.join(homedir(),'Library/Caches/Shengge/build',version);
 await mkdir(cache,{recursive:true});
 const archive=path.join(cache,'chrome.zip');
 if(!await valid(archive)){
  const tmp=await mkdtemp(path.join(cache,'download-'));
  try{
   const download=path.join(tmp,'chrome.zip');
   execFileSync('curl',['--fail','--location','--retry','2','--output',download,'https://storage.googleapis.com/chrome-for-testing-public/'+version+'/mac-arm64/chrome-mac-arm64.zip'],{stdio:'inherit'});
   if(!await valid(download))throw Error('Chrome 运行时校验失败');
   await rename(download,archive);
  }finally{await rm(tmp,{recursive:true,force:true});}
 }
 const helpers=path.join(contents,'Helpers');
 await mkdir(helpers,{recursive:true});
 const tmp=await mkdtemp(path.join(cache,'extract-'));
 try{
  execFileSync('ditto',['-x','-k',archive,tmp]);
  const distribution=path.join(tmp,'chrome-mac-arm64');
  execFileSync('ditto',[path.join(distribution,name),path.join(helpers,name)]);
  await copyFile(path.join(distribution,'ABOUT'),path.join(contents,'Resources','Chrome-ABOUT'));
 }finally{await rm(tmp,{recursive:true,force:true});}
 execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root,env:{...process.env,SHENGGE_OUTPUT:'dist/desktop-training'},stdio:'inherit'});
 const training=path.join(contents,'Resources/training');
 execFileSync('ditto',[path.join(root,'dist/desktop-training'),training]);
 const modelDigest='ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb';
 const model=process.env.SHENGGE_MODEL_PATH || path.join(cache,'ggml-small-q5_1.bin');
 if(!await valid(model,modelDigest)){
  if(process.env.SHENGGE_MODEL_PATH)throw Error('指定的离线语音模型校验失败');
  const temp=await mkdtemp(path.join(cache,'model-'));
  try{
   const file=path.join(temp,'model.bin');
   execFileSync('curl',['--fail','--location','--retry','2','--output',file,'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q5_1.bin'],{stdio:'inherit'});
   if(!await valid(file,modelDigest))throw Error('下载的语音模型校验失败');
   await rename(file,model);
  }finally{await rm(temp,{recursive:true,force:true});}
 }
 await copyFile(model,path.join(training,'asr/ggml-small-q5_1.bin'));
}
