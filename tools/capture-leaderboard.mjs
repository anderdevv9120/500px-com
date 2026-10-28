import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const {puppeteer} = await import(pathToFileURL(process.env.PUPPETEER_MODULE).href);
const browser = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,defaultViewport:{width:1920,height:900}});
const assets = new Map(JSON.parse(await fs.readFile('.reference/assets.json','utf8')));
const captures = {};

function localAsset(value) {
  if(!value || value.startsWith('data:')) return value;
  const url = new URL(value.replaceAll('&amp;','&'),'https://500px.com').href;
  if(!assets.has(url)) assets.set(url,`/assets/${String(assets.size).padStart(4,'0')}-${path.basename(new URL(url).pathname).replace(/[^a-zA-Z0-9._-]/g,'-')}`);
  return assets.get(url);
}

function localize(text) {
  return text.replace(/(?:src|data-src)="([^"]+)"/g,(match,url)=>match.replace(url,localAsset(url)))
    .replace(/url\(["']?([^\)"']+)["']?\)/g,(_,url)=>`url("${localAsset(url)}")`)
    .replaceAll('https://500px.com/','/');
}

try {
  const page = await browser.newPage();
  await page.goto('https://500px.com/leaderboard',{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForSelector('article .row-thumb-container img',{timeout:45000});
  for(const period of ['weekly','monthly']) {
    if(period==='monthly') {
      await page.evaluate(()=>[...document.querySelectorAll('[role="tab"]')].find(el=>el.textContent==='Monthly').click());
      await page.waitForFunction(()=>document.querySelector('section')?.innerText.includes('Monthly Leaderboard')&&!!document.querySelector('article .row-thumb-container img'),{timeout:30000});
    }
    const rows = new Map();
    for(let batch=0;batch<150;batch++) {
      const visible = await page.evaluate(()=>[...document.querySelectorAll('article')].map(article=>{
        let fiber=article[Object.keys(article).find(key=>key.startsWith('__reactFiber$'))];
        for(let i=0;fiber&&i<12;i++,fiber=fiber.return) {
          const row=fiber.memoizedProps?.row;
          if(row) return {data:row,html:article.outerHTML};
        }
        return null;
      }).filter(Boolean));
      for(const row of visible) if(row.data.rank<=50)rows.set(row.data.rank,row);
      const highest=Math.max(...rows.keys());
      if(rows.size===50)break;
      const atBottom=await page.evaluate(async()=>{
        const previous=window.scrollY;
        window.scrollBy(0,650);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        return window.scrollY===previous;
      });
      if(atBottom)try {
        await page.waitForFunction(previous=>[...document.querySelectorAll('article')].some(article=>{
          let fiber=article[Object.keys(article).find(key=>key.startsWith('__reactFiber$'))];
          for(let i=0;fiber&&i<12;i++,fiber=fiber.return) if(fiber.memoizedProps?.row?.rank>previous)return true;
          return false;
        }),{timeout:12000},highest);
      } catch { break; }
    }
    const sorted=[...rows.values()].sort((a,b)=>a.data.rank-b.data.rank);
    if(sorted.length!==50 || sorted.some((row,i)=>row.data.rank!==i+1))throw new Error(`${period}: incomplete leaderboard capture (${sorted.length} rows)`);
    console.log(`${period}: captured ranks 1–50`);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.waitForFunction(()=>!!document.querySelector('img[alt="Top 1"]'),{timeout:10000});
    captures[period]=await page.evaluate((records,period)=>{
      const body=document.body.cloneNode(true);
      body.querySelectorAll('script,iframe,noscript,style,.MuiPopover-root,.MuiSkeleton-root,.resize-triggers').forEach(el=>el.remove());
      body.querySelectorAll('[data-nav-item="Topnav.More.Membership"],a[href*="/upgrade"]').forEach(el=>el.remove());
      const view=body.querySelector('#root > div');
      view.dataset.leaderboardView=period;
      const list=view.querySelector('[role="grid"]');
      const container=list.firstElementChild;
      list.dataset.leaderboardList='';
      list.parentElement.dataset.leaderboardHost='';
      container.dataset.leaderboardRows='';
      container.replaceChildren();
      const urls=new Map(records.map(({data})=>[new URL(data.photoUrl).pathname,data]));
      for(const {data,html} of records) {
        const template=document.createElement('template');template.innerHTML=html;
        const article=template.content.firstElementChild;
        article.dataset.leaderboardRank=data.rank;
        article.dataset.leaderboardPhoto=`/photo/${data.id}`;
        article.dataset.leaderboardAuthor=data.author.name;
        const thumb=article.querySelector('.row-thumb-container');
        let image=thumb.querySelector('img');
        if(!image){image=document.createElement('img');thumb.firstElementChild.append(image);}
        image.src=data.photoThumbUrl;image.alt=data.title||'Untitled';
        const links=[...article.querySelectorAll('[role="link"]')];
        links.forEach((element,index)=>{
          const link=document.createElement('a');
          for(const attr of element.attributes)link.setAttribute(attr.name,attr.value);
          link.removeAttribute('role');
          link.href=index<2?`/photo/${data.id}`:`/p/${encodeURIComponent(data.author.username)}`;
          link.innerHTML=element.innerHTML;element.replaceWith(link);
        });
        for(const [label,action]of [['Like','like'],['Save','save'],['Comment','comment'],['More Actions','more']]){
          const control=article.querySelector(`[aria-label="${label}"]`);
          if(!control)continue;
          control.dataset.leaderboardAction=action;
          control.setAttribute('tabindex','0');
          const count=[...control.querySelectorAll('span')].find(el=>/^\d+$/.test(el.textContent));
          if(count){count.dataset.leaderboardCount='';count.dataset.originalCount=count.textContent;}
        }
        container.append(article);
      }
      view.querySelectorAll('section .photo-container').forEach(element=>{
        const img=element.querySelector('img');if(!img)return;
        const row=urls.get(new URL(img.getAttribute('src')||img.dataset.src).pathname);
        if(!row)return;
        const link=document.createElement('a');
        for(const attr of element.attributes)link.setAttribute(attr.name,attr.value);
        link.href=`/photo/${row.id}`;link.setAttribute('aria-label',row.title||'Untitled');link.innerHTML=element.innerHTML;
        element.replaceWith(link);
      });
      view.querySelector('section .photo-container')?.parentElement.setAttribute('data-leaderboard-strip','');
      view.querySelectorAll('.MuiSkeleton-root').forEach(element=>element.remove());
      view.querySelectorAll('img[data-src]').forEach(img=>{if(!img.getAttribute('src'))img.src=img.dataset.src;img.removeAttribute('data-src');});
      const css=[...document.styleSheets].flatMap(sheet=>{try{return[...sheet.cssRules].map(rule=>rule.cssText);}catch{return[];}});
      return{body:body.innerHTML,view:view.outerHTML,css,records:records.map(({data})=>data),title:document.title};
    },sorted,period);
  }
} finally { await browser.close(); }

await fs.copyFile('pages/leaderboard.html','.reference/leaderboard-before.html');
await fs.copyFile('pages/leaderboard.css','.reference/leaderboard-before.css');
const css=localize([...new Set([...captures.weekly.css,...captures.monthly.css])].join('\n'));
for(const period of ['weekly','monthly']) {
  await fs.writeFile(`pages/leaderboard-${period}-fragment.html`,localize(captures[period].view));
}
await fs.writeFile('pages/leaderboard.css',css);
await fs.writeFile('pages/leaderboard.html',`<!doctype html>\n<html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${captures.weekly.title}</title><link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/pages/leaderboard.css?v=2"><link rel="stylesheet" href="/styles.css?v=leaderboard-2"><script src="/app.js?v=leaderboard-2" defer></script></head><body data-page="leaderboard">${localize(captures.weekly.body)}</body></html>`);
const catalog=JSON.parse(await fs.readFile('catalog.json','utf8'));
for(const capture of Object.values(captures))for(const row of capture.records){
  const href=`/photo/${row.id}`;
  if(!catalog.photos.some(photo=>photo.href===href))catalog.photos.push({href,title:row.title||'Untitled',author:row.author.name,src:localAsset(row.photoThumbUrl),ratio:row.photoWidth/row.photoHeight});
}
await fs.writeFile('catalog.json',JSON.stringify(catalog,null,2));
await fs.writeFile('.reference/leaderboard-captures.json',JSON.stringify(captures,null,2));
const pending=[...assets];
async function download(){
  while(pending.length){
    const[url,file]=pending.shift();
    try{await fs.access(`.${file}`);continue;}catch{}
    const response=await fetch(url,{signal:AbortSignal.timeout(25000)});
    if(!response.ok)throw new Error(`Could not download ${file}: HTTP ${response.status}`);
    await fs.writeFile(`.${file}`,Buffer.from(await response.arrayBuffer()));
  }
}
await Promise.all(Array.from({length:6},download));
await fs.writeFile('.reference/assets.json',JSON.stringify([...assets],null,2));
console.log(`Saved ${captures.weekly.records.length} weekly and ${captures.monthly.records.length} monthly ranks with local artwork.`);
