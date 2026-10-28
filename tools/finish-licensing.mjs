import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

// Refresh only Licensing fixtures; the finished site has no browser dependency.
const {puppeteer}=await import(pathToFileURL(process.env.PUPPETEER_MODULE).href);
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,defaultViewport:{width:1920,height:900}});
const assets=new Map(JSON.parse(await fs.readFile('.reference/assets.json','utf8')));
const canonical=new Map([...assets].map(([url,file])=>[url.replaceAll('&amp;','&'),file]));
const pending=new Map();
const guides=['licensing','contribute','requirements','releases','keywording','content','distribution'];
await fs.mkdir('.reference/licensing-before',{recursive:true});

function asset(value) {
  if(!value||value.startsWith('data:'))return value;
  const url=new URL(value.replaceAll('&amp;','&'),'https://500px.com').href;
  if(canonical.has(url))return canonical.get(url);
  const file=`/assets/${String(assets.size).padStart(4,'0')}-${path.basename(new URL(url).pathname)}`;
  canonical.set(url,file);assets.set(url,file);pending.set(url,file);
  return file;
}

function localize(value) {
  return value.replace(/\bsrc="([^"]+)"/g,(match,url)=>match.replace(url,asset(url)))
    .replace(/url\(["']?([^\)"']+)["']?\)/g,(_,url)=>`url("${asset(url)}")`)
    .replace(/https:\/\/500px\.com\//g,'/');
}

try {
  const page=await browser.newPage();
  await page.goto('https://500px.com/grants',{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForSelector('#btm h3',{timeout:30000});
  await page.waitForFunction(()=>[...document.querySelectorAll('header button')].some(button=>button.textContent==='Log in'),{timeout:30000});
  await page.waitForSelector('header a[href="/vivo_image"]',{timeout:30000});
  await page.evaluate(()=>document.fonts.ready);
  const grants=await page.evaluate(()=>{
    const collections=[...document.querySelectorAll('h3')].map(h=>{
      let fiber=h[Object.keys(h).find(key=>key.startsWith('__reactFiber$'))];
      for(let i=0;fiber&&i<40;i++,fiber=fiber.return)if(fiber.memoizedProps?.collection)return fiber.memoizedProps.collection;
      return null;
    }).filter(Boolean);
    const root=document.querySelector('#root').cloneNode(true);
    root.querySelectorAll('script,style,iframe,.MuiPopover-root,[data-nav-item="Topnav.More.Membership"],a[href*="/upgrade"]').forEach(e=>e.remove());
    const link=(button,href)=>{
      const a=document.createElement('a');
      for(const attr of button.attributes)a.setAttribute(attr.name,attr.value);
      a.removeAttribute('type');a.href=href;a.innerHTML=button.innerHTML;button.replaceWith(a);
    };
    for(const button of root.querySelectorAll('button')) {
      const text=button.textContent.trim();
      if(text==='Check out the latest Grant')link(button,'/quests');
      if(text==='Learn more')link(button,'/licensing');
      const collection=collections.find(c=>c.label===text);
      if(collection){button.dataset.grantTarget=collection.id;if(collection.id==='btm')button.setAttribute('aria-current','location');link(button,'#'+collection.id);}
    }
    for(const c of collections){
      const section=root.querySelector('#'+c.id);section.dataset.grantSection='';
      const button=[...section.querySelectorAll('button')].find(b=>b.textContent==='See the full Collection');
      link(button,'/gallery/'+c.galleryId);
    }
    return {body:root.outerHTML,title:document.title,collections,css:[...document.styleSheets].flatMap(s=>{try{return[...s.cssRules].map(r=>r.cssText)}catch{return[]}})};
  });
  assert.equal(grants.collections.length,5,'All five Grant collections must be captured');
  await fs.writeFile('.reference/licensing-grants.json',JSON.stringify(grants,null,2));
  await fs.writeFile('pages/grants.html',`<!doctype html>\n<html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${grants.title}</title><link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/pages/grants.css"><link rel="stylesheet" href="/pages/licensing-shared.css"><link rel="stylesheet" href="/styles.css"><script src="/app.js?v=licensing-1" defer></script></head><body data-page="grants">${localize(grants.body)}</body></html>`);
  await fs.writeFile('pages/grants.css',localize(grants.css.join('\n')));

  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  await page.goto('https://500px.com/licensing/releases',{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Table of Contents'),{timeout:30000});
  const mobile=await page.evaluate(()=>{
    const banner=document.querySelector('#root > [role="banner"]').cloneNode(true);
    banner.classList.add('licensing-app-banner');
    banner.querySelector('button').dataset.licensingAppClose='';
    banner.querySelector('a').href='/download';
    return {banner:banner.outerHTML,css:[...document.styleSheets].flatMap(s=>{try{return[...s.cssRules].map(r=>r.cssText)}catch{return[]}})};
  });
  const originalCSS=await fs.readFile('pages/licensing-releases.css','utf8');
  const extraCSS=mobile.css.filter(rule=>!originalCSS.includes(rule));
  await fs.writeFile('pages/licensing-mobile.css',localize(extraCSS.join('\n')));
  await fs.writeFile('.reference/licensing-mobile.json',JSON.stringify(mobile,null,2));

  for(const name of ['licensing',...guides.map(g=>'licensing-'+g),'grants']){
    const filename=`pages/${name}.html`;
    await fs.copyFile(filename,`.reference/licensing-before/${name}.html`,fs.constants.COPYFILE_EXCL).catch(error=>{if(error.code!=='EEXIST')throw error;});
    const source=await fs.readFile(filename,'utf8');
    const html=await page.evaluate((source,guides,banner)=>{
      const doc=new DOMParser().parseFromString(source,'text/html');
      const nav=doc.querySelector('nav[aria-label="Licensing navigation"]');
      if(nav&&!doc.querySelector('[data-licensing-navigation]')){
        const wrapper=doc.createElement('div');wrapper.dataset.licensingNavigation='';
        nav.before(wrapper);
        const toggle=doc.createElement('button');toggle.type='button';toggle.className='licensing-toc-toggle';toggle.dataset.licensingToc='';
        toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','licensing-guides');
        toggle.innerHTML='Table of Contents<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        nav.id='licensing-guides';wrapper.append(toggle,nav);
        [...nav.querySelectorAll('button')].forEach((button,index)=>{
          const a=doc.createElement('a');for(const attr of button.attributes)a.setAttribute(attr.name,attr.value);
          a.removeAttribute('type');a.href='/licensing/'+guides[index];a.innerHTML=button.innerHTML;button.replaceWith(a);
        });
      }
      if(!doc.querySelector('.licensing-app-banner'))doc.querySelector('#root').insertAdjacentHTML('afterbegin',banner);
      for(const file of ['licensing-mobile','licensing-shared']){
        doc.querySelector(`[href="/pages/${file}.css"]`)?.remove();
        const link=doc.createElement('link');link.rel='stylesheet';link.href=`/pages/${file}.css`;doc.querySelector('link[href="/styles.css"]').before(link);
      }
      doc.querySelector('script[src^="/app.js"]').src='/app.js?v=licensing-2';
      return '<!doctype html>\n'+doc.documentElement.outerHTML;
    },source,guides,mobile.banner);
    assert.ok(html.includes('licensing-app-banner'));
    await fs.writeFile(filename,html);
  }
  for(const file of ['ModelReleaseForm.pdf','PropertyReleaseForm.pdf','contributor_licensing_agreement.pdf']){
    const response=await fetch('https://500px.com/assets/'+file,{signal:AbortSignal.timeout(25000)});
    assert.ok(response.ok,`PDF download: ${file}`);
    const data=Buffer.from(await response.arrayBuffer());assert.equal(data.subarray(0,5).toString(),'%PDF-');
    await fs.writeFile('assets/'+file,data);
  }
  const queue=[...pending];
  await Promise.all(Array.from({length:6},async()=>{
    while(queue.length){const[url,file]=queue.shift();const r=await fetch(url,{signal:AbortSignal.timeout(25000)});assert.ok(r.ok,`Asset ${file}: ${r.status}`);await fs.writeFile('.'+file,Buffer.from(await r.arrayBuffer()));}
  }));
  const manifest=JSON.parse(await fs.readFile('pages/manifest.json','utf8'));manifest['/grants']='grants';
  await fs.writeFile('pages/manifest.json',JSON.stringify(manifest,null,2)+'\n');
  await fs.writeFile('.reference/assets.json',JSON.stringify([...assets],null,2));
  console.log(`Finished seven Licensing guides, three PDFs, and five Grant collections (${pending.size} new local assets).`);
} finally {await browser.close();}
