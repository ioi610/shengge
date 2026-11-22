// Starts the packaged runtime with a disposable profile and follows the real home → example flow.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(process.argv[2]),{chromium}=require(require.resolve('playwright-core',{paths:[process.argv[3]]}));
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'shengge-smoke-'));
 const ctx=await chromium.launchPersistentContext(profile,{
  executablePath:path.join(root,'runtime',process.platform==='win32'?'chrome.exe':'chrome'),
  chromiumSandbox:true,headless:false,ignoreDefaultArgs:['--disable-extensions'],
  args:['--load-extension='+path.join(root,'training'),'--no-first-run']
 });
 try{
  const p=ctx.pages()[0];await p.goto(pathToFileURL(path.join(root,'Contents','Resources','ui','training-launch.html')).href+'#home');
  await p.locator('.card').first().click({timeout:30000});await p.locator('[data-mode=shadow]:enabled').click();
  await p.locator('[data-mode=shadow][aria-pressed=true]').waitFor({timeout:20000});
  await p.locator('.records').click();await p.locator('.record-row').first().waitFor();
 }finally{await ctx.close();fs.rmSync(profile,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
