import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const {puppeteer}=await import(pathToFileURL(process.env.PUPPETEER_MODULE).href);
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,defaultViewport:{width:1920,height:900}});
const base=process.env.BASE_URL||'http://localhost:5000';
const guides=['licensing','contribute','requirements','releases','keywording','content','distribution'];
const report=[];
await fs.mkdir('screenshots',{recursive:true});
try {
  const page=await browser.newPage();
  const errors=[],failed=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)failed.push(response.url());});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  const visit=async route=>{
    const response=await page.goto(base+route,{waitUntil:'networkidle0'});
    assert.equal(response.status(),200,route);
    await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(async()=>{await Promise.all([...document.images].map(image=>{image.loading='eager';return image.decode().catch(()=>{});}));window.scrollTo({top:0,behavior:'instant'});});
  };
  const screenshot=async name=>page.screenshot({path:`screenshots/licensing-${name}.png`,waitForFonts:false});
  for(const width of [1920,768,390,320]){
    await page.setViewport({width,height:900});
    for(const route of ['/licensing',...guides.map(g=>'/licensing/'+g),'/licensing-agreement','/grants']){
      await visit(route);
      const data=await page.evaluate(()=>({
        title:document.title,width:innerWidth,scroll:document.documentElement.scrollWidth,
        broken:[...document.images].filter(i=>!i.naturalWidth).map(i=>i.src),
        navigation:[...document.querySelectorAll('nav[aria-label="Licensing navigation"] a')].map(a=>a.getAttribute('href')),
        active:document.querySelector('nav [aria-current="page"]')?.getAttribute('href'),
        navVisible:!!document.querySelector('nav')?.getBoundingClientRect().height,
        mainVisible:!!document.querySelector('main')?.getBoundingClientRect().height,
        contents:document.querySelector('[data-licensing-toc]')?.getAttribute('aria-expanded')
      }));
      assert.equal(data.scroll,width,`${route}: horizontal overflow at ${width}`);
      assert.deepEqual(data.broken,[],`${route}: images`);
      if(route.startsWith('/licensing/')){
        assert.deepEqual(data.navigation,guides.map(g=>'/licensing/'+g));
        assert.equal(data.active,route);
        assert.equal(data.navVisible,width>768);
        assert.equal(data.mainVisible,true);
        if(width<=768){
          assert.equal(data.contents,'false');await page.click('[data-licensing-toc]');
          assert.equal(await page.$eval('nav',e=>!!e.getBoundingClientRect().height),true);
          await page.keyboard.press('Escape');assert.equal(await page.$eval('[data-licensing-toc]',e=>e.getAttribute('aria-expanded')),'false');
        }
      }
      report.push({route,...data});
      if(width===1920||width===390)await screenshot((route.replaceAll('/','-').slice(1)||'home')+'-'+width);
    }
  }
  await page.setViewport({width:1920,height:900});
  await visit('/licensing');
  const anchors=await page.$$eval('a[href*="/licensing/"][href*="#"]',links=>links.map(a=>a.getAttribute('href')));
  assert.equal(anchors.length,7);
  for(const href of anchors){
    await visit(href);
    assert.equal(await page.evaluate(()=>!!document.getElementById(location.hash.slice(1))),true,href);
    await page.evaluate(()=>document.getElementById(location.hash.slice(1)).scrollIntoView({behavior:'instant'}));
    assert.ok(await page.evaluate(()=>document.getElementById(location.hash.slice(1)).getBoundingClientRect().top>=64),href);
  }
  await visit('/licensing');await page.click('header button[aria-label="Licensing"]');
  assert.deepEqual(await page.$$eval('.local-menu a',links=>links.map(a=>a.getAttribute('href'))),['/licensing/licensing','/licensing/contribute','/licensing/requirements','/licensing/content','/licensing/distribution','/grants']);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Get started').click());
  await page.waitForSelector('dialog[open] input[type="password"]');await page.keyboard.press('Escape');
  await visit('/licensing/contribute');await page.click('main a[href="/manager/licensing"]');
  await page.waitForSelector('dialog[open] input[type="password"]');await page.keyboard.press('Escape');
  for(const file of ['ModelReleaseForm.pdf','PropertyReleaseForm.pdf','contributor_licensing_agreement.pdf']){
    const response=await fetch(`${base}/assets/${file}`);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
  }
  await page.setViewport({width:390,height:844});await visit('/licensing/contribute');
  await page.click('[data-licensing-toc]');await screenshot('mobile-contents-expanded');
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),page.click('nav a[href="/licensing/releases"]')]);
  assert.ok(page.url().endsWith('/licensing/releases'));
  await page.click('[data-licensing-app-close]');assert.equal(await page.$('.licensing-app-banner'),null);
  await page.click('[aria-label="Open customer service"]');await page.waitForSelector('dialog[open]');await page.keyboard.press('Escape');
  await page.setViewport({width:1920,height:900});await visit('/grants');
  assert.equal(await page.$$eval('[data-grant-section]',sections=>sections.length),5);
  await page.click('[data-grant-target="showus"]');
  await page.waitForFunction(()=>document.querySelector('[data-grant-target="showus"]').getAttribute('aria-current')==='location');
  await screenshot('grants-collection');
  assert.equal(await page.$$eval('a[href^="https://500px.com/gallery/"]',links=>links.length),5);
  await page.evaluate(()=>localStorage.setItem('500px-local-demo',JSON.stringify({user:{name:'Alex Morgan'}})));
  await visit('/licensing');await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Get started').click());
  await page.waitForSelector('dialog[open] input[type="file"]');await page.keyboard.press('Escape');
  assert.deepEqual(errors,[],'Uncaught browser errors');assert.deepEqual(failed,[],'Failed local requests');
  await fs.writeFile('screenshots/licensing-results.json',JSON.stringify({report,anchors,errors,failed},null,2));
  console.log(`Licensing: ${report.length} route/viewport checks; seven deep links; contents, navigation, login/upload, support, Grant sections, images, and three PDFs passed.`);
} finally {await browser.close();}
