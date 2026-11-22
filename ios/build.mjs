import {build} from 'esbuild';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
const dir='ios/Resources';await mkdir(dir,{recursive:true});
for(const [entry,file] of [['desktop/media.ts','media'],['ios/shared.ts','shared']])
 await build({entryPoints:[entry],outfile:dir+'/'+file+'.js',bundle:true,minify:true,target:'safari16',format:'iife',define:{__SHENGGE_DESKTOP__:'false'}});
await copyFile('tests/fixtures/media/cafe.mp4',dir+'/cafe.mp4');
await writeFile(dir+'/demo.html','<!doctype html><meta name="viewport" content="width=device-width"><title>駅前のカフェ</title><body style="margin:0;background:black"><video style="width:100%" controls playsinline preload="auto" src="cafe.mp4"></video></body>');
