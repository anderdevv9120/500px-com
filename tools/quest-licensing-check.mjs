import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const origin=process.env.SITE_URL || 'http://localhost:5000';
const errors=[],failed=[],report=[];
await fs.mkdir('screenshots',{recursive:true});
try {
  for(const mobile of [false,true]){
    const context=await browser.newContext({viewport:{width:mobile?390:1440,height:900},isMobile:mobile,hasTouch:mobile});
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.url().startsWith(origin)&&r.status()>=400)failed.push(r.url());});
    const visit=async href=>{const r=await page.goto(origin+href,{waitUntil:'networkidle'});assert.equal(r.status(),200,href);};
    await visit('/quests?CONTEST_TYPE=LICENSING');
    const cards=await page.locator('[data-type="LICENSING"] a[aria-label]').evaluateAll(els=>els.map(a=>({href:a.getAttribute('href'),title:a.getAttribute('aria-label'),src:a.closest('[data-quest-card]').querySelector('img').getAttribute('src')})));
    assert.equal(cards.length,20);
    await page.locator('[data-type="LICENSING"] a[aria-label]').first().click();
    await page.waitForURL('**'+cards[0].href);
    assert.equal(await page.locator('body').getAttribute('data-page'),'quest-licensing','Licensing cards must use the Licensing template');
    for(const card of cards){
      await visit(card.href);
      await page.waitForSelector('[data-licensing-quest-title]');
      assert.equal(await page.locator('[data-licensing-quest-title]').innerText(),card.title);
      assert.equal(await page.locator('[data-licensing-quest-hero]').getAttribute('src'),card.src);
      const text=await page.locator('main').innerText();
      assert.match(text,/Juried Contests · Licensing quest/);
      assert.match(text,/Awards/);assert.match(text,/Rules/);assert.match(text,/Schedule/);
      assert.doesNotMatch(text,/Photo Battles|prize pool|Monumental Mountains|Voting|Niushou|Join Now/);
      assert.equal(await page.locator('[data-quest-ended]').innerText(),'Ended');
      const check=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,broken:[...document.images].filter(i=>i.complete&&!i.naturalWidth).map(i=>i.src)}));
      assert.equal(check.scrollWidth,check.width,card.href);assert.deepEqual(check.broken,[],card.href);
      report.push({href:card.href,mobile,...check});
    }
    await visit(cards[0].href);
    assert.match(await page.locator('[data-licensing-award]').innerText(),/\$50 US/);
    assert.match(await page.locator('[data-licensing-schedule]').innerText(),/2026-08-26/);
    await page.getByRole('button',{name:'Share Quest',exact:true}).click();
    assert.equal(await page.locator('#share-url').inputValue(),page.url());await page.keyboard.press('Escape');
    await page.getByRole('tab',{name:'All Entries',exact:true}).click();
    await page.waitForSelector('[data-quest-entries] .local-grid a');
    assert.equal(await page.locator('#licensing-introduction').isVisible(),false);
    await page.getByRole('tab',{name:'All Entries',exact:true}).press('ArrowLeft');
    assert.equal(await page.getByRole('tab',{name:'Introduction',exact:true}).getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#licensing-introduction').isVisible(),true);
    await page.evaluate(()=>{document.activeElement.blur();window.scrollTo({top:0,behavior:'instant'});});
    await page.screenshot({path:`screenshots/quest-licensing-${mobile?'mobile':'desktop'}.png`,fullPage:true});
    await visit(cards[0].href+'/?view=brief');
    assert.equal(await page.locator('[data-licensing-quest-title]').innerText(),cards[0].title);
    await page.reload({waitUntil:'networkidle'});
    assert.equal(await page.locator('[data-quest-ended]').innerText(),'Ended');
    for(const route of ['/quest/0cqon9TXhfJ','/quest/SDjF78KIQrn']){
      await visit(route);assert.notEqual(await page.locator('body').getAttribute('data-page'),'quest-licensing');
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  await fs.writeFile('screenshots/quest-licensing-results.json',JSON.stringify({report,errors,failed},null,2));
  console.log(`Licensing Quest: ${report.length} desktop/mobile route checks; card navigation, own hero/title, ended state, cash awards, schedule, sharing, keyboard tabs, and existing Quest variants passed.`);
} finally {await browser.close();}
