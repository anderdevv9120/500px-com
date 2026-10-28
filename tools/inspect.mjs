import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {puppeteer}=await import(pathToFileURL(process.env.PUPPETEER_MODULE).href);
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,defaultViewport:{width:1920,height:900}});
try {
  for (const [name,url,action] of [
    ['login','https://500px.com/','Log in'],
    ['photo-details','https://500px.com/photo/SDjF7aAGorn','Details'],
    ['quest-entries','https://500px.com/quest/0cqon9TXhfJ','All Entries'],
    ['profile','https://500px.com/p/MarcoGrassi','About'],
    ['feed','https://500px.com/',null],
  ]) {
    const page=await browser.newPage();
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForFunction(()=>document.body.innerText.length>200,{timeout:20000}).catch(()=>{});
    if(name==='feed') {
      await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Skip')?.click());
      await page.waitForFunction(()=>document.images.length>10,{timeout:25000}).catch(()=>{});
    }
    if(action) {
      await page.waitForFunction(text=>[...document.querySelectorAll('button,[role="tab"],[role="button"]')].some(b=>b.textContent.trim()===text),{timeout:25000},action).catch(()=>{});
      await page.evaluate(text=>[...document.querySelectorAll('button,[role="tab"],[role="button"]')].find(b=>b.textContent.trim()===text)?.click(),action);
      await new Promise(r=>setTimeout(r,1500));
    }
    const data=await page.evaluate(()=>({text:document.body.innerText,html:document.body.innerHTML,css:[...document.styleSheets].map(s=>{try{return[...s.cssRules].map(r=>r.cssText).join('\n')}catch{return''}}).join('\n'),targets:[...document.querySelectorAll('button,[role="button"],[role="tab"],input,[data-track-id]')].map(e=>({tag:e.tagName,text:e.innerText?.slice(0,70),label:e.getAttribute('aria-label'),role:e.getAttribute('role'),type:e.getAttribute('type'),track:e.getAttribute('data-track-id'),cls:e.className})),photos:[...document.querySelectorAll('a[href^="/photo/"]')].slice(0,3).map(a=>({html:a.parentElement.outerHTML,ancestors:[a.parentElement.className,a.parentElement.parentElement.className,a.parentElement.parentElement.parentElement.className]}))}));
    await fs.writeFile(`.reference/inspect-${name}.json`,JSON.stringify(data,null,2));
    console.log(name,JSON.stringify({text:data.text.slice(-3400),targets:data.targets.slice(-22),photos:data.photos.map(p=>p.ancestors)}));
    if(name==='login')await page.screenshot({path:'.reference/login.jpg',type:'jpeg',quality:80,waitForFonts:false,timeout:12000}).catch(()=>{});
    await page.close();
  }
}finally{await browser.close();}
