import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Capture development fixtures only; the finished site has no browser dependency.
const { puppeteer } = await import(pathToFileURL(process.env.PUPPETEER_MODULE).href);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, defaultViewport: { width: 1920, height: 900 }, args: ['--disable-background-timer-throttling'] });
await fs.mkdir('.reference', { recursive: true });
await fs.mkdir('pages', { recursive: true });
await fs.mkdir('assets', { recursive: true });
const assets = new Map(JSON.parse(await fs.readFile('.reference/assets.json','utf8').catch(() => '[]')));
const manifest = JSON.parse(await fs.readFile('pages/manifest.json','utf8').catch(() => '{}'));
const references = JSON.parse(await fs.readFile('.reference/pages.json','utf8').catch(() => '{}'));
const originalQueue = [
  ['/', 'welcome'], ['/discover', 'discover'], ['/quests', 'quests'], ['/licensing', 'licensing'],
  ['/vivo_image', 'vivo'], ['/download', 'download'], ['/aboutus', 'about'], ['/blog', 'blog'],
  ...['licensing','contribute','requirements','releases','keywording','content','distribution'].map(x => [`/licensing/${x}`, `licensing-${x}`]),
  ['/terms','terms'], ['/privacy','privacy'], ['/licensing-agreement','licensing-agreement'],
  ['/quest/0cqon9TXhfJ','quest-mountains'], ['/quest/SDjF78KIQrn','quest-light'],
  ['/photo/SDjF7aAGorn','photo-lines'], ['/photo/GXnqPeEIsfv','photo-fire-and-ice'],
  ['/search?q=landscape&type=photos','search'],
];
const queue = process.argv.includes('--final') ? [['/discover','discover'],['/quests','quests'],['/fresh','fresh'],['/editors-picks','editors-picks'],['/vivo_image','vivo'],['/download','download']] : process.argv.includes('--refine') ? [
  ['/', 'welcome'], ['/discover', 'discover'], ['/quests', 'quests'],
  ['/fresh','fresh'], ['/editors-picks','editors-picks'], ['/leaderboard','leaderboard'],
  ['/p/MarcoGrassi','profile'], ['/p/paweluchorczak','profile-pawel'],
  ['/quest/0cqon9TXhfJ','quest-mountains'],
  ['/blog','blog'],
] : originalQueue;

function localAsset(url) {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
  url = url.replaceAll('&amp;', '&');
  const absolute = new URL(url, 'https://500px.com').href;
  if (!assets.has(absolute)) {
    const parsed = new URL(absolute);
    const name = path.basename(parsed.pathname).replace(/[^a-zA-Z0-9._-]/g, '-');
    assets.set(absolute, `/assets/${String(assets.size).padStart(4,'0')}-${name || 'image.jpg'}`);
  }
  return assets.get(absolute);
}

async function capture(route, name) {
  if(name.startsWith('licensing')||name==='grants'){console.log('Licensing uses tools/finish-licensing.mjs');return;}
  if(name==='leaderboard'){console.log('Leaderboard uses tools/capture-leaderboard.mjs');return;}
  if(name==='quests'){console.log('Quests uses finished static fixtures; skipping the virtual-list capture.');return;}
  if(name==='blog'){console.log('Blog uses the inspected ISO reference; preserving the finished local layout.');return;}
  const page = await browser.newPage();
  try {
    await page.goto(`https://500px.com${route === '/discover' ? '/' : route}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => document.body.innerText.length > 180, { timeout: 25000 }).catch(() => {});
    if (name === 'discover') {
      await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Skip')?.click());
      await page.waitForFunction(() => document.images.length >= 15, { timeout: 25000 });
    }
    if (['quests','fresh','editors-picks'].includes(name)) {
      await page.waitForFunction(count => document.images.length >= count, { timeout: 30000 }, name === 'quests' ? 20 : 15).catch(() => {});
    }
    if (name.startsWith('profile')) {
      await page.waitForFunction(() => document.body.innerText.includes('Followers') && document.images.length > 8, {timeout:25000}).catch(() => {});
    }
    await page.waitForFunction(() => !document.querySelector('[role="progressbar"]'), { timeout: 15000 }).catch(() => {});
    await page.evaluate(async () => {
      for (let y = 0; y < Math.min(document.body.scrollHeight, 8000); y += 800) {
        window.scrollTo(0, y);
        await new Promise(resolve => setTimeout(resolve, 120));
      }
      window.scrollTo(0, 0);
      await new Promise(resolve => setTimeout(resolve, 650));
    });
    const data = await page.evaluate(() => {
      const root = document.body.cloneNode(true);
      root.querySelectorAll('script,iframe,noscript,style,link[rel="preload"]').forEach(e => e.remove());
      root.querySelectorAll('.MuiPopover-root,.MuiPopper-root').forEach(e => e.remove());
      root.querySelector('#root')?.removeAttribute('aria-hidden');
      root.querySelectorAll('[data-nav-item="Topnav.More.Membership"]').forEach(e => e.remove());
      root.querySelectorAll('a[href*="/upgrade"]').forEach(e => e.closest('li')?.remove() || e.remove());
      root.querySelectorAll('a[href^="/photo/"]').forEach(a => {
        const card = a.parentElement;
        card.dataset.photoCard = a.getAttribute('href');
      });
      root.querySelectorAll('[onerror],[onclick],[onload]').forEach(e => ['onerror','onclick','onload'].forEach(k => e.removeAttribute(k)));
      const css = [...document.styleSheets].map(s => { try { return [...s.cssRules].map(r => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
      const media = [...document.images].map(i => ({ src:i.currentSrc || i.src,alt:i.alt,width:i.naturalWidth,height:i.naturalHeight }));
      const links = [...document.querySelectorAll('a')].map(a => ({text:a.innerText,href:a.getAttribute('href')}));
      const backgrounds = [...document.querySelectorAll('*')].map(e => getComputedStyle(e).backgroundImage).filter(bg => bg.includes('url('));
      const fonts = [...document.fonts].map(f => ({family:f.family,weight:f.weight}));
      return { html:root.innerHTML, css, media, links, backgrounds, fonts, title:document.title, text:document.body.innerText, url:location.href, htmlClass:document.documentElement.className, bodyClass:document.body.className };
    });
    references[name] = { ...data, html:undefined, css:undefined };
    for (const m of data.media) if (m.src && !m.src.startsWith('data:')) localAsset(m.src);
    let html = data.html.replace(/(?:src|poster)="([^\"]+)"/g, (match,url) => match.replace(url,localAsset(url)));
    html = html.replace(/srcset="([^\"]*)"/g, (match,list) => {
      if(list.startsWith('data:'))return match;
      return `srcset="${list.split(',').map(item=>{const [url,...descriptor]=item.trim().split(/\s+/);return [localAsset(url),...descriptor].join(' ');}).join(', ')}"`;
    });
    html = html.replace(/https:\/\/500px\.com(?=[/"#?])/g, '');
    let css = data.css.replace(/url\(["']?([^\)"']+)["']?\)/g, (_,url) => `url("${localAsset(url)}")`);
    html = html.replace(/url\(&quot;([^&]+)&quot;\)/g, (_,url) => `url(&quot;${localAsset(url)}&quot;)`);
    html = html.replace(/url\((?:&quot;|["'])?([^\)"']+?)(?:&quot;|["'])?\)/g, (all,url) => url.startsWith('/assets/') ? all : `url('${localAsset(url.replaceAll('&amp;','&'))}')`);
    await fs.writeFile(`pages/${name}.css`, css);
    await fs.writeFile(`pages/${name}.html`, `<!doctype html>\n<html lang="en" class="${data.htmlClass}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><meta name="description" content="Discover and share incredible photography. A static 500px website recreation."><title>${data.title}</title><link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/pages/${name}.css"><link rel="stylesheet" href="/styles.css"><script src="/app.js" defer></script></head><body class="${data.bodyClass}" data-page="${name}">${html}</body></html>`);
    manifest[route.split('?')[0]] = name;
    console.log(`Captured ${name}: ${data.media.length} images, ${data.text.length} characters`);
    if (['welcome','discover','licensing','quests','download','photo-lines','quest-mountains','vivo'].includes(name)) {
      await page.screenshot({path:`.reference/${name}.jpg`,type:'jpeg',quality:75,timeout:12000,waitForFonts:false}).catch(e => console.log(`Screenshot skipped: ${name}: ${e.message.split('\n')[0]}`));
    }
  } catch (error) { console.log(`FAILED ${name}: ${error.message.split('\n')[0]}`); }
  finally { await page.close(); }
}

try {
  // Work in small batches so the live site's client and the browser stay responsive.
  for (let i=0; i<queue.length; i+=3) await Promise.all(queue.slice(i,i+3).map(([route,name]) => capture(route,name)));
  await fs.writeFile('.reference/pages.json', JSON.stringify(references,null,2));
  await fs.writeFile('pages/manifest.json', JSON.stringify(manifest,null,2));
  await fs.writeFile('.reference/assets.json', JSON.stringify([...assets],null,2));
} finally { await browser.close(); }

let downloaded = 0;
let failed = 0;
const entries = [...assets];
async function download() {
  while (entries.length) {
    const [url,destination] = entries.shift();
    try {
      try { await fs.access(`.${destination}`); downloaded++; continue; } catch {}
      const response = await fetch(url, {signal:AbortSignal.timeout(25000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await fs.writeFile(`.${destination}`, Buffer.from(await response.arrayBuffer()));
      downloaded++;
    } catch (error) { failed++; console.log(`Asset failed ${destination}: ${error.message}`); }
  }
}
await Promise.all(Array.from({length:8},download));
console.log(`Saved ${Object.keys(manifest).length} routes; ${downloaded} local assets; ${failed} failed assets.`);
