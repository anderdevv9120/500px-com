import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const {default: playwright} = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await playwright.chromium.launch({executablePath:process.env.CHROME_PATH, headless:true});
const origin = process.env.SITE_URL || 'http://127.0.0.1:5000';
const media = {id:'clip', kind:'video', url:origin+'/assets/0010-0.jpg', title:'Clip', author:'Guest'};
const album = {id:'play-check', title:'Video album', description:'', cover:media, media:[media]};
try {
  const page = await browser.newPage();
  await page.route('**/api/albums**', route => route.fulfill({json:route.request().url().endsWith('/play-check') ? album : [album]}));
  await page.route('**/api/media?*', route => route.fulfill({json:[media]}));
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height:900});
    for (const route of ['/p/guest?view=galleries', '/galleries/guest?album=play-check', '/p/guest?view=works']) {
      await page.goto(origin+route, {waitUntil:'networkidle'});
      if (route.endsWith('view=works')) await page.getByRole('tab', {name:/Works/}).click();
      const card = page.locator(route.includes('/galleries/') ? '.gallery-photo' : route.endsWith('view=works') ? '.gallery-photo' : '.local-collection-card').first();
      await card.waitFor();
      assert.equal(await card.locator('.gallery-play-badge svg').count(), 1, `${route}: use a vector play icon`);
      assert.equal(await card.locator('.gallery-play-badge').getAttribute('aria-hidden'), 'true');
      const badge = await card.locator('.gallery-play-badge').boundingBox();
      const video = await card.locator('video').boundingBox();
      assert.ok(Math.abs(badge.x+badge.width/2-video.x-video.width/2)<1, `${route}: horizontally centered`);
      assert.ok(Math.abs(badge.y+badge.height/2-video.y-video.height/2)<1, `${route}: vertically centered`);
      await card.screenshot({path:`screenshots/guest-play-${width}-${route.includes('/galleries/')?'album':route.endsWith('view=works')?'works':'profile'}.png`});
      if (route.includes('/galleries/')) {
        await card.locator('button').click();
        await page.locator('.local-lightbox video[controls]').waitFor();
      } else if (route.includes('view=galleries')) {
        assert.equal(await card.getAttribute('href'), '/galleries/guest?album=play-check');
      }
    }
  }
  console.log('Guest video play icons: desktop/mobile, album/profile/works, navigation and lightbox passed.');
} finally {
  await browser.close();
}
