import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {puppeteer}=await import(pathToFileURL(process.env.PUPPETEER_MODULE).href);
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const entries=JSON.parse(await fs.readFile('.reference/assets.json','utf8'));
const assets=new Map(entries);
const canonical=new Map();
const replacements=new Map();
for(const [url,file] of entries){
  const clean=url.replaceAll('&amp;','&');
  if(canonical.has(clean))replacements.set(file,canonical.get(clean));
  else canonical.set(clean,file);
}
async function asset(url){
  const absolute=new URL(url.replaceAll('&amp;','&'),'https://500px.com').href;
  if(canonical.has(absolute))return canonical.get(absolute);
  const file=`/assets/${String(assets.size).padStart(4,'0')}-${path.basename(new URL(absolute).pathname) || 'image'}`;
  canonical.set(absolute,file);assets.set(absolute,file);
  try{const r=await fetch(absolute,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);await fs.writeFile(`.${file}`,Buffer.from(await r.arrayBuffer()));}catch{replacements.set(file,'/assets/0000-landscape-Ms_E_Kxo.jpg');}
  return file;
}
async function localize(text){
  const urls=[...text.matchAll(/(?:https:\/\/[^"'\s<>]+?\.(?:jpg|jpeg|png|webp|svg|woff2)(?:\?[^"'\s<>]*)?|\/assets\/[^"'\s<>;)]+\.(?:jpg|jpeg|png|webp|svg|woff2))/g)].map(x=>x[0]);
  for(const url of new Set(urls)){
    if([...canonical.values()].includes(url))continue;
    const file=await asset(url);
    text=text.replaceAll(url,file);
  }
  for(const [from,to]of replacements)text=text.replaceAll(from,to);
  return text.replaceAll('https://500px.com/','/');
}
const catalog={photos:[],quests:[]};
const photoIds=new Set();
const page=await browser.newPage();
try{
  for(const file of(await fs.readdir('pages')).filter(x=>x.endsWith('.html')&&!x.startsWith('leaderboard')&&!x.startsWith('licensing')&&x!=='grants.html')){
    let html=await fs.readFile(`pages/${file}`,'utf8');
    for(const[from,to]of replacements)html=html.replaceAll(from,to);
    const result=await page.evaluate(html=>{
      const doc=new DOMParser().parseFromString(html,'text/html');
      doc.querySelectorAll('.MuiPopover-root,.MuiPopper-root,[data-nav-item="Topnav.More.Membership"],script:not([src="/app.js"])').forEach(e=>e.remove());
      doc.querySelectorAll('[aria-hidden="true"]').forEach(e=>{if(e.id==='root')e.removeAttribute('aria-hidden')});
      doc.querySelectorAll('a[href*="/upgrade"]').forEach(e=>e.remove());
      doc.querySelectorAll('.MuiCircularProgress-root').forEach(e=>e.remove());
      doc.querySelectorAll('*').forEach(e=>{if(e.children.length===0&&e.textContent.trim()==='Loading...')e.remove()});
      const photos=[];
      doc.querySelectorAll('a[href^="/photo/"]').forEach(a=>{
        const card=a.parentElement;
        const img=card.querySelector('img');
        if(!img)return;
        const wrapper=card.parentElement;
        const ratio=parseFloat(wrapper.style.width)/parseFloat(wrapper.style.height);
        card.dataset.photoCard=a.getAttribute('href');
        wrapper.dataset.masonryItem='';
        wrapper.dataset.ratio=Number.isFinite(ratio)?ratio:1.5;
        const grid=wrapper.closest('.ReactVirtualized__Masonry__innerScrollContainer');
        if(grid){grid.dataset.masonryGrid='';grid.parentElement.dataset.masonryOuter='';}
        const author=card.querySelector('[data-track-id="creator_avatar"]')?.textContent.trim().replace(/(?:Pro|Plus)$/,'')||'500px Photographer';
        photos.push({href:a.getAttribute('href'),title:img.alt||'Untitled',src:img.getAttribute('src'),author,ratio:Number.isFinite(ratio)?ratio:1.5});
        card.querySelectorAll('button').forEach(b=>{if(!b.getAttribute('aria-label')){b.setAttribute('aria-label','Like photo');b.dataset.like='';}});
        a.setAttribute('aria-label',`View ${img.alt||'photo'}`);
        card.querySelector('[data-track-id="creator_avatar"]')?.setAttribute('tabindex','0');
      });
      const quests=[...doc.querySelectorAll('a[href^="/quest/"]')].map(a=>{
        const card=a.parentElement;
        const img=card.querySelector('img');
        if(!img)return null;
        if(!card.hasAttribute('data-quest-card'))card.dataset.questCard='';
        const title=a.getAttribute('aria-label')||card.querySelector('p')?.textContent||'Quest';
        return{href:a.getAttribute('href'),title,src:img.getAttribute('src'),text:card.textContent};
      }).filter(Boolean);
      return{html:'<!doctype html>\n'+doc.documentElement.outerHTML,photos,quests};
    },html);
    for(const photo of result.photos)if(!photoIds.has(photo.href)){catalog.photos.push(photo);photoIds.add(photo.href);}
    if(file==='quests.html')catalog.quests=result.quests;
    await fs.writeFile(`pages/${file}`,result.html);
  }
  const login=JSON.parse(await fs.readFile('.reference/inspect-login.json','utf8'));
  const detail=JSON.parse(await fs.readFile('.reference/inspect-photo-details.json','utf8'));
  const fragments=await page.evaluate((loginHTML,detailHTML)=>{
    const loginDoc=new DOMParser().parseFromString(loginHTML,'text/html');
    const detailDoc=new DOMParser().parseFromString(detailHTML,'text/html');
    const modal=loginDoc.querySelector('[role="dialog"]');
    modal.querySelectorAll('style,script,iframe').forEach(e=>e.remove());
    const account=modal.querySelector('input[type="text"]');
    if(account){account.name='account';account.required=true;account.setAttribute('aria-label','Email or username');account.autocomplete='username';}
    const password=modal.querySelector('input[type="password"]');
    if(password){password.name='password';password.required=true;password.minLength=4;password.setAttribute('aria-label','Password');password.autocomplete='current-password';}
    modal.querySelector('input[type="checkbox"]').required=true;
    modal.querySelectorAll('a').forEach(a=>{a.href=a.getAttribute('href').replace('https://500px.com','')});
    const photoInfo=[...detailDoc.querySelectorAll('p')].find(e=>e.textContent==='Photo Info');
    const panel=photoInfo?.parentElement.parentElement;
    const scope=modal.closest('.MuiDialog-root')?.className||'';
    return{login:`<div class="${scope}" data-auth-scope>${modal.outerHTML}</div>`,details:panel?.outerHTML||''};
  },login.html,detail.html);
  await fs.writeFile('pages/login-fragment.html',await localize(fragments.login));
  await fs.writeFile('pages/photo-details-fragment.html',await localize(fragments.details));
  await fs.writeFile('pages/fragments.css',await localize(login.css+'\n'+detail.css));
  // Repair HTML-encoded CDN URLs from captured attributes without depending on expiring links at runtime.
  for(const [url,file]of assets){
    try{await fs.access(`.${file}`);}catch{
      const decoded=url.replaceAll('&amp;','&');
      try{const response=await fetch(decoded,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('unavailable');await fs.writeFile(`.${file}`,Buffer.from(await response.arrayBuffer()));}catch{replacements.set(file,catalog.photos[0]?.src||'/assets/0000-landscape-Ms_E_Kxo.jpg');}
    }
  }
  for(const file of(await fs.readdir('pages')).filter(x=>/\.(html|css)$/.test(x))){
    let text=await fs.readFile(`pages/${file}`,'utf8');
    for(const[from,to]of replacements)text=text.replaceAll(from,to);
    await fs.writeFile(`pages/${file}`,text);
  }
  for(const photo of catalog.photos)if(replacements.has(photo.src))photo.src=replacements.get(photo.src);
  await fs.writeFile('catalog.json',JSON.stringify(catalog,null,2));
  await fs.copyFile('pages/welcome.html','index.html');
  await fs.writeFile('.reference/assets.json',JSON.stringify([...assets],null,2));
  console.log(`Prepared ${catalog.photos.length} photos and ${catalog.quests.length} quests. Login and photo details use original markup.`);
}finally{await browser.close();}
