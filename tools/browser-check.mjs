import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {puppeteer}=await import(pathToFileURL(process.env.PUPPETEER_MODULE).href);
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,defaultViewport:{width:1920,height:900}});
await fs.mkdir('screenshots',{recursive:true});
const report=[];
try{
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  for(const [route,name]of [['/','welcome'],['/discover','discover'],['/quests','quests'],['/licensing','licensing'],['/photo/SDjF7aAGorn','photo'],['/quest/0cqon9TXhfJ','quest'],['/p/MarcoGrassi','profile'],['/download','download'],['/vivo_image','vivo'],['/search?q=landscape','search'],['/leaderboard','leaderboard'],['/blog','blog']]){
    const response=await page.goto(`http://localhost:5000${route}`,{waitUntil:'networkidle0',timeout:25000});
    assert.equal(response.status(),200,route);
    await page.screenshot({path:`screenshots/${name}-desktop.jpg`,type:'jpeg',quality:75,waitForFonts:false,timeout:12000});
    const check=await page.evaluate(()=>({title:document.title,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,images:document.images.length,broken:[...document.images].filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.getAttribute('src')),membershipLinks:document.querySelectorAll('a[href*="/upgrade"]').length,cards:document.querySelectorAll('[data-photo-card]').length}));
    assert.equal(check.membershipLinks,0,`${route}: Membership link removed`);
    assert.deepEqual(check.broken,[],`${route}: local images load`);
    if(name==='leaderboard'){
      assert.equal(await page.$$eval('[data-leaderboard-rank]',rows=>rows.length),50);
      assert.ok(await page.$('[data-leaderboard-strip]'));
      assert.equal(await page.$('.local-ranking'),null);
    }
    if(check.cards&&await page.$('[data-masonry-grid]')){
      const bounds=await page.$eval('[data-masonry-grid]',grid=>({width:grid.getBoundingClientRect().width,height:grid.getBoundingClientRect().height,tiles:[...grid.querySelectorAll(':scope > [data-masonry-item]')].slice(0,5).map(el=>({left:el.offsetLeft,top:el.offsetTop,width:el.offsetWidth,height:el.offsetHeight}))}));
      assert.ok(bounds.width>300&&bounds.height>200,`${route}: masonry has visible dimensions`);
      assert.ok(new Set(bounds.tiles.map(t=>t.left)).size>1,`${route}: photos occupy multiple columns`);
    }
    report.push({route,...check});
    console.log(name,JSON.stringify(check));
  }
  await page.goto('http://localhost:5000/',{waitUntil:'networkidle0'});
  await page.click('.photo-container[role="button"]');
  assert.match(await page.$eval('h1',e=>e.textContent),/1\/4/);
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Log in').click());
  await page.waitForSelector('dialog[open] input[name="account"]');
  await page.screenshot({path:'screenshots/login-desktop.jpg',type:'jpeg',quality:80,waitForFonts:false});
  await page.type('dialog input[name="account"]','demo');
  await page.type('dialog input[name="password"]','sample');
  await page.click('dialog input[type="checkbox"]');
  await page.click('dialog button[type="submit"]');
  await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
  assert.ok((await page.evaluate(()=>localStorage.getItem('500px-local-demo'))).includes('Alex Morgan'));
  await page.goto('http://localhost:5000/photo/SDjF7aAGorn',{waitUntil:'networkidle0'});
  await page.evaluate(()=>[...document.querySelectorAll('[role="tab"]')].find(b=>b.textContent==='Details').click());
  await page.waitForFunction(()=>document.getElementById('500px-tabpanel-meta').textContent.includes('Photo Info'));
  assert.equal(await page.$eval('#\\35 00px-tabpanel-meta',e=>getComputedStyle(e).display),'block');
  await page.goto('http://localhost:5000/quests',{waitUntil:'networkidle0'});
  await page.click('[data-quest-filter="Free"]');
  const free=await page.$$eval('[data-quest-card]:not([hidden])',els=>els.length);
  assert.ok(free>0&&free<60,'Quest filtering changes visible cards');
  for(const [route,name]of [['/','welcome'],['/discover','discover'],['/quests','quests'],['/licensing','licensing'],['/photo/SDjF7aAGorn','photo'],['/download','download'],['/p/MarcoGrassi','profile']]){
    await page.setViewport({width:390,height:844});
    await page.goto(`http://localhost:5000${route}`,{waitUntil:'networkidle0',timeout:25000});
    await page.screenshot({path:`screenshots/${name}-mobile.jpg`,type:'jpeg',quality:75,waitForFonts:false,timeout:12000});
    const check=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
    assert.equal(check.scrollWidth,check.width,`${route}: no mobile horizontal overflow`);
    report.push({route,mobile:true,...check});console.log(`${name} mobile`,JSON.stringify(check));
  }
  assert.deepEqual(errors,[],'No uncaught JavaScript errors');
  await fs.writeFile('screenshots/report.json',JSON.stringify(report,null,2));
  console.log('Browser checks passed.');
}finally{await browser.close();}
