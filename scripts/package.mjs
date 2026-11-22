import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {zipSync} from 'fflate';
const {version}=JSON.parse(await readFile('package.json','utf8'));const entries={};let unpackedBytes=0;
async function collect(folder,prefix){for(const entry of await readdir(folder,{withFileTypes:true})){const path=folder+'/'+entry.name,name=prefix+'/'+entry.name;if(entry.isDirectory())await collect(path,name);else if(entry.isFile()){const data=await readFile(path);entries[name]=[data,{level:9}];unpackedBytes+=data.length;}}}
await collect('dist/extension','extension');await mkdir('release',{recursive:true});const path=`release/声格-扩展-${version}.zip`;const zip=zipSync(entries);await writeFile(path,zip);
const report={version,extension:{path,downloadBytes:zip.length,unpackedBytes},recognition:{location:'extension WebGPU worker',firstUseModelBytes:190085487,model:'Whisper small q5_1',sha256:'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',separateInstall:false,nodeRequired:false}};
await writeFile('release/size-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
