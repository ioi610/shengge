const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const [executablePath, extension, dependencies] = process.argv.slice(2);
const {chromium} = require(require.resolve('playwright-core', {paths: [dependencies]}));

async function check() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shengge-extension-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath, chromiumSandbox: true, headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--load-extension=' + extension, '--no-first-run'],
  });
  try {
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    assert.equal(new URL(worker.url()).hostname, 'clmdeglkjmdcjhlhemjglfhaefehclkg');
    assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().version), require('../package.json').version);
    const page = ctx.pages()[0];
    await page.goto(new URL('index.html', worker.url()).href);
    await page.locator('body').waitFor();
    assert.ok((await page.locator('body').innerText()).trim());
  } finally {
    await ctx.close();
    fs.rmSync(profile, {recursive: true, force: true});
  }
}
check().catch(error => { console.error(error); process.exitCode = 1; });
