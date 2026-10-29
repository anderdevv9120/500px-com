import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const origin=process.env.SITE_URL||'http://127.0.0.1:5000';
const ids=['btm','showus','mental','inter','life'];
const errors=[],failed=[];
await fs.mkdir('screenshots',{recursive:true});
try {
  for(const width of [1920,1024,768,390,320]){
    const context=await browser.newContext({viewport:{width,height:900},colorScheme:'dark',isMobile:width<769,hasTouch:width<769});
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{if(response.status()>=400)failed.push(response.url());});
    assert.equal((await page.goto(origin+'/grants',{waitUntil:'networkidle'})).status(),200);
    await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.locator('main h1').textContent(),'Commercial Grants');
    assert.equal(await page.locator('nav[aria-label="Grant projects"] a').count(),5);
    assert.equal(await page.locator('main img').count(),28);
    if(width===1920||width===390)await page.screenshot({path:`screenshots/grants-${width}.png`});
    // Normal motion catches captured blocks accidentally left at opacity zero.
    for(const id of ids){
      await page.locator('#'+id).evaluate(section=>section.scrollIntoView({behavior:'instant'}));
      for(const selector of ['.css-177nfmx','.css-2d98ps','.css-mk7eym']){
        const block=page.locator('#'+id+' '+selector);
        await block.evaluate(element=>element.scrollIntoView({behavior:'instant',block:'center'}));
        await page.waitForFunction(selector=>getComputedStyle(document.querySelector(selector)).opacity==='1','#'+id+' '+selector);
      }
      await page.waitForFunction(id=>document.querySelector('[data-grant-target][aria-current]')?.dataset.grantTarget===id,id);
    }
    await page.evaluate(()=>Promise.all([...document.images].map(image=>{image.loading='eager';return image.decode();})));
    const geometry=await page.evaluate(()=>({
      width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      headerBottom:document.querySelector('header').getBoundingClientRect().bottom,
      navTop:document.querySelector('nav[aria-label="Grant projects"]').getBoundingClientRect().top,
      broken:[...document.images].filter(image=>!image.naturalWidth).map(image=>image.src),
      remoteImages:[...document.images].filter(image=>!image.src.startsWith(location.origin)).map(image=>image.src)
    }));
    assert.ok(geometry.scrollWidth<=width,`No overflow at ${width}`);
    assert.ok(geometry.navTop>=geometry.headerBottom,`Project navigation clears header at ${width}`);
    assert.deepEqual(geometry.broken,[]);
    assert.deepEqual(geometry.remoteImages,[]);
    // Native links preserve deep links, browser history, and keyboard activation.
    await page.locator('[data-grant-target="btm"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/grants#btm');
    await page.waitForFunction(()=>document.querySelector('[data-grant-target="btm"]').hasAttribute('aria-current'));
    await page.reload({waitUntil:'networkidle'});
    await page.waitForFunction(()=>document.querySelector('[data-grant-target="btm"]').hasAttribute('aria-current'));
    if(width===1920||width===390){
      await page.locator('#btm .css-mk7eym').evaluate(element=>element.scrollIntoView({behavior:'instant',block:'start'}));
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('#btm .css-mk7eym')).opacity==='1');
      await page.screenshot({path:`screenshots/grants-mosaic-${width}.png`});
    }
    console.log(JSON.stringify({width,...geometry}));
    await context.close();
  }
  const context=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce'});
  const page=await context.newPage();
  await page.goto(origin+'/grants#life',{waitUntil:'networkidle'});
  assert.equal(await page.locator('#life .css-mk7eym').evaluate(element=>getComputedStyle(element).opacity),'1');
  assert.equal(await page.locator('main.grants-reveals').count(),0);
  await context.close();
  const staticContext=await browser.newContext({javaScriptEnabled:false});
  const staticPage=await staticContext.newPage();
  await staticPage.goto(origin+'/grants');
  assert.equal(await staticPage.locator('#btm .css-mk7eym').evaluate(element=>getComputedStyle(element).opacity),'1');
  await staticContext.close();
  assert.deepEqual(errors,[],'Browser errors');
  assert.deepEqual(failed,[],'Failed resources');
  console.log('Grants: five viewports, all sections reveal, sticky navigation, deep links, reduced motion, and local images passed.');
} finally {
  await browser.close();
}
