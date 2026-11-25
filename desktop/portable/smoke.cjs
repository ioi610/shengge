// Exercise the player resources from an installed package in a disposable browser profile.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const root = path.resolve(process.argv[2]);
const {chromium} = require(require.resolve('playwright-core', {paths: [process.argv[3]]}));
const resources = path.join(root, 'Contents', 'Resources');
const training = path.join(process.platform === 'darwin' ? resources : root, 'training');
const executablePath = process.argv[4] || path.join(root, 'runtime', process.platform === 'win32' ? 'chrome.exe' : 'chrome');

async function check() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shengge-smoke-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath, chromiumSandbox: true, headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--load-extension=' + training, '--no-first-run'],
  });
  try {
    const page = ctx.pages()[0];
    await page.goto(pathToFileURL(path.join(resources, 'ui', 'training-launch.html')).href + '#home');
    await page.locator('.card').first().click();
    for (const mode of ['shadow', 'cue']) {
      await page.locator(`[data-mode=${mode}]:enabled`).click();
      await page.locator(`[data-mode=${mode}][aria-pressed=true]`).waitFor();
    }
    await page.locator('.records').click();
    await page.locator('.record-row').first().waitFor();
  } finally {
    await ctx.close();
    fs.rmSync(profile, {recursive: true, force: true, maxRetries: 4});
  }
}

check().catch(error => { console.error(error); process.exitCode = 1; });
