import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const {chromium} = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true});
const origin = process.env.SITE_URL || 'http://127.0.0.1:5000';
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/albums**', route => route.fulfill({json:[]}));
  await page.route('**/api/media?*', route => route.fulfill({json:[]}));
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    await page.goto(origin+'/p/guest?view=galleries&source=check#uploads', {waitUntil:'networkidle'});
    for (const [name,view] of [['Works','works'],['Galleries','galleries']]) {
      const tab = page.getByRole('tab', {name,exact:true});
      await tab.click();
      await page.waitForLoadState('networkidle');
      assert.equal(new URL(page.url()).searchParams.get('view'), view, `${width}px: clicking ${name} updates view`);
      assert.equal(new URL(page.url()).searchParams.get('source'), 'check', 'Preserve other query parameters');
      assert.equal(new URL(page.url()).hash, '#uploads', 'Preserve the fragment');
      await page.reload({waitUntil:'networkidle'});
      assert.equal(await tab.getAttribute('aria-selected'), 'true', `${width}px: reload restores ${name}`);
      assert.equal(await page.locator('.local-profile-panel').isVisible(), true);
    }
    await page.goto(origin+'/p/guest', {waitUntil:'networkidle'});
    assert.equal(await page.getByRole('tab', {name:'Galleries',exact:true}).getAttribute('aria-selected'), 'true', 'Galleries remains the default');
  }
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('Guest tabs passed: URL updates, query/fragment preservation, reload and default view at desktop/mobile widths.');
} finally {
  await browser.close();
}
