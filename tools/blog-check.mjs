import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const origin=process.env.SITE_URL||'http://localhost:5000';
const errors=[],failed=[],report=[];
try {
 for(const mobile of [false,true]) {
  const context=await browser.newContext({viewport:{width:mobile?390:1440,height:900},isMobile:mobile,hasTouch:mobile});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.url().startsWith(origin)&&r.status()>=400)failed.push([r.url(),r.status()]);});
  const visit=async route=>{assert.equal((await page.goto(origin+route,{waitUntil:'networkidle'})).status(),200);};
  const geometry=async route=>{
   const result=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,broken:[...document.images].filter(i=>i.complete&&!i.naturalWidth).map(i=>i.src),background:getComputedStyle(document.body).backgroundColor}));
   assert.ok(result.scrollWidth<=result.width,route+' fits viewport');assert.deepEqual(result.broken,[],route+' images');
   report.push({route,mobile,...result});
  };
  await visit('/blog');
  assert.equal(await page.locator('.blog-site-header').evaluate(header=>getComputedStyle(header).backgroundColor),'rgb(0, 0, 0)','Blog keeps the normal black site header');
  assert.equal(await page.getByRole('button',{name:'Log in',exact:true}).count(),1);
  assert.equal(await page.locator('.blog-hero h1').count(),1,'Blog has the referenced photo feature');
  assert.equal(await page.locator('.blog-top-posts > article').count(),5);
  assert.equal(await page.locator('.blog-latest-grid > article').count(),11);
  assert.equal(await page.locator('.blog-footer').count(),1);
  await geometry('/blog');
  await page.screenshot({path:`screenshots/blog-listing-${mobile?'mobile':'desktop'}.png`,fullPage:true});
  const links=await page.locator('main a[data-blog-post]').evaluateAll(as=>[...new Set(as.map(a=>a.getAttribute('href')))]);
  assert.equal(links.length,16,'Every visible story has a local detail route');
  await page.locator('.blog-hero h1 a').click();
  await page.waitForURL('**/blog/into-the-mist-creating-atmosphere-with-fog-photography');
  assert.equal(await page.locator('.blog-article').count(),1);
  assert.equal(await page.locator('.blog-article figure').count(),5);
  assert.equal(await page.locator('.blog-article h2').first().innerText(),'Why fog makes such strong images');
  await page.getByRole('button',{name:'Share article',exact:true}).click();
  assert.equal(await page.locator('#share-url').inputValue(),page.url());
  await page.keyboard.press('Escape');
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('.blog-article').count(),1,'Article survives reload');
  await geometry(new URL(page.url()).pathname);
  await page.screenshot({path:`screenshots/blog-article-${mobile?'mobile':'desktop'}.png`,fullPage:true});
  await page.locator('.blog-post-navigation a').last().click();
  await page.waitForURL('**/blog/shorter-days-stronger-images-a-guide-to-low-light-photography');
  assert.match(await page.locator('h1').innerText(),/Shorter Days/);
  for(const href of links){
   await visit(href+'/?preview=1');
   assert.equal(await page.locator('main h1').count(),1,href);
   assert.equal(await page.locator('.blog-article').count(),1,href);
   await geometry(href);
  }
  await visit('/blog');
  const menu=page.getByRole('button',{name:'Open blog menu',exact:true});
  if(mobile){
   await menu.click();assert.equal(await menu.getAttribute('aria-expanded'),'true');
  }
  const education=page.locator('.blog-categories summary').filter({hasText:'Education'});
  await education.focus();await page.keyboard.press('Enter');
  await page.getByRole('link',{name:'Tutorials',exact:true}).click();
  await page.waitForURL('**/blog/category/craft/tutorials');
  assert.equal(await page.locator('main h1').innerText(),'Tutorials');
  if(mobile){await menu.click();assert.equal(await menu.getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await menu.getAttribute('aria-expanded'),'false');}
  await visit('/blog/category/craft');
  assert.equal(await page.locator('main h1').innerText(),'Education');
  assert.ok(await page.locator('.blog-latest-grid article').count()>0,'Category shows matching captured stories');
  assert.equal(await page.locator('.blog-latest-grid').getByText('Ricardo Lostanaw: Featured Photographer Spotlight',{exact:true}).count(),0,'Category omits nonmatching stories');
  await geometry('/blog/category/craft');
  await page.screenshot({path:`screenshots/blog-category-${mobile?'mobile':'desktop'}.png`,fullPage:true});
  await visit('/blog/category/__proto__');assert.equal(await page.locator('main h1').innerText(),'Category not found');
  await visit('/blog/category/not-a-category');assert.equal(await page.locator('main h1').innerText(),'Category not found');
  await visit('/blog/not-a-story');assert.equal(await page.locator('main h1').innerText(),'Article not found');
  assert.equal(await page.locator('.blog-article').count(),0,'Unknown story never shows an unrelated article');
  await page.getByRole('link',{name:'Back to the Blog',exact:true}).click();await page.waitForURL('**/blog');
  assert.equal(await page.locator('a[href*="upgrade"],a[href^="/manager"]').count(),0,'Excluded screens stay excluded');
  if(mobile){
   for(const width of [320,768]){await page.setViewportSize({width,height:900});await geometry('/blog');await visit(links[0]);await geometry(links[0]);await visit('/blog');}
  }
  await page.getByRole('button',{name:'Log in',exact:true}).click();
  await page.waitForSelector('dialog[open] input[name="account"]');
  await page.keyboard.press('Escape');
  await context.close();
 }
 assert.deepEqual(errors,[],'No uncaught JavaScript errors');assert.deepEqual(failed,[],'No failed local responses');
 await fs.writeFile('screenshots/blog-results.json',JSON.stringify({report,errors,failed},null,2));
 console.log(`Blog checks passed: ${report.length} route/viewport checks; listing-to-article navigation, all 16 stories, reloads, sharing, previous/next, keyboard categories, mobile menu, and missing routes.`);
} finally {await browser.close();}
