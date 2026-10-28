import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const {puppeteer}=await import(pathToFileURL(process.env.PUPPETEER_MODULE).href);
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,defaultViewport:{width:1920,height:900}});
await fs.mkdir('screenshots',{recursive:true});
const report=[];
try {
  const page=await browser.newPage();
  const errors=[],failed=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)failed.push(response.url());});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  const visit=async(query='')=>{
    await page.goto('http://localhost:5000/quests'+query,{waitUntil:'networkidle0'});
    await page.evaluate(()=>document.fonts.ready);
  };
  const titles=()=>page.$$eval('[data-quest-card]:not([hidden]) a',links=>links.map(link=>link.getAttribute('aria-label')));
  const filter=async type=>{
    await page.evaluate(type=>document.querySelector('[data-quest-filter="'+type+'"]').click(),type);
  };
  const open=async()=>{
    await page.evaluate(()=>document.querySelector('[data-quest-sort-trigger]').click());
    await page.waitForSelector('dialog[open] [data-quest-confirm]');
  };
  const screenshot=async name=>page.screenshot({path:'screenshots/quests-'+name+'.png'});
  await visit();
  assert.equal((await titles()).length,60);
  assert.equal((await titles())[0],'Through Light and Shadow, Niushou Embraces the World');
  await screenshot('desktop-hero');
  await page.evaluate(()=>document.querySelector('[data-quests-section-title]').scrollIntoView());
  const grid=await page.$eval('.local-quest-grid',el=>({width:el.clientWidth,card:el.firstElementChild.clientWidth,columns:getComputedStyle(el).gridTemplateColumns.split(' ').length}));
  assert.equal(grid.width,1600);assert.equal(grid.card,382);assert.equal(grid.columns,4);
  await screenshot('desktop-grid');
  await filter('Juried');assert.equal((await titles()).length,2);
  await filter('Battles');await filter('Free');
  assert.ok((await titles()).includes('Shot of the Week #43'));
  assert.ok(!(await titles()).includes('Less is More'));
  const freeCount=(await titles()).length;
  await page.reload({waitUntil:'networkidle0'});assert.equal((await titles()).length,freeCount);
  await filter('All');assert.equal((await titles()).length,60);
  await filter('Licensing');assert.equal((await titles()).length,20);assert.equal((await titles())[0],'After Hours');
  await filter('All');
  await open();await screenshot('desktop-filters');
  await page.click('input[name="DIFFICULTY"][value="A"]');
  await page.keyboard.press('Escape');assert.equal((await titles()).length,60);
  await open();assert.equal(await page.$eval('input[name="DIFFICULTY"][value="A"]',e=>e.checked),false);
  await page.click('input[name="DIFFICULTY"][value="A"]');
  await page.click('input[name="IS_FREE"][value="false"]');
  await page.click('input[name="QUEST_STATUS"][value="VOTING+AWAITING"]');
  await page.click('[data-quest-confirm]');
  assert.deepEqual((await titles()).sort(),['Low Light Photography','Spectrum: Orange'].sort());
  await open();await page.click('[data-quest-clear]');await page.click('[data-quest-confirm]');
  await open();await page.click('input[name="CATEGORY"][value="NATURE"]');await page.click('input[name="DIFFICULTY"][value="C"]');await page.click('[data-quest-confirm]');
  assert.ok((await titles()).includes('Animal Portraits'));assert.ok(!(await titles()).includes('Monumental Mountains'));
  await page.reload({waitUntil:'networkidle0'});assert.ok((await titles()).includes('Animal Portraits'));
  await open();await page.click('[data-quest-clear]');await page.click('[data-quest-confirm]');
  for(const sort of ['SUBMIT_START_DESC','ENDING_SOON','TOTAL_ITEMS_DESC','DEFAULT']){
    await open();await page.click('[data-quest-sort="'+sort+'"]');await page.click('[data-quest-confirm]');
    assert.equal(new URL(page.url()).searchParams.get('SORT'),sort);
    const before=await titles();await page.reload({waitUntil:'networkidle0'});assert.deepEqual(await titles(),before);
    if(sort==='ENDING_SOON')assert.equal(before[0],'Color Toning');
    if(sort==='TOTAL_ITEMS_DESC')assert.notEqual(before[0],'Through Light and Shadow, Niushou Embraces the World');
    if(sort==='DEFAULT')assert.equal(before[0],'Through Light and Shadow, Niushou Embraces the World');
  }
  await open();await page.click('input[name="QUEST_STATUS"][value="PUBLISHED"]');await page.click('[data-quest-confirm]');
  assert.equal((await titles()).length,0);assert.equal(await page.$eval('.local-quest-empty',e=>e.hidden),false);
  await filter('All');
  await page.evaluate(()=>document.querySelector('[data-quest-dot="1"]').click());
  assert.equal(await page.$eval('[data-quest-slide="1"]',e=>e.getAttribute('aria-hidden')),'false');
  await page.evaluate(()=>document.querySelector('[data-quest-previous]').click());
  assert.equal(await page.$eval('[data-quest-slide="0"]',e=>e.inert),false);
  for(const width of [1440,1024,768,390,320]){
    await page.setViewport({width,height:900});await visit();
    const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,columns:getComputedStyle(document.querySelector('.local-quest-grid')).gridTemplateColumns.split(' ').length,card:document.querySelector('[data-quest-card]').clientWidth}));
    assert.equal(layout.scroll,width);assert.ok(layout.card>150);report.push(layout);
    if(width===390){
      await screenshot('mobile-hero');
      await page.evaluate(()=>document.querySelector('[data-quests-section-title]').scrollIntoView());await screenshot('mobile-grid');
      await open();await screenshot('mobile-filters');
      const bounds=await page.$eval('dialog',e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,height:e.clientHeight}));
      assert.ok(bounds.left>=0&&bounds.right<=390&&bounds.height<=900);
      await page.keyboard.press('Escape');
      await page.evaluate(()=>document.querySelector('[data-quest-app-close]').click());
      assert.equal(await page.$('.quest-app-banner'),null);
    }
  }
  await page.evaluate(async()=>{await Promise.all([...document.images].map(i=>{i.loading='eager';return i.decode();}));});
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  await fs.writeFile('screenshots/quests-report.json',JSON.stringify({cards:60,viewports:report,errors,failed},null,2));
  console.log('Quests: 60 local cards; combined filters, cancel/reset, URL reloads, four sorts, empty state, carousel, and five responsive widths passed. No page errors or failed resources.');
} finally { await browser.close(); }
