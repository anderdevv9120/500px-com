import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const {default:{chromium}} = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true});
const origin = process.env.SITE_URL || 'http://127.0.0.1:5000';
const media = Array.from({length:12}, (_, index) => ({id:String(index), kind:index === 1 ? 'video' : 'image', url:origin+`/layout-fixture/${index}.svg`, title:`Item ${index+1}`, author:'Guest'}));
const album = {id:'layout-check', title:'Mixed proportions', description:'', media};
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/layout-fixture/*.svg', route => {
    const index = Number(new URL(route.request().url()).pathname.split('/').pop().split('.')[0]);
    const [width, height] = [[200,500], [400,200], [300,300]][index%3];
    return route.fulfill({contentType:'image/svg+xml', body:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${['#385b64','#8d623a','#566b48'][index%3]}"/><text x="20" y="50" fill="white" font-size="24">Item ${index+1}</text></svg>`});
  });
  await page.route('**/api/albums**', route => route.fulfill({json:route.request().url().endsWith('/layout-check') ? album : []}));
  await page.route('**/api/media?*', route => route.fulfill({json:media}));
  for (const width of [1920,1280,1024,768,390]) {
    await page.setViewportSize({width, height:1000});
    for (const route of ['/galleries/guest?album=layout-check', '/p/guest?view=works']) {
      await page.goto(origin+route, {waitUntil:'networkidle'});
      if (route.includes('/p/guest')) await page.getByRole('tab', {name:/Works/}).click();
      await page.locator('.gallery-photo').last().waitFor();
      await page.locator('.gallery-photo img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.locator('.gallery-photos').evaluate(grid => ({
        width:grid.clientWidth,
        right:grid.getBoundingClientRect().right,
        bottom:grid.getBoundingClientRect().bottom,
        items:[...grid.children].map(item => item.getBoundingClientRect().toJSON()),
        overflow:document.documentElement.scrollWidth > innerWidth
      }));
      const label = `${route} at ${width}px`;
      const columns = layout.width<650 ? 2 : layout.width<1000 ? 3 : layout.width<1450 ? 4 : 5;
      const gap = layout.width<650 ? 8 : 24;
      assert.equal(layout.items.length, 12, label);
      const firstRow = layout.items.slice(0, columns);
      assert.ok(firstRow.every(item => Math.abs(item.top-firstRow[0].top)<1), `${label}: fill the first row before wrapping`);
      assert.ok(Math.abs(firstRow.at(-1).right-layout.right)<1, `${label}: use the full row width`);
      assert.ok(layout.items[columns].top<firstRow[0].bottom, `${label}: shorter columns fill before the portrait ends`);
      for (const item of firstRow) {
        const column = layout.items.filter(other => Math.abs(other.left-item.left)<1);
        for (let index=1; index<column.length; index++) assert.ok(Math.abs(column[index].top-column[index-1].bottom-gap)<1, `${label}: no gaps or overlaps within a column`);
      }
      assert.ok(layout.items.every(item => item.bottom<=layout.bottom+1), `${label}: container encloses every caption`);
      assert.equal(layout.overflow, false, `${label}: no horizontal overflow`);
      if (route.includes('/p/guest') && width===1920) {
        await page.getByRole('button', {name:'Fewer columns', exact:true}).click();
        const largeColumns = await page.locator('.gallery-photo').evaluateAll(items => new Set(items.map(item => item.offsetLeft)).size);
        assert.equal(largeColumns, 3, 'Large grid uses the homepage column count');
        await page.getByRole('button', {name:'More columns', exact:true}).click();
        await page.setViewportSize({width:390, height:1000});
        await page.waitForFunction(() => new Set([...document.querySelectorAll('.gallery-photo')].map(item => item.offsetLeft)).size===2);
        await page.setViewportSize({width, height:1000});
        await page.waitForFunction(() => new Set([...document.querySelectorAll('.gallery-photo')].map(item => item.offsetLeft)).size===5);
      }
      if (width === 1920 || width === 390) await page.screenshot({path:`screenshots/guest-layout-${route.includes('/galleries/')?'album':'works'}-${width}.png`, fullPage:true});
    }
  }
  for (const width of [1920,390]) {
    await page.setViewportSize({width, height:1000});
    await page.goto(origin+'/discover', {waitUntil:'networkidle'});
    const grid = page.locator('[data-masonry-grid]').first();
    const items = await grid.locator(':scope > [data-masonry-item]').evaluateAll(items => items.map(item => item.getBoundingClientRect().toJSON()));
    assert.ok(items.length>5 && items.every(item => item.width>0 && item.height>0), 'Homepage photos retain visible dimensions');
    assert.equal(new Set(items.map(item => item.left)).size, width===1920 ? 5 : 2, 'Homepage column counts remain unchanged');
  }
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('Guest masonry passed: mixed portrait, landscape, square and video items, no column gaps or overlaps, album and Works at five viewport sizes.');
} finally {
  await browser.close();
}
