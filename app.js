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
const catalogPromise = fetch('/catalog.json?v=quest-licensing-1').then(response => { if (!response.ok) throw Error('Photo catalog unavailable'); return response.json(); });
let galleriesPromise;
const galleries = () => galleriesPromise ||= fetch('/pages/galleries.json').then(response => { if (!response.ok) throw Error('Galleries unavailable'); return response.json(); });
let galleryPhotos = [];
const isGuestProfile = pageName.startsWith('profile') && location.pathname.replace(/\/$/, '').endsWith('/p/guest');
let menu;
let menuTrigger;
let menuCloseTimer;
let toastTimer;
let lastFocus;
let slideshowTimer;
let photoIndex = 0;
let activePhotos = [];
let gridSize = 'small';
let leaderboardRequest = 0;
const questParams = new URLSearchParams(location.search);

const uploadApi = ['localhost','127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:8787' : 'https://500px-guest-uploads.lamdan0901.workers.dev';
const uploadLimits = {'image/jpeg':20,'image/png':20,'image/webp':20,'image/gif':20,'image/avif':20,'video/mp4':95,'video/webm':95,'video/quicktime':95};
const uploadDown = 'Uploads are unavailable right now';

// path has no leading slash: export-pages rebase() prefixes root-relative literals with the Pages base path
async function api(path, options) {
  let response;
  try { response = await fetch(`${uploadApi}/${path}`, options); } catch { throw Error(uploadDown); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(body.error || uploadDown), {status: response.status});
  return body;
}

function clientCheck(file) {
  if (/^image\/hei[cf]$/.test(file.type) || /\.hei[cf]$/i.test(file.name)) return "HEIC isn't supported — export as JPEG.";
  const mb = uploadLimits[file.type];
  if (!mb) return 'Unsupported file type.';
  if (!file.size) return 'File is empty.';
  return file.size > mb * 1024 * 1024 ? `Too large (max ${mb} MB).` : null;
}

// Drops APP1 (EXIF/XMP) segments that precede the scan data, so GPS never leaves the browser, then re-adds a minimal
// EXIF APP1 holding only a non-default Orientation so portraits stay upright. Non-JPEG input passes through unchanged.
function stripJpegExif(buffer) {
  const b = new Uint8Array(buffer), view = new DataView(buffer);
  if (b[0] !== 0xFF || b[1] !== 0xD8) return new Blob([b]);
  const parts = [b.subarray(0, 2)];
  let i = 2, orientation = 1, le = false;
  while (i + 4 <= b.length && b[i] === 0xFF && b[i + 1] !== 0xFF && b[i + 1] !== 0xDA) {
    const end = i + 2 + ((b[i + 2] << 8) | b[i + 3]);
    if (b[i + 1] !== 0xE1) parts.push(b.subarray(i, end));
    else if (orientation === 1 && String.fromCharCode(...b.subarray(i + 4, i + 8)) === 'Exif') try {
      const tiff = i + 10, ifd = tiff + view.getUint32(tiff + 4, le = b[tiff] === 0x49);
      for (let n = view.getUint16(ifd, le), entry = ifd + 2; n-- > 0; entry += 12) if (view.getUint16(entry, le) === 0x0112) { const value = view.getUint16(entry + 8, le); if (value > 1 && value < 9) orientation = value; }
    } catch { /* malformed EXIF is dropped */ }
    i = end;
  }
  if (orientation > 1) {
    // APP1 = "Exif\0\0", TIFF header in the original byte order, IFD0 with one Orientation SHORT entry, no next IFD.
    const segment = new Uint8Array(36), out = new DataView(segment.buffer);
    segment.set([0xFF, 0xE1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, le ? 0x49 : 0x4D, le ? 0x49 : 0x4D]);
    out.setUint16(12, 42, le); out.setUint32(14, 8, le); out.setUint16(18, 1, le);
    out.setUint16(20, 0x0112, le); out.setUint16(22, 3, le); out.setUint32(24, 1, le); out.setUint16(28, orientation, le);
    parts.splice(1, 0, segment);
  }
  parts.push(b.subarray(i));
  return new Blob(parts);
}

async function putMedia(albumId, file, {title, author}, onProgress) {
  const body = file.type === 'image/jpeg' ? stripJpegExif(await file.arrayBuffer()) : file;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${uploadApi}/api/albums/${encodeURIComponent(albumId)}/media?${new URLSearchParams({title, author})}`);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    xhr.onerror = () => reject(Error(uploadDown));
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON error body */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(Error(data.error || uploadDown));
    };
    xhr.send(body);
  });
}

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
  clearTimeout(menuCloseTimer);
  const closing = menu;
  if (!closing) return;
  const css = getComputedStyle(closing);
  const opacity = css.opacity;
  const transform = css.transform;
  closing.getAnimations().forEach(animation => animation.cancel());
  closing.inert = true;
  closing.setAttribute('aria-hidden','true');
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Number(closing.dataset.duration);
  const timing = {duration, easing:'cubic-bezier(0.4, 0, 0.2, 1)', fill:'forwards'};
  const fade = closing.animate([{opacity},{opacity:0}],timing);
  closing.animate([{transform},{transform:'scale(0.75, 0.5625)'}],{...timing,duration:duration*2/3,delay:duration/3});
  fade.addEventListener('finish',() => closing.remove(),{once:true});
  menu = null;
  menuTrigger?.setAttribute('aria-expanded','false');
  menuTrigger = null;
}

function showMenu(trigger, items) {
  if (menu && menuTrigger === trigger) { closeMenu(); return; }
  closeMenu();
  menuTrigger = trigger;
  trigger.setAttribute('aria-haspopup','menu');
  trigger.setAttribute('aria-expanded','true');
  menu = document.createElement('div');
  menu.className = 'local-menu';
  if (trigger.closest('header')) menu.classList.add('local-header-menu');
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
  const region = trigger.closest('[data-nav-item]');
  const bounds = (region || trigger).getBoundingClientRect();
  if (region) menu.style.minWidth = `${Math.round(bounds.width)}px`;
  menu.style.left = `${Math.max(8,Math.min(bounds.left,innerWidth - menu.offsetWidth - 12))}px`;
  menu.style.top = `${Math.min(bounds.bottom + (region ? 12 : 9),innerHeight - menu.offsetHeight - 12)}px`;
  const height = menu.offsetHeight / 36;
  // Match the reference's height-based Material UI Grow timing.
  const duration = Math.round((4 + 15 * height ** .25 + height / 5) * 10);
  menu.dataset.duration = duration;
  const timing = {duration:matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration,easing:'cubic-bezier(0.4, 0, 0.2, 1)'};
  menu.animate([{opacity:0},{opacity:1}],timing);
  menu.animate([{transform:'scale(0.75, 0.5625)'},{transform:'scale(1)'}],{...timing,duration:timing.duration*2/3});
  if (trigger.closest('header') && trigger.getAttribute('aria-label') !== 'Toggle navigation') {
    menu.addEventListener('pointerenter',() => clearTimeout(menuCloseTimer));
    menu.addEventListener('pointerleave',scheduleMenuClose);
  }
  menu.addEventListener('focusout',event => {
    if (!menu?.contains(event.relatedTarget) && event.relatedTarget !== menuTrigger) closeMenu();
  });
}

function scheduleMenuClose(event) {
  if (event.pointerType !== 'mouse') return;
  clearTimeout(menuCloseTimer);
  menuCloseTimer = setTimeout(() => {
    if (!menu?.matches(':hover,:focus-within') && !menuTrigger?.matches(':hover,:focus-within')) closeMenu();
  },120);
}

function initializeHeaderMenus() {
  const navigation = document.querySelector('header [data-nav-item]')?.parentElement;
  if (navigation) {
    navigation.dataset.headerNavigation = '';
    const highlight = navigation.firstElementChild;
    highlight.dataset.headerHighlight = '';
    const items = all('[data-nav-item]',navigation);
    const path = location.pathname;
    const activeName = /^\/(?:$|discover$|popular$|fresh$|editors-picks$|upcoming$|leaderboard$)/.test(path) ? 'Inspiration' :
      /^\/quests?(?:\/|$)/.test(path) ? 'Quests' : /^\/(?:licensing|grants)(?:\/|$)/.test(path) ? 'Licensing' : path === '/vivo_image' ? 'Vivo' : null;
    const active = items.find(item => item.dataset.navItem === activeName);
    let hovered;
    const updateHighlight = () => {
      const item = hovered || items.find(item => item.querySelector('[aria-expanded="true"]')) || active;
      highlight.style.opacity = item?.offsetWidth ? '1' : '0';
      if (item?.offsetWidth) {
        highlight.style.width = `${item.offsetWidth}px`;
        highlight.style.transform = `translateX(${item.offsetLeft}px)`;
      }
    };
    items.forEach(item => item.addEventListener('pointerenter',event => {
      if (event.pointerType !== 'mouse' || !matchMedia('(hover: hover)').matches) return;
      hovered = item;
      if (menuTrigger?.closest('header') && !item.contains(menuTrigger)) closeMenu();
      updateHighlight();
    }));
    navigation.addEventListener('pointerleave',() => { hovered = null; updateHighlight(); });
    new MutationObserver(updateHighlight).observe(navigation,{subtree:true,attributes:true,attributeFilter:['aria-expanded']});
    new ResizeObserver(updateHighlight).observe(navigation);
    updateHighlight();
  }
  all('header button').filter(button => ['Inspiration','Licensing','More'].includes(button.getAttribute('aria-label')) || ['Photos','Users','Galleries','Quests','My account'].includes(button.textContent.trim())).forEach(trigger => {
    const region = trigger.closest('[data-nav-item]') || trigger;
    trigger.setAttribute('aria-haspopup','menu');
    if (trigger.getAttribute('aria-label') !== 'More' && trigger.querySelector('svg')) trigger.querySelector('svg').dataset.headerChevron = '';
    region.addEventListener('pointerenter',event => {
      if (event.pointerType !== 'mouse' || !matchMedia('(hover: hover)').matches) return;
      clearTimeout(menuCloseTimer);
      if (menuTrigger !== trigger) trigger.click();
    });
    region.addEventListener('pointerleave',scheduleMenuClose);
    trigger.addEventListener('keydown',event => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      if (menuTrigger !== trigger) trigger.click();
      menu?.querySelector('[role="menuitem"]')?.focus();
    });
  });
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
  const update = () => { const photo = activePhotos[photoIndex]; const video = photo.kind === 'video'; const media = document.createElement(video ? 'video' : 'img'); media.src = photo.src; if (video) { media.controls = true; media.playsInline = true; } else media.alt = photo.title; dialog.querySelector('img,video').replaceWith(media); dialog.querySelector('.lightbox-caption span').textContent = `${photo.title} · ${photo.author}`; };
  const move = step => { photoIndex = (photoIndex + step + activePhotos.length) % activePhotos.length; update(); };
  dialog.querySelector('[data-slide="previous"]').addEventListener('click',() => move(-1));
  dialog.querySelector('[data-slide="next"]').addEventListener('click',() => move(1));
  dialog.addEventListener('keydown',event => { if (event.key === 'ArrowRight') move(1); if (event.key === 'ArrowLeft') move(-1); });
  update();
  if (automatic) slideshowTimer = setInterval(() => { const video = dialog.querySelector('video'); if (!video || video.paused || video.ended) move(1); },5000);
}

async function share(url = location.href, title = 'Share this photo') {
  const dialog = openDialog(`<h2>${escapeHTML(title)}</h2><p>Share your inspiration with the world.</p><label for="share-url">Link</label><input id="share-url" readonly><button class="primary" style="width:100%;margin-top:20px" data-copy>Copy link</button>`);
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
  const dialog = openDialog('<h2>Upload photos &amp; videos</h2><p>Photos up to 20 MB · Videos up to 95 MB (temporary limit)</p><form><input id="upload-file" class="upload-input" type="file" accept="image/*,video/*" multiple><label for="upload-file" class="upload-pick">Choose files</label><p class="upload-summary" hidden><span></span><button type="button" class="upload-clear">Clear all</button></p><ul class="upload-files"></ul><fieldset class="upload-mode"><label><input type="radio" name="album-mode" value="new" checked> New album</label><label><input type="radio" name="album-mode" value="existing"> Existing album</label></fieldset><div data-mode="new"><label for="upload-album-title">Album title</label><input id="upload-album-title" maxlength="60" required placeholder="Give your album a title"><label for="upload-album-description">Description (optional)</label><textarea id="upload-album-description" maxlength="280" rows="2"></textarea></div><div data-mode="existing" hidden><label for="upload-album">Album</label><select id="upload-album"></select></div><label for="upload-author">Your name (optional)</label><input id="upload-author" maxlength="40" placeholder="Guest"><button type="submit" class="primary">Upload</button><p class="upload-msg" role="status"></p></form>');
  const form = dialog.querySelector('form'), list = dialog.querySelector('.upload-files'), msg = dialog.querySelector('.upload-msg'), submit = dialog.querySelector('[type="submit"]');
  const [newPane, existingPane] = all('[data-mode]', dialog), select = dialog.querySelector('#upload-album'), existingRadio = dialog.querySelector('[value="existing"]'), titleInput = dialog.querySelector('#upload-album-title');
  const picker = dialog.querySelector('#upload-file'), summary = dialog.querySelector('.upload-summary'), clear = dialog.querySelector('.upload-clear');
  let items = [], blocked = false;
  const say = (text, bad) => { msg.textContent = text; msg.classList.toggle('bad', Boolean(bad)); };
  const setStatus = (item, text, bad) => { Object.assign(item, {text, bad}); item.status.textContent = text; item.row.classList.toggle('bad', Boolean(bad)); };
  const icon = name => `<span class="upload-thumb-icon">${escapeHTML((name.match(/\.([^.]+)$/)?.[1] || 'file').slice(0, 4).toUpperCase())}</span>`;
  const preview = item => item.error ? icon(item.file.name)
    : item.file.type.startsWith('video/') ? `<video class="upload-thumb" src="${item.url}" muted preload="metadata" playsinline></video><span class="upload-play" aria-hidden="true">▶</span>`
    : `<img class="upload-thumb" src="${item.url}" alt="">`;
  const size = bytes => bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  const lock = on => { picker.disabled = clear.disabled = on; all('.upload-remove', list).forEach(button => { button.disabled = on; }); };
  const drop = gone => gone.forEach(item => item.url && URL.revokeObjectURL(item.url));
  const render = () => {
    list.innerHTML = items.map(item => `<li class="upload-row"><span class="upload-preview">${preview(item)}</span>${item.done ? '' : `<button type="button" class="upload-remove" aria-label="Remove ${escapeHTML(item.file.name)}">✕</button>`}<span class="upload-name" title="${escapeHTML(item.file.name)}">${escapeHTML(item.file.name)}</span><span class="upload-size">${size(item.file.size)}</span><span class="upload-status"></span><progress max="1" value="0" hidden aria-label="Upload progress for ${escapeHTML(item.file.name)}"></progress></li>`).join('');
    items.forEach((item, index) => {
      Object.assign(item, {row: list.children[index], status: list.children[index].querySelector('.upload-status'), bar: list.children[index].querySelector('progress')});
      setStatus(item, item.text, item.bad);
      item.row.querySelector('img')?.addEventListener('error', event => { event.target.outerHTML = icon(item.file.name); });
    });
    summary.hidden = !items.length;
    summary.firstChild.textContent = `${items.length} file${items.length === 1 ? '' : 's'} · ${size(items.reduce((sum, item) => sum + item.file.size, 0))}`;
  };
  list.addEventListener('click', event => {
    const row = event.target.closest('.upload-remove')?.closest('.upload-row');
    if (!row) return;
    drop(items.splice([...list.children].indexOf(row), 1)); render();
  });
  clear.addEventListener('click', () => { drop(items); items = []; render(); });
  dialog.addEventListener('close', () => drop(items));
  all('[name="album-mode"]', dialog).forEach(radio => radio.addEventListener('change', () => { const existing = existingRadio.checked; newPane.hidden = existing; existingPane.hidden = !existing; titleInput.required = !existing; }));
  api('api/albums').then(albums => {
    select.innerHTML = albums.map(album => `<option value="${escapeHTML(album.id)}">${escapeHTML(album.title)} (${album.count})</option>`).join('');
    existingRadio.disabled = !albums.length;
  }, error => { blocked = true; submit.disabled = true; existingRadio.disabled = true; say(error.message, true); });
  // each pick appends; the same name + size again is treated as the same file
  picker.addEventListener('change', () => {
    for (const file of picker.files) {
      if (items.some(item => item.file.name === file.name && item.file.size === file.size)) continue;
      const error = clientCheck(file);
      items.push({file, error, url: error ? '' : URL.createObjectURL(file), text: error || 'Ready', bad: Boolean(error)});
    }
    picker.value = '';
    render();
    submit.disabled = blocked; if (!blocked) say('');
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const pending = items.filter(item => !item.done), valid = pending.filter(item => !item.error);
    if (!valid.length) { say('Choose at least one supported photo or video.', true); return; }
    submit.disabled = true; say(''); lock(true);
    let albumId = select.value;
    try {
      if (!existingRadio.checked) albumId = (await api('api/albums', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({title:titleInput.value.trim(), description:dialog.querySelector('#upload-album-description').value.trim()})})).id;
    } catch (error) { say(error.message, true); submit.disabled = blocked; lock(false); return; }
    const author = dialog.querySelector('#upload-author').value.trim();
    let uploaded = 0;
    for (const item of valid) {
      item.bar.hidden = false; item.bar.value = 0; setStatus(item, 'Uploading…');
      try {
        await putMedia(albumId, item.file, {title:item.file.name.replace(/\.[^.]+$/, '').slice(0, 100), author}, fraction => { item.bar.value = fraction; });
        uploaded++; item.done = true; setStatus(item, 'Uploaded');
      } catch (error) { setStatus(item, error.message, true); }
      item.bar.hidden = true;
    }
    render(); lock(false); submit.disabled = blocked;
    // later batches go to the album this one created instead of making a second one
    if (uploaded && !existingRadio.checked) {
      if (![...select.options].some(option => option.value === albumId)) select.insertAdjacentHTML('afterbegin', `<option value="${escapeHTML(albumId)}">${escapeHTML(titleInput.value.trim())}</option>`);
      select.value = albumId; existingRadio.disabled = false; existingRadio.checked = true; existingRadio.dispatchEvent(new Event('change'));
    }
    say(`${uploaded} uploaded, ${pending.length - uploaded} failed`, uploaded < pending.length);
    if (uploaded) { const link = document.createElement('a'); link.href = `/galleries/guest?album=${encodeURIComponent(albumId)}`; link.textContent = 'View album'; msg.append(' · ', link); }
  });
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

async function renderLicensingQuest() {
  const quest=(await catalogPromise).quests.find(q=>q.href===location.pathname.replace(/\/$/,''));
  if(!quest||quest.type!=='LICENSING')throw Error('Licensing Quest unavailable');
  document.title=`${quest.title} | Photography Quests | 500px`;
  const afterHours=quest.href==='/quest/1000005269-after-hours';
  const onTheClock=quest.href==='/quest/1000005271-on-the-clock';
  const stamp=value=>new Date(value).toISOString().slice(0,16).replace('T',' ');
  const description=afterHours?'Explore the character of your surroundings at night.':onTheClock?'Photograph everyday working life in real workplaces.':'Create authentic commercial photography inspired by this Quest’s theme.';
  const brief=afterHours?'Make darkness part of the story. Photograph evening routines, working nights, quiet streets, portraits or landscapes, using the light you find to reveal a different side of familiar places.':onTheClock?'Look beyond staged meetings and business props. Document people carrying out their actual jobs, from workshops and kitchens to healthcare, transport and small businesses.':'Explore the theme through a fresh perspective. Look for believable moments, inclusive stories and photographs that commercial clients can use to connect with their audiences.';
  const shots=afterHours?['People working or travelling late in the evening.','Street scenes shaped by rain, reflections and artificial light.','Portraits using a lamp, window or other available light.','Night markets, neighbourhood shops and places after closing.','Rural landscapes, moonlit settings and outdoor gatherings.','Movement and atmosphere captured in a long exposure.']:onTheClock?['Skilled trades and hands-on work in authentic settings.','Food service, healthcare, education and public transport.','Small businesses, creative studios and repair workshops.','People collaborating naturally on an everyday task.']:['People, places and details that tell a clear story about the theme.','Unposed interactions and everyday experiences.','A range of perspectives, compositions and inclusive subjects.'];
  const keywords=afterHours?'Night, evening, low light, street, reflection, work, travel, moonlight, atmosphere, motion.':onTheClock?'Work, occupation, workplace, people, teamwork, craft, tools, skill, business.':'Use relevant subject, location, activity and concept keywords to describe your photographs.';
  const count=afterHours?'3,520':onTheClock?'1,258':null;
  const prize=afterHours||onTheClock?'1 prize of $50 US':'Cash prizes';
  // shortcut: uncaptured Licensing briefs and award copy are representative; replace after a full reference capture.
  document.querySelector('[data-licensing-quest]').innerHTML=`<div class="licensing-quest-cover"><img data-licensing-quest-hero src="${escapeHTML(quest.src)}" alt="${escapeHTML(quest.title)}">${afterHours?'<span class="licensing-quest-credit">Photo by Michael Anthony Mascorro</span>':''}</div>
    <div class="licensing-quest-summary"><div class="licensing-quest-meta"><span>Juried Contests · Licensing quest</span><a href="/licensing">500px</a><button type="button" class="licensing-quest-share" data-licensing-quest-share aria-label="Share Quest"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M15 3h6v6M21 3 10 14M11 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6"/></svg></button></div>
    <div class="licensing-quest-heading"><h1 data-licensing-quest-title>${escapeHTML(quest.title)}</h1><p>${description}</p><div class="licensing-quest-stats">${count?`<span>Photos: ${count}</span>`:''}<span class="licensing-quest-ended" data-quest-ended>Ended</span></div></div></div>
    ${document.querySelector('#licensing-quest-tabs').innerHTML}
    <div class="licensing-quest-body"><div role="tabpanel" id="licensing-introduction" aria-labelledby="licensing-tab-0" tabindex="0">
    <section><h2>Introduction</h2><p>Licensing Quests offer a creative brief for growing your commercial portfolio, with opportunities to earn a cash award and create photographs for image buyers.</p><p>${brief}</p><p>Enter new uploads that have been submitted for exclusive Licensing through 500px.</p><h3>Suggested Shot List</h3><ul>${shots.map(shot=>`<li>${shot}</li>`).join('')}</ul><h3>Keywords</h3><p>${keywords}</p><h3>What to avoid</h3><ul><li>Visible branding, protected designs and recognizable property without the appropriate release.</li><li>Excessive retouching, unnatural colour effects and technical flaws.</li><li>${afterHours?'Artificially added stars or skies, lost highlight detail and aggressive noise reduction.':'Staged expressions or misleading depictions of the subject.'}</li></ul></section>
    <section data-licensing-schedule><h2>Schedule</h2><dl class="licensing-quest-schedule"><div><dt>Submission</dt><dd>${stamp(quest.start)} ~ ${stamp(quest.end)} (UTC+0)</dd></div><div><dt>Announcement</dt><dd>${afterHours||onTheClock?`${stamp(quest.end)} (UTC+0)`:'Following the submission review'}</dd></div></dl></section>
    <section><h2>Awards</h2><div class="licensing-quest-award" data-licensing-award><strong>${prize}</strong><p>${afterHours||onTheClock?'One selected photographer receives a $50 US cash award.':'Selected photographs are eligible for a cash award.'}</p></div></section>
    <section><h2>Rules</h2><ul><li>Submit new photographs that are accepted for <a href="/licensing/contribute">500px Licensing</a>.</li><li>Provide a <a href="/licensing/releases">model release</a> for each recognizable person.</li><li>Obtain property releases for recognizable private spaces, artwork and tattoos.</li><li>Include accurate location information and relevant keywords.</li><li>Remove logos and branding from the image.</li><li>Keep edits natural and follow the <a href="/licensing/requirements">submission requirements</a>.</li></ul></section></div>
    <div role="tabpanel" id="licensing-entries" aria-labelledby="licensing-tab-1" data-quest-entries tabindex="0" hidden></div></div>`;
}

function mediaFigure(item, index, {lightbox}) {
  const title = escapeHTML(item.title), media = item.kind === 'video' ? `<video src="${escapeHTML(item.src)}" preload="metadata" muted playsinline></video><span class="gallery-play-badge" aria-hidden="true">▶</span>` : `<img src="${escapeHTML(item.src)}" alt="${title}" ${index>5?'loading="lazy"':''}>`;
  return `<figure class="gallery-photo">${lightbox?`<button data-gallery-photo="${index}" aria-label="View ${title}">${media}</button>`:`<a data-gallery-photo="${index}" href="${escapeHTML(item.href)}">${media}</a>`}<figcaption>${lightbox?'':`<strong>${title}</strong>`}${escapeHTML(item.author)}</figcaption></figure>`;
}

async function renderGallery() {
  const id=location.pathname.split('/').filter(Boolean).pop();
  const isGuest=id==='guest';
  const isGrant=location.pathname.startsWith('/gallery/');
  const lightboxMode=isGrant||isGuest;
  const query=new URLSearchParams(location.search);
  const owner=query.get('owner') || 'MarcoGrassi';
  const main=document.querySelector('[data-gallery]');
  const notFound=message=>{document.title='Gallery not found | 500px';main.innerHTML=`<h1>Gallery not found</h1><p>${message}</p><a class="gallery-back" href="/discover">Explore photography</a>`;};
  let profile=null,gallery;
  if(isGuest){
    // Seeded galleries never touch the Worker; only this branch does.
    try{
      const album=query.get('album')?await api(`api/albums/${encodeURIComponent(query.get('album'))}`):null;
      if(album?.media.length)gallery={title:album.title,description:album.description,photos:album.media.map(m=>({src:m.url,title:m.title,author:m.author,kind:m.kind}))};
    }catch(error){
      if(error.status!==404){notFound('Guest uploads are unavailable right now.');return;}
    }
  }else{
    const data=await galleries();
    profile=Object.hasOwn(data.profiles,owner)?data.profiles[owner]:null;
    gallery=isGrant?data.grants.find(g=>g.id===id):profile?.galleries.find(g=>g.id===id);
  }
  if(!gallery){notFound('This gallery is not available in the local collection.');return;}
  document.title=`${gallery.title} | 500px`;
  galleryPhotos=gallery.photos;
  const back=isGrant?`/grants#${gallery.section}`:isGuest?'/p/guest?view=galleries':`/p/${owner}?view=galleries`;
  const ownerHref=isGrant?'/grants':isGuest?'/p/guest':`/p/${owner}`;
  const ownerName=isGrant?'500px':isGuest?'Guest uploads':profile.name;
  const following=state.following.includes(ownerHref);
  // shortcut: Grant galleries contain captured preview photos; expand when full collections can be captured.
  main.innerHTML=`<a class="gallery-back" data-gallery-back href="${back}">← ${isGrant?'Commercial Grants':`Galleries by ${escapeHTML(ownerName)}`}</a>
    <section class="gallery-header" aria-labelledby="gallery-title"><h1 id="gallery-title">${escapeHTML(gallery.title)}</h1>
    <div class="gallery-owner-row"><a class="gallery-owner" href="${ownerHref}">${lightboxMode?'<span class="gallery-avatar" aria-hidden="true">500px</span>':`<img class="gallery-avatar" src="${escapeHTML(profile.avatar)}" alt="">`}<span><small>Curated by</small><span data-gallery-owner>${escapeHTML(ownerName)}</span></span></a>${lightboxMode?'':`<button class="gallery-control gallery-follow" data-follow-owner="${ownerHref}" aria-pressed="${following}">${following?'Following':'Follow'}</button>`}</div>
    <p class="gallery-description">${escapeHTML(gallery.description)}</p></section>
    <div class="gallery-toolbar"><span class="gallery-count">${gallery.photos.length} ${isGuest?'items':'photos'}</span><div class="gallery-actions"><button class="gallery-control" data-gallery-action="slideshow" aria-label="Start slideshow">Slideshow</button><button class="gallery-control" data-gallery-action="share" aria-label="Share gallery">Share</button></div></div>
    <div class="gallery-photos">${gallery.photos.map((photo,index)=>mediaFigure(photo,index,{lightbox:lightboxMode})).join('')}</div>`;
}

async function renderGuestProfile() {
  document.title='Guest uploads | 500px';
  const name=all('span').find(span=>!span.children.length&&span.textContent.trim()==='Marco Grassi');
  name.textContent='Guest uploads';
  // captured markup: name > name row > name+location block > header row > info column
  const info=name.parentElement.parentElement.parentElement.parentElement;
  [name.parentElement.nextElementSibling,name.parentElement.parentElement.nextElementSibling,...[...info.children].slice(1)].forEach(el=>{if(el)el.hidden=true;});
  document.querySelector('.profile-avatar > div').innerHTML='<span class="local-guest-avatar" aria-hidden="true">500px</span>';
  const tabs=all('[role="tab"]');
  tabs.forEach(tab=>{if(tab.textContent.trim().startsWith('Quests'))tab.hidden=true;else tab.querySelector('span').textContent=tab.textContent.trim().replace(/\(\d+\)$/,'');});
  await handleTab(tabs.find(tab=>tab.textContent.trim()==='Galleries'));
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
    if(isGuestProfile){
      if(grid)grid.hidden=true;panel.hidden=false;
      const bar=document.querySelector('.MuiTabs-indicator');if(bar){bar.style.left=`${button.offsetLeft}px`;bar.style.width=`${button.offsetWidth}px`;}
      const works=text.startsWith('Works');
      try{
        const list=await api(works?'api/media?limit=200':'api/albums');
        if(works)galleryPhotos=list.map(m=>({src:m.url,title:m.title,author:m.author,kind:m.kind}));
        panel.innerHTML=!list.length?'<p>No guest uploads yet.</p><button class="local-primary" type="button">Upload</button>':`<div class="local-grid">${works?galleryPhotos.map((photo,index)=>mediaFigure(photo,index,{lightbox:true})).join(''):list.map(album=>`<a href="/galleries/guest?album=${encodeURIComponent(album.id)}" class="local-collection-card">${album.cover.kind==='video'?`<video src="${escapeHTML(album.cover.url)}" preload="metadata" muted></video>`:`<img src="${escapeHTML(album.cover.url)}" alt="">`}<span>${escapeHTML(album.title)}</span></a>`).join('')}</div>`;
        if(!list.length)panel.querySelector('button').addEventListener('click',()=>upload());
      }catch{panel.innerHTML='<p>Guest uploads are unavailable right now.</p>';}
    }
    else if(text.startsWith('Works')){if(grid)grid.hidden=false;panel.hidden=true;layoutGrids();}
    else if(text.startsWith('Galleries')){
      if(grid)grid.hidden=true;panel.hidden=false;
      const owner=pageName==='profile-pawel'?'paweluchorczak':'MarcoGrassi';
      const profile=(await galleries()).profiles[owner];
      panel.innerHTML=`<div class="local-grid">${profile.galleries.map(gallery=>`<a href="/galleries/${gallery.id}?owner=${owner}" class="local-collection-card"><img src="${escapeHTML(gallery.photos[0].src)}" alt=""><span>${escapeHTML(gallery.title)}</span></a>`).join('')}</div>`;
    } else {if(grid)grid.hidden=true;panel.hidden=false;const quests=(await catalogPromise).quests;panel.innerHTML=photoGrid(quests.map(q=>({...q,author:'500px Quest'})));}
  }
}

async function handleClick(event) {
  const target=event.target instanceof Element?event.target:null;
  if(!target)return;
  const galleryAction=target.closest('[data-gallery-action]');
  if(galleryAction){
    if(galleryAction.dataset.galleryAction==='share')await share(location.href,'Share this gallery');
    else await lightbox(0,true,galleryPhotos);
    return;
  }
  const galleryPhoto=target.closest('button[data-gallery-photo]');
  if(galleryPhoto){await lightbox(Number(galleryPhoto.dataset.galleryPhoto),false,galleryPhotos);return;}
  if(target.closest('[data-licensing-quest-share]')){await share(location.href,'Share this Quest');return;}
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
    const items=label==='Inspiration'?[{label:'For You',href:'/discover'},{label:'Fresh Picks',href:'/fresh'},{label:"Editors' Choice",href:'/editors-picks'},{label:'Top Ranked',href:'/leaderboard'}]:label==='Licensing'?[{label:'About Licensing',href:'/licensing/licensing'},{label:'Become a Contributor',href:'/licensing/contribute'},{label:'Submission Requirements',href:'/licensing/requirements'},{label:'Content Types',href:'/licensing/content'},{label:'Content Distribution',href:'/licensing/distribution'},{label:'Commercial Grants',href:'/grants'}]:[{label:'Inspiration',href:'/discover'},{label:'Quests',href:'/quests'},{label:'Licensing',href:'/licensing'},{label:'vivo X500',href:'/vivo_image'},{label:'About Us',href:'/aboutus'},{label:'Blog',href:'/blog'},{label:'Download the app',href:'/download'},{label:'Upload',action:upload},{label:'Guest uploads',href:'/p/guest'}];
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
    const key=button.dataset.followOwner||location.pathname;const following=toggleStored('following',key,button,'local-active');button.textContent=following?'Following':'Follow';return;
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
  if(pageName==='gallery')await renderGallery();
  if(pageName==='quest-licensing')await renderLicensingQuest();
  if(isGuestProfile)await renderGuestProfile();
  else if(pageName.startsWith('profile')&&new URLSearchParams(location.search).get('view')==='galleries'){
    const tab=all('[role="tab"]').find(tab=>tab.textContent.trim().startsWith('Galleries'));
    if(tab)await handleTab(tab);
  }
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
  if(pageName.startsWith('quest-')&&pageName!=='quest-licensing'&&location.pathname!=='/quest/0cqon9TXhfJ'&&location.pathname!=='/quest/SDjF78KIQrn'){
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
    const main=document.querySelector('main');
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
      main.classList.add('grants-reveals');
      const reveal=new IntersectionObserver(entries=>{
        for(const entry of entries){
          if(!entry.isIntersecting)continue;
          entry.target.classList.add('grant-visible');
          reveal.unobserve(entry.target);
        }
      });
      all('.css-177nfmx,.css-2d98ps,.css-mk7eym',main).forEach(element=>reveal.observe(element));
    }
    const sections=all('[data-grant-section]');
    const observer=new IntersectionObserver(()=>{
      const current=sections.filter(section=>section.getBoundingClientRect().top<=innerHeight/2).at(-1)||sections[0];
      all('[data-grant-target]').forEach(link=>{
        const selected=link.dataset.grantTarget===current.id;
        if(selected){
          if(link.hasAttribute('aria-current'))return;
          link.setAttribute('aria-current','location');
          const navigation=link.parentElement;
          navigation.scrollTo({left:link.offsetLeft-navigation.offsetLeft-(navigation.clientWidth-link.offsetWidth)/2,behavior:'smooth'});
        }else link.removeAttribute('aria-current');
      });
    },{rootMargin:'-140px 0px -50% 0px'});
    sections.forEach(section=>observer.observe(section));
  }
  if(pageName==='blog')await renderBlog();
  refreshAccount();
  initializeHeaderMenus();
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
  const response=await fetch('/pages/blog-posts.json');
  if(!response.ok)throw Error('Blog content unavailable');
  const {posts,navigation,fogImages}=await response.json();
  const main=document.querySelector('#blog-main');
  const e=escapeHTML;
  const link=post=>`/blog/${post.slug}`;
  const image=post=>`<a href="${link(post)}" data-blog-post><img src="${e(post.image)}" alt="${e(post.title)}"></a>`;
  const meta=post=>`<p class="blog-post-meta"><a href="/blog/category/${e(post.categories[0])}">${e(post.category)}</a> · ${e(post.date)}</p>`;
  const cards=list=>list.map(post=>`<article>${image(post)}<h3><a href="${link(post)}" data-blog-post>${e(post.title)}</a></h3>${meta(post)}</article>`).join('');
  const hero=(post,article)=>`<section class="blog-hero${article?' blog-hero-article':''}"><img src="${e(post.hero)}" alt="${e(post.title)}"><div class="blog-container"><div class="blog-hero-copy"><p class="blog-eyebrow">${article?e(post.category):'Featured Article'}</p><h1>${article?e(post.title):`<a href="${link(post)}" data-blog-post>${e(post.title)}</a>`}</h1><p class="blog-byline">Published by <strong>${e(post.author)}</strong> · ${e(post.date)}</p>${article?'':`<p class="blog-hero-excerpt">${e(post.excerpt)}</p>`}<div class="blog-share"><button type="button" data-blog-share aria-label="Share article">↗</button><button type="button" data-blog-share aria-label="Get article link">⧉</button></div></div></div></section>`;
  document.querySelector('.blog-categories').innerHTML=navigation.map(group=>`<details><summary><span>${e(group.label)}</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary><div><a href="${e(group.href)}">All ${e(group.label)}</a>${group.children.filter(child=>child.href!==group.href).map(child=>`<a href="${e(child.href)}">${e(child.label)}</a>`).join('')}</div></details>`).join('');
  const path=location.pathname.replace(/\/$/,'');
  const slug=path.slice('/blog/'.length);
  const missing=title=>{document.title=`${title} | 500px Blog`;main.innerHTML=`<div class="blog-container blog-not-found"><h1>${title}</h1><p>This page is not part of the local Blog snapshot.</p><a href="/blog">Back to the Blog</a></div>`;};
  if(path==='/blog'){
    document.title='500px Blog';
    main.innerHTML=`${hero(posts[0],false)}<div class="blog-container"><h2 class="blog-section-heading">Top Posts</h2><div class="blog-top-posts">${posts.slice(0,5).map(post=>`<article>${image(post)}<div><h3><a href="${link(post)}" data-blog-post>${e(post.title)}</a></h3><p class="blog-post-meta">by <a href="/blog/category/500px-blog">${e(post.author)}</a> in <a href="/blog/category/500px-blog">${e(post.category)}</a> · ${e(post.date)}</p><p class="blog-excerpt">${e(post.excerpt)}</p><a class="blog-read-more" href="${link(post)}" data-blog-post>Keep reading</a></div></article>`).join('')}</div><h2 class="blog-section-heading">Latest Posts</h2><div class="blog-latest-layout"><div class="blog-latest-grid">${cards(posts.slice(5))}</div><aside class="blog-tweets"><a href="https://twitter.com/500px">Tweets by @500px</a></aside></div></div>`;
  }else if(slug.startsWith('category/')){
    const category=slug.slice('category/'.length);
    const selected=navigation.flatMap(group=>[{label:group.label,href:group.href},...group.children]).find(item=>item.href===path);
    const extra=new Map([['creative','Inspiration'],['interviews','Interviews'],['500px-blog','500px Blog'],['uncategorized','Uncategorized']]);
    const title=selected?.label||extra.get(category);
    if(!title)missing('Category not found');
    else {
      document.title=`${title} | 500px Blog`;
      const matches=posts.filter(post=>post.categories.includes(category.split('/').at(-1)));
      main.innerHTML=`<div class="blog-container blog-archive"><a href="/blog">← 500px Blog</a><h1>${e(title)}</h1>${matches.length?`<div class="blog-latest-grid">${cards(matches)}</div>`:'<p>No stories in this category are included in the local snapshot.</p>'}</div>`;
    }
  }else {
    const index=posts.findIndex(post=>post.slug===slug);
    if(index===-1)missing('Article not found');
    else {
      const post=posts[index];document.title=`${post.title} | 500px Blog`;
      const figure=photo=>`<figure><img src="${e(photo.src)}" alt="${e(photo.alt)}"></figure>`;
      // shortcut: article copy is condensed; replace fixtures if full editorial content is commissioned.
      const body=index===0?`${figure(fogImages[0])}<h2>Why fog makes such strong images</h2><p>Distant forms fade while nearby subjects remain clear.</p><h2>When and where to find it</h2><p>Explore rivers and valleys around sunrise after cool nights.</p>${figure(fogImages[1])}<h2>Composing in low visibility</h2><h3>Find one clear subject</h3><p>Give a single shape room to stand out.</p>${figure(fogImages[2])}<h3>Layer your scene</h3><p>Arrange overlapping shapes to suggest distance.</p><h3>Use light sources</h3><p>Watch how small lights illuminate the mist.</p>${figure(fogImages[3])}<h2>Getting exposure right</h2><p>Check highlights and keep important details sharp.</p>${figure(fogImages[4])}<h2>The mood of the unseen</h2><p>Leave space for the viewer’s imagination.</p>`:`${figure({src:post.image,alt:post.title})}<h2>A closer look</h2><p>Take time to explore the light, shapes, and relationships in the frame. Small changes in viewpoint can reveal a different story.</p><h2>Keep exploring</h2><p>Try this approach with your own photography, then explore more ideas from the 500px community.</p>`;
      const previous=posts[index===0?8:index-1],next=posts[index===0?7:(index+1)%posts.length];
      main.innerHTML=`${hero(post,true)}<article class="blog-article"><p>${e(post.excerpt)}</p>${body}<a href="/blog">← Back to the Blog</a></article><nav class="blog-post-navigation" aria-label="Article navigation"><div class="blog-container">${[[previous,'Previous Post'],[next,'Next Post']].map(([item,label])=>`<a href="${link(item)}">${label}<img src="${e(item.image)}" alt=""><strong>${e(item.title)}</strong></a>`).join('')}</div></nav>`;
    }
  }
  main.removeAttribute('aria-busy');
  main.querySelectorAll('[data-blog-share]').forEach(button=>button.addEventListener('click',()=>share(new URL(link(posts.find(post=>post.slug===slug)||posts[0]),location.origin).href,'Share this article').catch(reportError)));
  const toggle=document.querySelector('.blog-menu-toggle');
  toggle.addEventListener('click',()=>toggle.setAttribute('aria-expanded',String(toggle.getAttribute('aria-expanded')!=='true')));
  const details=all('.blog-header details');
  details.forEach(item=>{
    item.addEventListener('toggle',()=>{if(item.open)details.filter(other=>other!==item).forEach(other=>other.open=false);});
    item.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse'&&matchMedia('(hover: hover)').matches)item.open=true;});
    item.addEventListener('pointerleave',event=>{if(event.pointerType==='mouse'&&!item.contains(document.activeElement))item.open=false;});
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){const open=details.find(item=>item.open);details.forEach(item=>item.open=false);if(toggle.getAttribute('aria-expanded')==='true'){toggle.setAttribute('aria-expanded','false');toggle.focus();}else open?.querySelector('summary').focus();}});
}

document.addEventListener('click',event=>{handleClick(event).catch(reportError);});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    if(menu?.contains(document.activeElement))menuTrigger?.focus();
    closeMenu();
    const contents=document.querySelector('[data-licensing-toc][aria-expanded="true"]');
    if(contents&&!document.querySelector('dialog[open]')){contents.setAttribute('aria-expanded','false');contents.focus();}
    return;
  }
  if(['leaderboard','quest-licensing'].includes(pageName)&&event.target.matches('[role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();const tabs=all('[role="tab"]',event.target.closest('[role="tablist"]'));
    const index=event.key==='Home'?0:event.key==='End'?tabs.length-1:(tabs.indexOf(event.target)+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    tabs[index]?.focus();tabs[index]?.click();return;
  }
  if(menu&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const items=all('[role="menuitem"]',menu);const index=items.indexOf(document.activeElement);items[(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();return;}
  if(['Enter',' '].includes(event.key)&&event.target.matches('[role="button"]:not(button),[role="tab"]:not(button)')){event.preventDefault();event.target.click();}
});
initialize().catch(reportError);
