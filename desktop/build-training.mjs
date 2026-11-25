import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,mkdtemp,rename,rm,copyFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

const version='158.0.8127.36';
async function valid(archive,expected){
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
 const image=path.join(homedir(),'Library/Caches/Shengge/build/brave/1.100.59/Brave.dmg');
 execFileSync('python3',[path.join(root,'desktop/mac-source/runtime.py'),image,path.join(contents,'Helpers')],{stdio:'inherit'});
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
