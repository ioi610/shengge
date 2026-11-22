import {copyVadAssets} from './vad-assets.mjs';
import {build} from 'esbuild';
import {mkdir,cp,writeFile,readFile,rename,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const {version}=JSON.parse(await readFile('package.json','utf8'));
const {key}=JSON.parse(await readFile('extension-key.json','utf8'));
const extensionId=Array.from(createHash('sha256').update(Buffer.from(key,'base64')).digest().subarray(0,16)).flatMap(b=>[b>>4,b&15]).map(n=>String.fromCharCode(97+n)).join('');
const plugin={name:'extension-id',setup(b){b.onLoad({filter:/config\.ts$/},async(args)=>({contents:(await readFile(args.path,'utf8')).replace('__EXTENSION_ID__',extensionId).replace('__BUILD_VERSION__',version),loader:'ts'}));}};
const output=process.env.SHENGGE_OUTPUT??'dist/extension';
if(!/^dist\/[a-z][a-z0-9-]*$/.test(output))throw new Error('Invalid build output');
const desktopTraining=output==='dist/desktop-training';
const common={define:{__SHENGGE_DESKTOP__:String(desktopTraining),__SHENGGE_QA__:process.env.SHENGGE_QA==='1'?'true':'false'},bundle:true,minify:true,sourcemap:false,target:'chrome120',plugins:[plugin],legalComments:'external',metafile:true};
await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
await cp('public',output,{recursive:true});
const graphs={};
for(const [entry,format]of [['app','iife'],['background','esm'],['content','iife'],['recognition-offscreen','esm'],['recognition-worker','esm'],['turn-worker','esm']]){const result=await build({...common,entryPoints:[desktopTraining&&entry==='background'?'desktop/training-background.ts':desktopTraining&&entry==='content'?'desktop/training-ready.ts':`src/${entry}.ts`],outfile:`${output}/${entry}.js`,format,loader:{'.css':'text'}});graphs[entry]=result.metafile;}
await build({entryPoints:['src/style.css'],outfile:output+'/app.css',minify:true});
await copyVadAssets(output);
await cp('assets/recognition',output+'/asr',{recursive:true});
await writeFile(output+'/manifest.json',JSON.stringify({manifest_version:3,name:'声格 · 多语言影视对话学习',version,description:'YouTube、B站按原片顺序边播边识别，遇到对白按句复读，无对白片段正常播放。识别在扩展内完成，学习记录自动保存。',minimum_chrome_version:'137',key,permissions:['activeTab','scripting','offscreen','unlimitedStorage'],cross_origin_embedder_policy:{value:'require-corp'},cross_origin_opener_policy:{value:'same-origin'},icons:{16:'icons/icon-16.png',48:'icons/icon-48.png',128:'icons/icon-128.png'},action:{default_title:'声格 · 练这一段',default_icon:{16:'icons/icon-16.png',32:'icons/icon-32.png'}},background:{service_worker:'background.js',type:'module'},web_accessible_resources:[{resources:['vad/*'],matches:['https://www.youtube.com/*','https://youtube.com/*','https://m.youtube.com/*','https://www.bilibili.com/*','https://bilibili.com/*','https://m.bilibili.com/*']}],content_security_policy:{extension_pages:"script-src 'self' 'wasm-unsafe-eval'; object-src 'none'"}},null,2)+'\n');
if(desktopTraining){
 const file=output+'/manifest.json';const manifest=JSON.parse(await readFile(file,'utf8'));
 const {desktopBuild}=await import('../desktop/version.mjs');
 manifest.version=version+'.'+desktopBuild;
 // Chromium can keep an unpacked extension's registered worker across app upgrades.
 const workerHash=createHash('sha256').update(await readFile(output+'/background.js')).digest('hex').slice(0,16);
 manifest.background.service_worker='desktop-worker-'+workerHash+'.js';
 await rename(output+'/background.js',output+'/'+manifest.background.service_worker);
 manifest.permissions.push('tabs','storage','clipboardRead');
 manifest.host_permissions=manifest.web_accessible_resources[0].matches;
 manifest.content_scripts=[{matches:manifest.host_permissions,js:['content.js'],run_at:'document_start'}];
 await writeFile(file,JSON.stringify(manifest,null,2));
 await build({...common,entryPoints:['desktop/home.ts'],outfile:output+'/home.js'});
 await build({...common,entryPoints:['desktop/training-demo.ts'],outfile:output+'/practice.js',loader:{'.css':'text'}});
 for(const [source,name] of [['desktop/home.html','home.html'],['desktop/desktop.css','desktop.css'],['public/favicon.svg','brand.svg'],['tests/fixtures/media/cafe.jpg','cafe.jpg'],['desktop/training-demo.html','practice.html'],['desktop/training-demo.css','practice.css'],['tests/fixtures/media/cafe.mp4','cafe.mp4']])await cp(source,output+'/'+name);
}
if(!desktopTraining)await writeFile('dist/build-info.json',JSON.stringify({name:'声格',version,builtAt:new Date().toISOString(),extensionId,protocolVersion:1,schemaVersion:3,product:'Chrome extension',recognition:'extension worker: Whisper small q5_1, DTW, WebGPU; model downloaded on first use'},null,2));
if(!desktopTraining)await writeFile('dist/bundle-analysis.json',JSON.stringify(graphs));
console.log(`扩展构建完成：${version}，ID 保持 ${extensionId}，输出 ${output}`);
