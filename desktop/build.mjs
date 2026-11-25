import {desktopVersion,desktopBuild} from './version.mjs';
import {buildTraining} from './build-training.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,copyFile,writeFile,mkdtemp,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const desktop=path.dirname(fileURLToPath(import.meta.url));
const root=path.dirname(desktop);
const release=path.join(root,'release');
await mkdir(release,{recursive:true});
const stage=await mkdtemp(path.join(release,'.desktop-build-'));
const bundle=path.join(stage,'声格.app'),final=path.join(release,'声格.app');
const contents=path.join(bundle,'Contents');
const resources=path.join(contents,'Resources');
const ui=path.join(resources,'ui');
for(const folder of [ui,path.join(contents,'MacOS')])await mkdir(folder,{recursive:true});
await copyFile(path.join(desktop,'training-launch.html'),path.join(ui,'training-launch.html'));
await writeFile(path.join(ui,'index.html'),'<!doctype html><meta charset="utf-8"><title>声格</title>');
await buildTraining(root,contents);
await writeFile(path.join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.shengge.desktop</string><key>CFBundleExecutable</key><string>Shengge</string>
<key>CFBundleName</key><string>声格</string><key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>${desktopBuild}</string><key>CFBundleShortVersionString</key><string>${desktopVersion}</string>
<key>LSMinimumSystemVersion</key><string>13.0</string><key>NSHighResolutionCapable</key><true/><key>LSUIElement</key><true/></dict></plist>`);
execFileSync('xcrun',['clang','-fobjc-arc','-O2','-mmacosx-version-min=13.0','-framework','Cocoa','-framework','WebKit','-framework','UniformTypeIdentifiers',path.join(desktop,'main.m'),'-o',path.join(contents,'MacOS/Shengge')],{stdio:'inherit'});
const identity=process.env.SHENGGE_SIGNING_IDENTITY || '-';
execFileSync('python3',[path.join(desktop,'sign-runtime.py'),path.join(contents,'Helpers','Google Chrome for Testing.app'),identity],{stdio:'inherit'});
execFileSync('codesign',['--force','--sign',identity,...(identity==='-'?[]:['--options','runtime','--timestamp']),bundle],{stdio:'inherit'});
execFileSync('codesign',['--verify','--deep','--strict',bundle]);
const previous=path.join(stage,'previous.app');
let saved=false;
try{await rename(final,previous);saved=true;}catch(e){if(e.code!=='ENOENT')throw e;}
try{await rename(bundle,final);}catch(e){if(saved)await rename(previous,final);throw e;}
await rm(stage,{recursive:true,force:true});
console.log(final);
