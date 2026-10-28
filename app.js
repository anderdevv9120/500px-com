/* Hard-coded page content, local assets, and browser-local demo interactions. */
const pageName = document.body.dataset.page;
const all = (selector, root = document) => [...root.querySelectorAll(selector)];
const findText = (text, root = document) => all('button,[role="button"],[role="tab"],a', root).find(el => el.textContent.trim() === text);
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const stateKey = '500px-local-demo';
let state;
try { state = JSON.parse(localStorage.getItem(stateKey)) || {}; } catch { state = {}; }
if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
for (const key of ['likes','saved','following','categories']) if (!Array.isArray(state[key])) state[key] = [];
if (!state.comments || typeof state.comments !== 'object') state.comments = {};
const saveState = () => { try { localStorage.setItem(stateKey, JSON.stringify(state)); } catch { /* Browser storage may be unavailable; the current page still works. */ } };
const catalogPromise = fetch('/catalog.json').then(response => { if (!response.ok) throw Error('Photo catalog unavailable'); return response.json(); });
let menu;
let menuTrigger;
let toastTimer;
let lastFocus;
let slideshowTimer;
let photoIndex = 0;
let activePhotos = [];
let gridSize = 'small';
let leaderboardRequest = 0;
const questParams = new URLSearchParams(location.search);

function toast(message) {
  document.querySelector('.local-toast')?.remove();
  const el = document.createElement('div');
  el.className = 'local-toast';
  el.setAttribute('role','status');
  el.textContent = message;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 4000);
}

function reportError(error) {
  console.error(error);
  toast('Could not open this view. Please try again.');
}

function closeMenu() {
  menu?.remove();
  menu = null;
  menuTrigger?.setAttribute('aria-expanded','false');
}

function showMenu(trigger, items) {
  if (menu && menuTrigger === trigger) { closeMenu(); return; }
  closeMenu();
  menuTrigger = trigger;
  trigger.setAttribute('aria-expanded','true');
  menu = document.createElement('div');
  menu.className = 'local-menu';
  menu.setAttribute('role','menu');
  for (const item of items) {
    const element = document.createElement(item.href ? 'a' : 'button');
    element.textContent = item.label;
    element.setAttribute('role','menuitem');
    if (item.href) element.href = item.href;
    else element.addEventListener('click', () => { closeMenu(); Promise.resolve(item.action?.()).catch(reportError); });
    menu.append(element);
  }
  document.body.append(menu);
  const bounds = trigger.getBoundingClientRect();
  menu.style.left = `${Math.max(8,Math.min(bounds.left,innerWidth - menu.offsetWidth - 12))}px`;
  menu.style.top = `${Math.min(bounds.bottom + 9,innerHeight - menu.offsetHeight - 12)}px`;
}

function openDialog(content, className = '') {
  document.querySelector('dialog[open]')?.close();
  closeMenu();
  const dialog = document.createElement('dialog');
  dialog.className = `local-dialog ${className}`;
  dialog.innerHTML = content;
  if (!dialog.querySelector('[aria-label="close"],.local-close')) {
    const close = document.createElement('button');
    close.className = 'local-close';
    close.setAttribute('aria-label','Close dialog');
    close.textContent = '×';
    close.addEventListener('click',() => dialog.close());
    dialog.prepend(close);
  }
  const title = dialog.querySelector('h2');
  if (title) { title.id = 'local-dialog-title'; dialog.setAttribute('aria-labelledby',title.id); }
  lastFocus = document.activeElement;
  document.body.append(dialog);
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => { clearInterval(slideshowTimer); dialog.remove(); lastFocus?.focus(); });
  dialog.showModal();
  return dialog;
}

async function login() {
  if (state.user) { showMenu(findText('My account') || document.querySelector('header button'),[{label:'My profile',href:'/p/MarcoGrassi'},{label:'Upload photos',action:upload},{label:'Log out',action:() => { delete state.user; saveState(); location.reload(); }}]); return; }
  const response = await fetch('/pages/login-fragment.html');
  if (!response.ok) throw Error('Login view unavailable');
  loadFragmentStyles();
  const dialog = openDialog(await response.text(),'local-auth');
  dialog.querySelector('[aria-label="close"]').addEventListener('click',() => dialog.close());
  const form = dialog.querySelector('form');
  const notice = document.createElement('p');
  notice.className = 'auth-notice';
  notice.textContent = 'Local demo. Use any username and a sample password. No credentials are sent or saved.';
  dialog.querySelector('[role="dialog"]').append(notice);
  dialog.querySelectorAll('form').forEach(f => f.action = '#');
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    state.user = {name:'Alex Morgan'};
    saveState();
    dialog.close();
    refreshAccount();
    toast('Welcome to 500px, Alex. You’re signed in to the local demo.');
  });
  const password = dialog.querySelector('input[type="password"]');
  password?.parentElement.querySelector('button')?.addEventListener('click',() => password.type = password.type === 'password' ? 'text' : 'password');
  findText('Forgot password?',dialog)?.addEventListener('click', () => {
    dialog.close();
    const recovery = openDialog('<h2>Reset password</h2><p>Enter your email address to request a password reset.</p><form><label for="recovery-email">Email address</label><input id="recovery-email" type="email" required autocomplete="email"><button class="primary" type="submit">Send reset link</button></form>');
    recovery.querySelector('form').addEventListener('submit',event => { event.preventDefault(); if (event.target.reportValidity()) { recovery.close(); toast('Demo request complete. No email was sent.'); } });
  });
  findText('I have a PULSEpx account',dialog)?.addEventListener('click',() => { notice.textContent = 'Use your sample PULSEpx username in the Account field to continue in this local demo.'; dialog.querySelector('input').focus(); });
  all('a[href]',dialog).forEach(a => { if (/facebook|apple|google/.test(a.href)) a.addEventListener('click',event => { event.preventDefault(); toast('Social sign-in is unavailable in the local demo. Use the form above.'); }); });
}

function loadFragmentStyles() {
  if (document.querySelector('[data-fragment-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = '/pages/fragments.css'; link.dataset.fragmentStyles = '';
  document.head.insertBefore(link,document.querySelector('link[href^="/styles.css"]'));
}

function refreshAccount() {
  if (state.user) all('header button').filter(b => ['Log in','My account'].includes(b.textContent.trim())).forEach(b => b.textContent = 'My account');
  const comment = all('.single-line').find(el => el.textContent.trim() === 'Log in to comment');
  if (state.user && comment) {
    comment.innerHTML = '<form class="local-comment-form"><input aria-label="Add a comment" placeholder="Add a comment…" maxlength="1000" required><button type="submit">Post</button></form>';
    comment.querySelector('form').addEventListener('submit',event => {
      event.preventDefault();
      const input = event.target.querySelector('input');
      const value = input.value.trim();
      if (!value) return;
      const key = location.pathname;
      if (!Array.isArray(state.comments[key])) state.comments[key] = [];
      state.comments[key].push(value);
      saveState(); input.value = ''; renderComments(); toast('Comment posted.');
    });
    renderComments();
  }
}

function renderComments() {
  const panel = document.getElementById('500px-tabpanel-comments');
  if (!panel) return;
  panel.querySelectorAll('.local-new-comment').forEach(el => el.remove());
  for (const message of state.comments[location.pathname] || []) {
    const block = document.createElement('div'); block.className = 'local-new-comment';
    const name = document.createElement('strong'); name.textContent = 'Alex Morgan';
    const text = document.createElement('span'); text.textContent = message;
    block.append(name,text); panel.append(block);
  }
}

function toggleStored(list, key, element, className) {
  const index = state[list].indexOf(key);
  if (index < 0) state[list].push(key); else state[list].splice(index,1);
  saveState();
  element?.classList.toggle(className,index < 0);
  element?.setAttribute('aria-pressed',String(index < 0));
  return index < 0;
}

function layoutGrids() {
  all('[data-masonry-grid]').forEach(grid => {
    const width = grid.parentElement.getBoundingClientRect().width;
    const gap = width < 650 ? 8 : 24;
    const columns = gridSize === 'large' ? (width < 700 ? 1 : width < 1300 ? 2 : 3) : (width < 650 ? 2 : width < 1000 ? 3 : width < 1450 ? 4 : 5);
    const columnWidth = (width - gap * (columns-1)) / columns;
    const heights = Array(columns).fill(0);
    all(':scope > [data-masonry-item]',grid).filter(el => !el.hidden).forEach(wrapper => {
      const column = heights.indexOf(Math.min(...heights));
      const height = columnWidth / (Number(wrapper.dataset.ratio) || 1.5);
      Object.assign(wrapper.style,{position:'absolute',width:`${columnWidth}px`,height:`${height}px`,left:`${column*(columnWidth+gap)}px`,top:`${heights[column]}px`,transform:'none'});
      heights[column] += height + gap;
    });
    grid.style.height = `${Math.max(0,...heights)}px`;
    grid.style.maxHeight = 'none';
  });
}

function photoGrid(photos) {
  return `<div class="local-grid">${photos.map(p => `<a href="${escapeHTML(p.href)}"><img src="${escapeHTML(p.src)}" alt="${escapeHTML(p.title)}" loading="lazy"><p>${escapeHTML(p.title)}</p><small>${escapeHTML(p.author)}</small></a>`).join('')}</div>`;
}

async function lightbox(index = 0, automatic = false, photos) {
  activePhotos = photos || (await catalogPromise).photos;
  if (!activePhotos.length) return;
  photoIndex = (index + activePhotos.length) % activePhotos.length;
  const dialog = openDialog('<img alt=""><div class="lightbox-caption"><button type="button" data-slide="previous" aria-label="Previous photo">←</button><span></span><button type="button" data-slide="next" aria-label="Next photo">→</button></div>','local-lightbox');
  const update = () => { const photo = activePhotos[photoIndex]; const img = dialog.querySelector('img'); img.src = photo.src; img.alt = photo.title; dialog.querySelector('.lightbox-caption span').textContent = `${photo.title} · ${photo.author}`; };
  const move = step => { photoIndex = (photoIndex + step + activePhotos.length) % activePhotos.length; update(); };
  dialog.querySelector('[data-slide="previous"]').addEventListener('click',() => move(-1));
  dialog.querySelector('[data-slide="next"]').addEventListener('click',() => move(1));
  dialog.addEventListener('keydown',event => { if (event.key === 'ArrowRight') move(1); if (event.key === 'ArrowLeft') move(-1); });
  update();
  if (automatic) slideshowTimer = setInterval(() => move(1),5000);
}

async function share(url = location.href) {
  const dialog = openDialog('<h2>Share this photo</h2><p>Share your inspiration with the world.</p><label for="share-url">Link</label><input id="share-url" readonly><button class="primary" style="width:100%;margin-top:20px" data-copy>Copy link</button>');
  dialog.querySelector('input').value = url;
  dialog.querySelector('[data-copy]').addEventListener('click',() => {
    const input = dialog.querySelector('input'); input.select();
    if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(() => toast('Link copied.')).catch(() => toast('Select and copy the link above.'));
    else toast('Select and copy the link above.');
  });
}

async function collect(photo) {
  const key = photo?.href || location.pathname;
  const saved = state.saved.includes(key);
  const dialog = openDialog(`<h2>Save to a gallery</h2><p>Keep your favorite photos together.</p><button class="secondary" style="width:100%;text-align:left" data-save>${saved?'✓ ':''}My favorites</button><label for="gallery-name">Or create a gallery</label><input id="gallery-name" maxlength="60" placeholder="Gallery name"><button class="primary" style="width:100%;margin-top:20px" data-create>Create gallery</button>`);
  dialog.querySelector('[data-save]').addEventListener('click',() => {
    const added = toggleStored('saved',key,null,'');
    all(`[data-photo-card="${CSS.escape(key)}"] [aria-label="collect"]`).forEach(b => b.classList.toggle('local-saved',added));
    dialog.close(); toast(added?'Saved to My favorites.':'Removed from My favorites.');
  });
  dialog.querySelector('[data-create]').addEventListener('click',() => {
    const input = dialog.querySelector('input');
    if (!input.value.trim()) { input.focus(); return; }
    if (!state.saved.includes(key)) state.saved.push(key);
    if (!Array.isArray(state.galleries)) state.galleries = [];
    state.galleries.push({name:input.value.trim(),photos:[key]}); saveState(); dialog.close(); toast('Gallery created and photo saved.');
  });
}

async function upload() {
  if (!state.user) return login();
  const dialog = openDialog('<h2>Upload photos</h2><p>Share your photography with the community.</p><form><label for="upload-file">Choose a photo</label><input id="upload-file" type="file" accept="image/*" required><img class="local-upload-preview" hidden alt="Photo preview"><label for="upload-title">Title</label><input id="upload-title" maxlength="100" required placeholder="Give your photo a title"><label for="upload-category">Category</label><select id="upload-category"><option>Landscape</option><option>City</option><option>People</option><option>Nature</option><option>Still life</option><option>Events</option><option>Sports</option><option>Creative</option></select><button type="submit" class="primary">Publish photo</button></form>');
  let preview;
  dialog.querySelector('input[type="file"]').addEventListener('change',event => {
    const file = event.target.files[0]; if (!file) return;
    if (!file.type.startsWith('image/')) { event.target.value = ''; toast('Choose an image file.'); return; }
    if (preview) URL.revokeObjectURL(preview);
    preview = URL.createObjectURL(file); const img = dialog.querySelector('img'); img.src = preview; img.hidden = false;
  });
  dialog.addEventListener('close',() => { if(preview) URL.revokeObjectURL(preview); });
  dialog.querySelector('form').addEventListener('submit',event => { event.preventDefault(); if(event.target.reportValidity()) { dialog.close(); toast('Photo preview complete. Uploads are not sent in this local demo.'); } });
}

async function questSubmission() {
  if (!state.user) return login();
  const photos = (await catalogPromise).photos.slice(0,9);
  const dialog = openDialog(`<h2>Submit to this Quest</h2><p>Select a photo from your collection.</p><div class="local-selection">${photos.map((p,i) => `<button type="button" aria-label="Select ${escapeHTML(p.title)}" aria-pressed="false" data-select="${i}"><img src="${escapeHTML(p.src)}" alt="${escapeHTML(p.title)}"></button>`).join('')}</div><button class="primary" style="width:100%" data-submit-entry>Submit photo</button>`);
  let selected;
  all('[data-select]',dialog).forEach(button => button.addEventListener('click',() => { selected = button.dataset.select; all('[data-select]',dialog).forEach(b => b.setAttribute('aria-pressed',String(b===button))); }));
  dialog.querySelector('[data-submit-entry]').addEventListener('click',() => { if(selected===undefined) {toast('Select a photo first.');return;} dialog.close(); toast('Your entry has been added to the local demo.'); });
}

function filterQuests(type) {
  if (type==='All') { for(const key of ['QUEST_STATUS','CONTEST_TYPE','IS_FREE','DIFFICULTY','CATEGORY']) questParams.delete(key); }
  else if(type==='Free') { if(questParams.get('IS_FREE')==='true')questParams.delete('IS_FREE');else questParams.set('IS_FREE','true'); }
  else questParams.set('CONTEST_TYPE',{'Juried':'JUDGE','Battles':'PK','Licensing':'LICENSING'}[type]);
  renderQuests();
}

function renderQuests(updateUrl = true) {
  const selected = key => (questParams.get(key)||'').split(/[+,]/).filter(value=>value&&value!=='ALL');
  const cards = all('[data-quest-card]');
  cards.forEach(card=>{
    const data=card.dataset;
    const statuses=data.status==='SUBMISSION_VOTING'?['SUBMISSION','VOTING']:[data.status];
    card.hidden=(selected('QUEST_STATUS').length&&!selected('QUEST_STATUS').some(status=>statuses.includes(status))) ||
      (selected('CONTEST_TYPE').length&&!selected('CONTEST_TYPE').includes(data.type)) ||
      (selected('IS_FREE').length&&!selected('IS_FREE').includes(data.free)) ||
      (selected('DIFFICULTY').length&&!selected('DIFFICULTY').includes(data.difficulty)) ||
      (selected('CATEGORY').length&&!selected('CATEGORY').includes(data.category.toUpperCase().replaceAll(' ','_')));
  });
  const sort=questParams.get('SORT')||'DEFAULT';
  const order=card=>sort==='SUBMIT_START_DESC'?-Date.parse(card.dataset.start):
    sort==='ENDING_SOON'?(card.dataset.status==='COMPLETED'?Infinity:Date.parse(card.dataset.end)):
    sort==='TOTAL_ITEMS_DESC'?Number(card.dataset.joinedOrder):Number(card.dataset.order);
  cards.sort((a,b)=>(order(a)-order(b))||Number(a.dataset.order)-Number(b.dataset.order)).forEach(card=>card.parentElement.append(card));
  const count=cards.filter(card=>!card.hidden).length;
  document.querySelector('.local-quest-empty').hidden=count>0;
  all('[data-quest-filter]').forEach(button=>{
    const type=button.dataset.questFilter;
    const active=type==='Free'?selected('IS_FREE').includes('true'):type==='All'?!selected('CONTEST_TYPE').length:
      selected('CONTEST_TYPE').includes({'Juried':'JUDGE','Battles':'PK','Licensing':'LICENSING'}[type]);
    button.setAttribute('aria-pressed',String(active));
  });
  const activeFilters=['QUEST_STATUS','CONTEST_TYPE','IS_FREE','DIFFICULTY','CATEGORY'].reduce((sum,key)=>sum+Number(selected(key).length>0),0);
  document.querySelector('[data-quest-sort-trigger] p').textContent='Sort & Filter'+(activeFilters?' ('+activeFilters+')':'');
  questParams.set('SORT',sort);
  if(updateUrl)history.replaceState(null,'',location.pathname+'?'+questParams.toString());
}

async function questFilters() {
  const response=await fetch('/pages/quests-filter-fragment.html');
  if(!response.ok)throw Error('Quest filters unavailable');
  const dialog=openDialog(await response.text(),'local-quest-filters');
  dialog.setAttribute('aria-labelledby','quest-filter-title');
  dialog.querySelector('[aria-label="close"]').addEventListener('click',()=>dialog.close());
  let sort=questParams.get('SORT')||'DEFAULT';
  const updateSort=()=>all('[data-quest-sort]',dialog).forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.questSort===sort)));
  all('input[type="checkbox"]',dialog).forEach(input=>{
    input.checked=input.value.split('+').every(value=>(questParams.get(input.name)||'').split(/[+,]/).includes(value));
    input.addEventListener('change',()=>{
      if(!input.checked)return;
      all('input',dialog).filter(other=>other.name===input.name&&other!==input&&(input.value==='ALL'||other.value==='ALL'||input.name==='IS_FREE')).forEach(other=>other.checked=false);
    });
  });
  all('[data-quest-sort]',dialog).forEach(button=>button.addEventListener('click',()=>{sort=button.dataset.questSort;updateSort();}));
  dialog.querySelector('[data-quest-clear]').addEventListener('click',()=>{all('input',dialog).forEach(input=>input.checked=false);sort='DEFAULT';updateSort();});
  dialog.querySelector('[data-quest-confirm]').addEventListener('click',()=>{
    for(const key of ['QUEST_STATUS','CONTEST_TYPE','IS_FREE','DIFFICULTY','CATEGORY']){
      const values=all('input:checked',dialog).filter(input=>input.name===key&&input.value!=='ALL').map(input=>input.value);
      if(values.length)questParams.set(key,values.join(','));else questParams.delete(key);
    }
    questParams.set('SORT',sort);renderQuests();dialog.close();
  });
  updateSort();
}

function initializeQuestCarousel() {
  const carousel=document.querySelector('[data-quest-carousel]');
  const slides=all('[data-quest-slide]',carousel);
  const dots=all('[data-quest-dot]',carousel);
  let index=0;
  const show=next=>{
    index=(next+slides.length)%slides.length;
    slides.forEach((slide,i)=>{slide.setAttribute('aria-hidden',String(i!==index));slide.inert=i!==index;});
    dots.forEach((dot,i)=>{dot.setAttribute('aria-pressed',String(i===index));dot.classList.toggle('embla__dot--selected',i===index);});
  };
  const previous=carousel.querySelector('[data-quest-previous]');
  const next=carousel.querySelector('[data-quest-next]');
  previous.addEventListener('click',()=>show(index-1));
  next.addEventListener('click',()=>show(index+1));
  dots.forEach((dot,i)=>dot.addEventListener('click',()=>show(i)));
  carousel.addEventListener('keydown',event=>{
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();show(index+(event.key==='ArrowRight'?1:-1));}
  });
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
    const timer=setInterval(()=>{if(!document.hidden&&!carousel.matches(':hover,:focus-within')&&!document.querySelector('dialog[open]'))show(index+1);},6000);
    window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
  }
}

async function handleTab(button) {
  const list=button.closest('[role="tablist"]');
  if (!list) return;
  if (pageName==='leaderboard') {
    await renderLeaderboard(button.textContent.trim().toLowerCase());
    document.querySelector('[data-leaderboard-view] [role="tab"][aria-selected="true"]')?.focus({preventScroll:true});
    return;
  }
  all('[role="tab"]',list).forEach(tab=>{const selected=tab===button;tab.setAttribute('aria-selected',String(selected));tab.classList.toggle('Mui-selected',selected);tab.tabIndex=selected?0:-1;});
  const text=button.textContent.trim();
  if (pageName.startsWith('photo-')) {
    const meta=document.getElementById('500px-tabpanel-meta'); const comments=document.getElementById('500px-tabpanel-comments');
    if(text==='Details') {
      loadFragmentStyles();
      if(!meta.dataset.loaded){const response=await fetch('/pages/photo-details-fragment.html');if(!response.ok)throw Error('Details unavailable');meta.innerHTML=await response.text();meta.dataset.loaded='true';}
    }
    if(meta){meta.hidden=text!=='Details';meta.style.display=text==='Details'?'block':'none';}
    if(comments){comments.hidden=text==='Details';comments.style.display=text==='Details'?'none':'block';}
  } else if (pageName.startsWith('quest-')) {
    const panels=all('[role="tabpanel"]');
    panels.forEach((panel,index)=>{const show=text==='Introduction'?index===0:index===1;panel.hidden=!show;panel.style.display=show?'block':'none';});
    if(text!=='Introduction'&&panels[1])panels[1].innerHTML=photoGrid((await catalogPromise).photos.slice(0,24));
  } else if(pageName.startsWith('profile')) {
    const grid=document.querySelector('[data-masonry-outer]');
    let panel=document.querySelector('.local-profile-panel');
    if(!panel){panel=document.createElement('div');panel.className='local-profile-panel';grid?.parentElement.append(panel);}
    if(text.startsWith('Works')){if(grid)grid.hidden=false;panel.hidden=true;layoutGrids();}
    else if(text.startsWith('Galleries')){
      if(grid)grid.hidden=true;panel.hidden=false;
      const photos=(await catalogPromise).photos.slice(0,6);
      panel.innerHTML=`<div class="local-grid">${photos.map((p,i)=>`<a href="/galleries/${i}" class="local-collection-card"><img src="${escapeHTML(p.src)}" alt="${escapeHTML(p.title)}"><span>${['Landscapes','Mountains','Around the world','Light & shadow','Nature','Favorites'][i]}</span></a>`).join('')}</div>`;
    } else {if(grid)grid.hidden=true;panel.hidden=false;const quests=(await catalogPromise).quests;panel.innerHTML=photoGrid(quests.map(q=>({...q,author:'500px Quest'})));}
  }
}

async function handleClick(event) {
  const target=event.target instanceof Element?event.target:null;
  if(!target)return;
  const button=target.closest('button,[role="button"],[role="tab"]');
  const text=button?.textContent.trim()||'';
  const label=button?.getAttribute('aria-label');
  const track=target.closest('[data-track-id]')?.dataset.trackId;
  const contents=target.closest('[data-licensing-toc]');
  if(contents){contents.setAttribute('aria-expanded',String(contents.getAttribute('aria-expanded')!=='true'));return;}
  if(target.closest('[data-licensing-app-close]')){target.closest('.licensing-app-banner').remove();return;}
  if(pageName.startsWith('licensing')&&target.closest('a[href^="/manager/"]')){event.preventDefault();await upload();return;}
  if(pageName==='licensing'&&text==='Get started'){event.preventDefault();await upload();return;}
  if (menu&&!target.closest('.local-menu')&&!target.closest('[aria-expanded="true"]'))closeMenu();
  const rankAction=target.closest('[data-leaderboard-action]');
  if(rankAction){
    event.preventDefault();
    const row=rankAction.closest('[data-leaderboard-photo]');
    const href=row.dataset.leaderboardPhoto;
    if(rankAction.dataset.leaderboardAction==='like'){
      toggleStored('likes',href,rankAction,'local-liked');await renderLeaderboard();
    }else if(rankAction.dataset.leaderboardAction==='save'){
      await collect({href});
      document.querySelector('dialog')?.addEventListener('close',()=>{renderLeaderboard().catch(reportError);},{once:true});
    }else if(rankAction.dataset.leaderboardAction==='comment'){
      if(!state.user){await login();return;}
      const dialog=openDialog('<h2>Comments</h2><div data-rank-comments></div><form><label for="rank-comment">Add a comment</label><textarea id="rank-comment" maxlength="1000" required></textarea><button class="primary" type="submit">Post comment</button></form>');
      const comments=dialog.querySelector('[data-rank-comments]');
      for(const message of state.comments[href]||[]){const p=document.createElement('p');p.textContent=message;comments.append(p);}
      dialog.querySelector('form').addEventListener('submit',event=>{
        event.preventDefault();const input=dialog.querySelector('textarea');const message=input.value.trim();if(!message)return;
        if(!Array.isArray(state.comments[href]))state.comments[href]=[];
        state.comments[href].push(message);saveState();const p=document.createElement('p');p.textContent=message;comments.append(p);input.value='';
      });
    }else showMenu(rankAction,[{label:'Share',action:()=>share(new URL(href,location.origin).href)},{label:'Save to gallery',action:()=>collect({href})},{label:'Report photo',action:()=>toast('Report received in the local demo.')}]);
    return;
  }
  if (target.closest('header')&&['Inspiration','Licensing','More','Toggle navigation'].includes(label)) {
    event.preventDefault();
    const items=label==='Inspiration'?[{label:'For You',href:'/discover'},{label:'Fresh Picks',href:'/fresh'},{label:"Editors’ Choice",href:'/editors-picks'},{label:'Top Ranked',href:'/leaderboard'}]:label==='Licensing'?[{label:'About Licensing',href:'/licensing/licensing'},{label:'Become a Contributor',href:'/licensing/contribute'},{label:'Submission Requirements',href:'/licensing/requirements'},{label:'Content Types',href:'/licensing/content'},{label:'Content Distribution',href:'/licensing/distribution'},{label:'Commercial Grants',href:'/grants'}]:[{label:'Inspiration',href:'/discover'},{label:'Quests',href:'/quests'},{label:'Licensing',href:'/licensing'},{label:'vivo X500',href:'/vivo_image'},{label:'About Us',href:'/aboutus'},{label:'Blog',href:'/blog'},{label:'Download the app',href:'/download'},{label:'Upload',action:upload}];
    showMenu(button,items);return;
  }
  if(target.closest('header')&&['Photos','Users','Galleries','Quests'].includes(text)){
    showMenu(button,['Photos','Users','Galleries','Quests'].map(type=>({label:type,action:()=>{button.childNodes[0].textContent=type;button.dataset.searchType=type.toLowerCase();}})));return;
  }
  if(['Log in','Sign up','Get started','My account','Log in to comment','Try free for 30 days'].includes(text)||target.closest('.single-line')?.textContent.trim()==='Log in to comment') {event.preventDefault();await login();return;}
  if(['Get Started','Join the Program','Apply Now','Apply now','Join now'].includes(text)){event.preventDefault();await login();return;}
  if(track==='onboarding_skip'){
    state.exploring=true;saveState();location.assign('/discover');return;
  }
  const category=target.closest('.photo-container[role="button"]');
  if(category){
    const name=category.querySelector(':scope > span:last-child')?.textContent.trim()||category.textContent.trim().split('\n').pop();
    const selected=category.getAttribute('aria-pressed')==='true';
    if(!selected&&state.categories.length===4){toast('Choose up to 4 categories.');return;}
    toggleStored('categories',name,category,'local-category-selected');
    category.setAttribute('aria-pressed',String(!selected));
    const heading=document.querySelector('h1');if(heading)heading.textContent=`Select categories (${state.categories.length}/4)`;
    const skip=document.querySelector('[data-track-id="onboarding_skip"]');if(skip)skip.textContent=state.categories.length?'Continue':'Skip';
    return;
  }
  if(track==='share_btn'||label==='share'){event.preventDefault();await share();return;}
  if(label==='large grid'||label==='small grid'){gridSize=label.split(' ')[0];all('button[aria-label$="grid"]').forEach(b=>b.classList.toggle('local-active',b===button));layoutGrids();return;}
  if(text==='Slideshow'){showMenu(button,[{label:'Start slideshow',action:()=>lightbox(0,true)},{label:'View full screen',action:()=>lightbox()}]);return;}
  if(['For You','Fresh'].includes(text)&&button?.getAttribute('role')==='button'){location.assign(text==='Fresh'?'/fresh':'/discover');return;}
  const photoCard=target.closest('[data-photo-card]');
  const photoKey=photoCard?.dataset.photoCard||location.pathname;
  if(track==='collect_btn'||label==='collect'){event.preventDefault();event.stopPropagation();await collect(photoCard?{href:photoKey}:null);return;}
  if(label==='Like photo'||button?.dataset.like!==undefined||(pageName.startsWith('photo-')&&button&&!label&&!text&&!button.closest('header,dialog'))){
    event.preventDefault();toggleStored('likes',photoKey,button,'local-liked');return;
  }
  if(label==='more'||label==='more options'||track==='more_menu_btn'||track==='comment_more_btn'){
    event.preventDefault();showMenu(button||target,[{label:'Share',action:share},{label:'Save to gallery',action:()=>collect({href:photoKey})},{label:'Report photo',action:()=>toast('Report received in the local demo.')}]);return;
  }
  if(text==='Follow'||text==='Following'){
    const key=location.pathname;const following=toggleStored('following',key,button,'local-active');button.textContent=following?'Following':'Follow';return;
  }
  if(label==='Repost'||track==='repost_btn'){event.preventDefault();if(!state.user)await login();else toast('Reposted to your local profile.');return;}
  if(track==='creator_avatar'&&!target.closest('a')){const author=target.closest('[data-track-id="creator_avatar"]')?.textContent||'';location.assign(author.includes('Paweł')?'/p/paweluchorczak':'/p/MarcoGrassi');return;}
  if(track==='comment_reply'||text==='Reply'){if(!state.user)await login();else document.querySelector('.local-comment-form input')?.focus();return;}
  if(text==='Like'){button.classList.toggle('local-liked');return;}
  if(button?.getAttribute('role')==='tab'){await handleTab(button);return;}
  const questFilter=target.closest('[data-quest-filter]');if(questFilter){filterQuests(questFilter.dataset.questFilter);return;}
  if(target.closest('[data-quest-sort-trigger]')){await questFilters();return;}
  if(pageName==='quests'&&label==='Sign up'){await login();return;}
  if(pageName.startsWith('quest-')&&['Submit','Join Now','Vote'].includes(text)){await questSubmission();return;}
  if(pageName==='quests'&&['Submit','Vote'].includes(text)){await questSubmission();return;}
  if(text==='Filters'&&pageName==='search'){searchFilters();return;}
  if(text==='Relevance'&&pageName==='search'){showMenu(button,[{label:'Relevance',action:()=>sortSearch(false)},{label:'Most liked',action:()=>sortSearch(true)},{label:'Newest',action:()=>sortSearch(true)}]);return;}
  if(text==='View Cover'){const photos=(await catalogPromise).photos;await lightbox(0,false,photos);return;}
  if(text==='More'&&pageName.startsWith('profile')){const p=all('p').find(e=>e.textContent.includes('Marco Grassi is'));if(p){p.style.maxHeight='none';p.style.webkitLineClamp='unset';button.hidden=true;}return;}
  if(pageName.startsWith('photo-')&&target.tagName==='IMG'&&target.alt&&target.getBoundingClientRect().width>300){const photos=(await catalogPromise).photos;const photo=photos.find(p=>p.href===location.pathname)||{src:target.src,title:target.alt,author:all('[data-track-id="creator_avatar"]')[0]?.textContent||''};await lightbox(0,false,[photo]);return;}
  const link=target.closest('a');
  if(link?.getAttribute('href')?.startsWith('/galleries/')){event.preventDefault();const photos=(await catalogPromise).photos;openDialog(`<h2>Gallery</h2>${photoGrid(photos.slice(Number(link.pathname.split('/').pop())*6,Number(link.pathname.split('/').pop())*6+6))}`);return;}
  if(text==='Customer Support'||label==='Open customer service'){openDialog('<h2>How can we help?</h2><p>Explore the Licensing guides for submission requirements, releases, and distribution.</p><a class="local-primary" href="/licensing">Visit Licensing guides</a>');}
}

function searchFilters() {
  const dialog=openDialog('<h2>Filters</h2><form><label for="search-category">Category</label><select id="search-category"><option>All categories</option><option>Landscape</option><option>Nature</option><option>People</option><option>City</option></select><label for="search-orientation">Orientation</label><select id="search-orientation"><option>All orientations</option><option>Landscape</option><option>Portrait</option><option>Square</option></select><button class="primary" type="submit">Apply filters</button></form>');
  dialog.querySelector('form').addEventListener('submit',event=>{
    event.preventDefault();const orientation=dialog.querySelector('#search-orientation').value;
    all('[data-masonry-item]').forEach(item=>{const image=item.querySelector('img');const ratio=image?.naturalWidth&&image?.naturalHeight?image.naturalWidth/image.naturalHeight:Number(item.dataset.ratio);item.hidden=orientation==='Landscape'?ratio<=1.1:orientation==='Portrait'?ratio>=.9:orientation==='Square'?ratio<.9||ratio>1.1:false;});
    layoutGrids();dialog.close();
  });
}

function sortSearch(reverse) {
  all('[data-masonry-grid]').forEach(grid=>{const items=all(':scope > [data-masonry-item]',grid);if(reverse)items.reverse();items.forEach(item=>grid.append(item));});layoutGrids();
}

async function initialize() {
  all('header a[href="/"]').forEach(a=>a.setAttribute('aria-label',a.textContent.trim()||'500px home'));
  all('.ReactVirtualized__Grid__innerScrollContainer').filter(grid=>grid.querySelector('[data-photo-card]')).forEach(grid=>{
    const cards=all('[data-photo-card]',grid);
    const wrappers=cards.map(card=>{
      const wrapper=document.createElement('div');wrapper.dataset.masonryItem='';
      const img=card.querySelector('img');
      wrapper.dataset.ratio=img?.naturalWidth&&img?.naturalHeight?img.naturalWidth/img.naturalHeight:Number(card.parentElement.dataset.ratio)||1.5;
      wrapper.append(card);return wrapper;
    });
    grid.replaceChildren(...wrappers);grid.dataset.masonryGrid='';grid.parentElement.dataset.masonryOuter='';
  });
  all('[data-masonry-grid]').forEach(grid=>{
    const host=grid.parentElement.parentElement;
    host.dataset.masonryHost='';
    all(':scope > div',grid).forEach(wrapper=>{
      if(!wrapper.querySelector('img'))return;
      if(!wrapper.hasAttribute('data-masonry-item')){wrapper.dataset.masonryItem='';wrapper.dataset.ratio=parseFloat(wrapper.style.width)/parseFloat(wrapper.style.height)||1.5;}
    });
    all(':scope > [data-masonry-item]',grid).sort((a,b)=>parseFloat(a.style.top)-parseFloat(b.style.top)||parseFloat(a.style.left)-parseFloat(b.style.left)).forEach(el=>grid.append(el));
    const observer=new ResizeObserver(layoutGrids);observer.observe(grid.parentElement);
  });
  if(pageName==='quests'){
    renderQuests();
    initializeQuestCarousel();
    document.querySelector('[data-quest-app-close]')?.addEventListener('click',event=>event.currentTarget.closest('.quest-app-banner').remove());
  }
  all('.MuiSkeleton-root,.resize-triggers').forEach(el=>el.remove());
  all('[data-quests-filter-bar]').forEach(bar=>{if(bar.firstElementChild)bar.firstElementChild.style.flexWrap='wrap';});
  layoutGrids();
  all('header input[type="search"]').forEach(input=>{
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();const query=input.value.trim();if(query){const type=input.closest('header').querySelector('[data-search-type]')?.dataset.searchType||'photos';location.assign(`/search?q=${encodeURIComponent(query)}&type=${type}`);}}});
  });
  all('[data-photo-card]').forEach(card=>{const key=card.dataset.photoCard;if(state.likes.includes(key))card.querySelector('[data-like]')?.classList.add('local-liked');if(state.saved.includes(key))card.querySelector('[aria-label="collect"]')?.classList.add('local-saved');});
  if(pageName==='welcome'){
    if(state.exploring){location.replace('/discover');return;}
    all('.photo-container[role="button"]').forEach(card=>{const name=card.querySelector(':scope > span:last-child')?.textContent.trim();if(state.categories.includes(name))card.setAttribute('aria-pressed','true');});
    const heading=document.querySelector('h1');if(heading)heading.textContent=`Select categories (${state.categories.length}/4)`;
  }
  if(state.following.includes(location.pathname)){const button=findText('Follow');if(button)button.textContent='Following';}
  if(pageName.startsWith('photo-')){
    const photo=(await catalogPromise).photos.find(p=>p.href===location.pathname);
    if(photo&&!['/photo/SDjF7aAGorn','/photo/GXnqPeEIsfv'].includes(location.pathname)){
      const image=all('img').find(i=>i.alt==='Lines'||i.alt==='Feu et glace.');
      if(image){image.src=photo.src;image.alt=photo.title;image.removeAttribute('data-src');}
      const title=all('span').find(s=>s.textContent==='Lines'||s.textContent==='Feu et glace.');if(title)title.textContent=photo.title;
      const author=all('[data-track-id="creator_avatar"]').find(el=>el.tagName==='SPAN');if(author)author.textContent=photo.author;
      all('span').filter(s=>['Slovenia','Opole, Polska'].includes(s.textContent)).forEach(s=>s.textContent='');
      document.title=`${photo.title} by ${photo.author} | 500px`;
    }
    all('[role="tabpanel"]').forEach(panel=>{if(panel.id==='500px-tabpanel-meta')panel.hidden=true;});
    all('.MuiSkeleton-root').forEach(el=>el.remove());
    const like=all('button').find(b=>!b.closest('header')&&!b.getAttribute('aria-label')&&!b.textContent.trim());
    if(like){like.setAttribute('aria-label','Like photo');like.dataset.like='';like.classList.toggle('local-liked',state.likes.includes(location.pathname));}
    const author=all('[data-track-id="creator_avatar"]').find(el=>el.tagName==='SPAN');
    if(author)author.parentElement.parentElement.parentElement.dataset.photoAuthorHeader='';
  }
  if(pageName.startsWith('quest-')&&location.pathname!=='/quest/0cqon9TXhfJ'&&location.pathname!=='/quest/SDjF78KIQrn'){
    const quest=(await catalogPromise).quests.find(q=>q.href===location.pathname);
    if(quest){all('*').filter(el=>!el.children.length&&el.textContent==='Monumental Mountains').forEach(el=>el.textContent=quest.title);document.title=`${quest.title} | 500px Quests`;}
  }
  if(pageName==='search'){
    const params=new URLSearchParams(location.search);const query=params.get('q')||'landscape';
    all('header input[type="search"]').forEach(input=>input.value=query);
    document.title=`${query} photos | 500px`;
    const type=params.get('type');
    if(type&&type!=='photos'){
      const grid=document.querySelector('[data-masonry-outer]');if(grid){grid.hidden=true;const view=document.createElement('div');view.innerHTML=type==='users'?'<div class="local-grid"><a href="/p/MarcoGrassi"><h2>Marco Grassi</h2><p>Landscape photographer · Italy</p></a><a href="/p/paweluchorczak"><h2>Paweł Uchorczak</h2><p>Landscape photographer · Poland</p></a></div>':photoGrid((await catalogPromise).photos.slice(0,12));grid.parentElement.append(view);}
    }
  }
  if(pageName==='leaderboard')await renderLeaderboard();
  if(pageName==='grants'){
    const observer=new IntersectionObserver(entries=>{
      const current=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>b.intersectionRect.height-a.intersectionRect.height)[0];
      if(!current)return;
      all('[data-grant-target]').forEach(link=>{
        const selected=link.dataset.grantTarget===current.target.id;
        if(selected)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');
      });
    },{rootMargin:'-140px 0px -50% 0px'});
    all('[data-grant-section]').forEach(section=>observer.observe(section));
  }
  if(pageName==='blog')await renderBlog();
  refreshAccount();
  if(['/login','/signup'].includes(location.pathname))await login();
  if(['/upload','/manager/works','/manager/licensing'].includes(location.pathname))await upload();
}

async function renderLeaderboard(period = document.querySelector('[data-leaderboard-view]')?.dataset.leaderboardView || 'weekly') {
  const request=++leaderboardRequest;
  const view=document.querySelector('[data-leaderboard-view]');
  if(!view||!['weekly','monthly'].includes(period))return;
  if(view.dataset.leaderboardView!==period){
    const response=await fetch(`/pages/leaderboard-${period}-fragment.html`);
    if(!response.ok)throw new Error('Leaderboard unavailable');
    const html=await response.text();if(request!==leaderboardRequest)return;
    const template=document.createElement('template');template.innerHTML=html;view.replaceWith(template.content);
  }
  all('[data-leaderboard-photo]').forEach(row=>{
    const href=row.dataset.leaderboardPhoto;
    for(const[action,list,className]of [['like','likes','local-liked'],['save','saved','local-saved']]){
      const control=row.querySelector(`[data-leaderboard-action="${action}"]`);
      if(!control)continue;
      const active=state[list].includes(href);control.classList.toggle(className,active);control.setAttribute('aria-pressed',String(active));
      const count=control.querySelector('[data-leaderboard-count]');if(count)count.textContent=Number(count.dataset.originalCount)+(active?1:0);
    }
  });
}

async function renderBlog() {
  document.title='500px Blog | Photography, Inspiration & Community';
  const photos=(await catalogPromise).photos;
  const articles=[['Finding your photographic voice','A fresh perspective starts with the way you see.'],['The art of landscape photography','Explore light, composition, and the landscapes that inspire us.'],['Meet the 500px community','Discover the photographers behind extraordinary images.'],['A guide to Licensing your photos','Turn your best photography into new opportunities.'],['Small details. Extraordinary stories.','See familiar places through a different lens.'],['The power of black and white','Let light and form tell the story.']];
  const main=document.createElement('main');main.className='local-blog';
  const slug=location.pathname.split('/')[2];
  if(slug){
    const index=Math.max(0,articles.findIndex(a=>a[0].toLowerCase().replace(/[^a-z0-9]+/g,'-')===slug));const article=articles[index];
    main.innerHTML=`<article><a href="/blog" style="color:#aaa">← All stories</a><p>500px Blog · Photography</p><h1>${article[0]}</h1><img src="${escapeHTML(photos[index].src)}" alt="${escapeHTML(photos[index].title)}"><p>${article[1]}</p><p>Every photograph begins with a moment of attention. Notice the direction of the light, the relationships between shapes, and the details that make a scene your own.</p><p>Try a new point of view. Return to a familiar location at a different time of day. Give yourself time to experiment, and share the photographs that tell your story.</p><p>Explore the work of the 500px community and find inspiration for your next photograph.</p><a class="local-primary" href="/discover">Explore photography</a></article>`;
  }else main.innerHTML=`<h1>The 500px Blog</h1><p style="color:#999">Photography. Inspiration. Community.</p><div class="local-grid">${articles.map((a,i)=>`<a href="/blog/${a[0].toLowerCase().replace(/[^a-z0-9]+/g,'-')}"><img src="${escapeHTML(photos[i].src)}" alt="${escapeHTML(photos[i].title)}"><small>PHOTOGRAPHY</small><h2>${a[0]}</h2><p>${a[1]}</p></a>`).join('')}</div>`;
  document.querySelector('#root').append(main);
}

document.addEventListener('click',event=>{handleClick(event).catch(reportError);});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    closeMenu();
    const contents=document.querySelector('[data-licensing-toc][aria-expanded="true"]');
    if(contents&&!document.querySelector('dialog[open]')){contents.setAttribute('aria-expanded','false');contents.focus();}
    return;
  }
  if(pageName==='leaderboard'&&event.target.matches('[role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();const tabs=all('[role="tab"]',event.target.closest('[role="tablist"]'));
    const index=event.key==='Home'?0:event.key==='End'?tabs.length-1:(tabs.indexOf(event.target)+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    tabs[index]?.click();return;
  }
  if(menu&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const items=all('[role="menuitem"]',menu);const index=items.indexOf(document.activeElement);items[(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();return;}
  if(['Enter',' '].includes(event.key)&&event.target.matches('[role="button"]:not(button),[role="tab"]:not(button)')){event.preventDefault();event.target.click();}
});
initialize().catch(reportError);
