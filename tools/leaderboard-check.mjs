import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {puppeteer}=await import(pathToFileURL(process.env.PUPPETEER_MODULE).href);
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const[width,height,name]of[[1920,900,'desktop'],[390,844,'mobile']]){
    await page.setViewport({width,height});
    await page.goto('http://localhost:5000/leaderboard',{waitUntil:'networkidle0'});
    for(const period of ['weekly','monthly','weekly']){
      await page.evaluate(period=>[...document.querySelectorAll('[role="tab"]')].find(tab=>tab.textContent.trim().toLowerCase()===period).click(),period);
      await page.waitForSelector(`[data-leaderboard-view="${period}"]`);
      await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect.getTiming().iterations)).map(animation=>animation.finished.catch(()=>{})));});
      const actual=await page.evaluate(()=>({
        ranks:[...document.querySelectorAll('[data-leaderboard-rank]')].map(row=>Number(row.dataset.leaderboardRank)),
        first:document.querySelector('article .row-thumb-container')?.getAttribute('aria-label'),
        strip:document.querySelectorAll('section img').length,
        medals:document.querySelectorAll('img[alt^="Top "]').length,
        width:document.documentElement.scrollWidth,
        viewport:document.documentElement.clientWidth,
        broken:[...document.images].filter(img=>img.complete&&!img.naturalWidth).length,
        fakeTable:!!document.querySelector('.local-ranking'),
      }));
      assert.deepEqual(actual.ranks,Array.from({length:50},(_,index)=>index+1));
      assert.equal(actual.first,period==='weekly'?'Welcome to Dystopia':'Le vieux Paris- Palais du Louvre');
      assert.ok(actual.strip>=40);assert.equal(actual.medals,3);assert.equal(actual.fakeTable,false);
      assert.equal(actual.width,actual.viewport);assert.equal(actual.broken,0);
      await page.screenshot({path:`screenshots/leaderboard-${period}-${name}.jpg`,type:'jpeg',quality:80,waitForFonts:false});
      console.log(`${name} ${period}: 50 ranks, correct first photo, strip and medals; no overflow or broken images.`);
    }
  }
  await page.focus('[role="tab"][aria-selected="true"]');
  await page.keyboard.press('ArrowRight');await page.waitForSelector('[data-leaderboard-view="monthly"]');
  assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Monthly');
  await page.keyboard.press('ArrowLeft');await page.waitForSelector('[data-leaderboard-view="weekly"]');
  const like='[data-leaderboard-rank="1"] [data-leaderboard-action="like"]';
  await page.click(like);
  const liked=await page.$eval(like,el=>el.getAttribute('aria-pressed'));
  await page.reload({waitUntil:'networkidle0'});
  assert.equal(await page.$eval(like,el=>el.getAttribute('aria-pressed')),liked);
  await page.click('[data-leaderboard-rank="1"] [data-leaderboard-action="save"]');
  await page.waitForSelector('dialog [data-save]');await page.click('dialog [data-save]');
  await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
  assert.equal(await page.$eval('[data-leaderboard-rank="1"] [data-leaderboard-action="save"]',el=>el.getAttribute('aria-pressed')),'true');
  await page.click('[data-leaderboard-rank="1"] [data-leaderboard-action="more"]');
  await page.waitForSelector('.local-menu');
  await page.evaluate(()=>[...document.querySelectorAll('.local-menu button')].find(button=>button.textContent==='Share').click());
  await page.waitForSelector('#share-url');
  assert.match(await page.$eval('#share-url',el=>el.value),/\/photo\/KM6ftWvgkyb$/);
  assert.deepEqual(errors,[]);
  console.log('Like persistence, saved-gallery state, and photo-specific sharing passed.');
}finally{await browser.close();}
