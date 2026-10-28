import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Development-only browser dependency, supplied externally like the other checks.
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const origin=process.env.SITE_URL || 'http://localhost:5000';
const errors=[];
const report=[];
await fs.mkdir('screenshots',{recursive:true});
try {
  const page=await browser.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  const visit=async route=>{
    const response=await page.goto(origin+route,{waitUntil:'networkidle'});
    assert.equal(response.status(),200,route);
  };
  for(const mobile of [false,true]) {
    await page.setViewportSize({width:mobile?390:1440,height:900});
    await visit('/p/MarcoGrassi');
    await page.getByRole('tab',{name:'Galleries(6)',exact:true}).click();
    await page.locator('.local-collection-card').first().click();
    await page.waitForURL('**/galleries/0?**');
    await page.waitForSelector('[data-gallery] h1');
    assert.equal(await page.locator('[data-gallery] h1').innerText(),'Landscapes');
    assert.equal(await page.locator('[data-gallery-owner]').innerText(),'Marco Grassi');
    assert.equal(await page.locator('dialog[open]').count(),0);
    await page.locator('[data-follow-owner]').click();
    const following=await page.locator('[data-follow-owner]').getAttribute('aria-pressed');
    await page.reload({waitUntil:'networkidle'});
    assert.equal(await page.locator('[data-follow-owner]').getAttribute('aria-pressed'),following);
    await page.getByRole('button',{name:'Share gallery',exact:true}).click();
    assert.equal(await page.locator('#share-url').inputValue(),page.url());
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Start slideshow',exact:true}).click();
    await page.waitForSelector('.local-lightbox img');
    const first=await page.locator('.local-lightbox img').getAttribute('src');
    await page.getByRole('button',{name:'Next photo',exact:true}).click();
    assert.notEqual(await page.locator('.local-lightbox img').getAttribute('src'),first);
    await page.keyboard.press('Escape');
    await page.locator('[data-gallery-back]').click();
    await page.waitForSelector('.local-collection-card');
    assert.match(await page.getByRole('tab',{name:'Galleries(6)',exact:true}).getAttribute('aria-selected'),/true/);

    await visit('/grants');
    const collections=await page.locator('a[href^="/gallery/"]').evaluateAll(links=>links.map(a=>({href:a.getAttribute('href'),target:a.getAttribute('target')})));
    assert.equal(collections.length,5);
    assert.ok(collections.every(link=>!link.target),'Collections stay in this tab');
    await page.locator('a[href^="/gallery/"]').first().click();
    await page.waitForURL('**'+collections[0].href);
    const profileRoutes=[{href:'/galleries/0'}];
    for(const [owner,count] of [['MarcoGrassi',6],['paweluchorczak',2]]){
      await visit(`/p/${owner}?view=galleries`);
      await page.waitForSelector('.local-collection-card');
      assert.equal(await page.locator('.local-collection-card').count(),count);
      profileRoutes.push(...await page.locator('.local-collection-card').evaluateAll(links=>links.map(a=>({href:a.getAttribute('href')}))));
    }
    for(const {href} of [...profileRoutes,...collections]) {
      await visit(href);
      await page.waitForSelector('[data-gallery-photo] img');
      const check=await page.evaluate(()=>({title:document.querySelector('[data-gallery] h1').textContent,owner:document.querySelector('[data-gallery-owner]').textContent,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,photos:document.querySelectorAll('[data-gallery-photo]').length,broken:[...document.images].filter(i=>i.complete&&!i.naturalWidth).map(i=>i.src)}));
      assert.equal(check.scrollWidth,check.width,href);
      assert.deepEqual(check.broken,[],href);
      assert.ok(check.photos>=2,href);
      assert.equal(await page.locator('.gallery-count').innerText(),`${check.photos} photos`);
      report.push({href,mobile,...check});
      if(href==='/galleries/0'||href===collections[0].href)await page.screenshot({path:`screenshots/gallery-${href==='/galleries/0'?'profile':'grant'}-${mobile?'mobile':'desktop'}.png`,fullPage:true});
    }
    await page.locator('[data-gallery-photo]').first().click();
    await page.waitForSelector('.local-lightbox img');
    assert.match(await page.locator('.lightbox-caption').innerText(),/Renat Renee-Ell/);
    await page.keyboard.press('Escape');
    await visit('/galleries/99');
    await page.waitForSelector('[data-gallery] h1');
    assert.equal(await page.locator('[data-gallery] h1').innerText(),'Gallery not found');
    assert.equal(await page.locator('[data-gallery-photo]').count(),0);
    await visit('/galleries/0?owner=__proto__');
    await page.waitForSelector('[data-gallery] h1');
    assert.equal(await page.locator('[data-gallery] h1').innerText(),'Gallery not found');
  }
  assert.deepEqual(errors,[],'No uncaught browser errors');
  await fs.writeFile('screenshots/gallery-results.json',JSON.stringify({report,errors},null,2));
  console.log(`Gallery checks passed: ${report.length} route/viewport checks, profile navigation and reload, Grant links, sharing, slideshow, photo credits, back links, and missing gallery.`);
} finally {await browser.close();}
