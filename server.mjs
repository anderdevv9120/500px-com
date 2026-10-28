import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5000);
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.avif':'image/avif', '.gif':'image/gif', '.woff2':'font/woff2', '.ico':'image/x-icon', '.pdf':'application/pdf' };
const manifest = JSON.parse(await fs.readFile(path.join(root,'pages/manifest.json'),'utf8'));
const catalog = JSON.parse(await fs.readFile(path.join(root,'catalog.json'),'utf8'));
const licensingQuests = new Set(catalog.quests.filter(quest=>quest.type==='LICENSING').map(quest=>quest.href));

const server = http.createServer(async (request,response) => {
  try {
    const url = new URL(request.url,'http://localhost');
    const route = decodeURIComponent(url.pathname).replace(/\/$/, '') || '/';
    let page = manifest[route];
    if (['/popular','/fresh','/editors-picks','/upcoming','/discover'].includes(route)) page = manifest[route] || 'discover';
    if (route.startsWith('/photo/')) page ||= 'photo-lines';
    if (/^\/galler(?:y|ies)\/[^/]+$/.test(route)) page = 'gallery';
    if (route.startsWith('/quest/')) page ||= licensingQuests.has(route) ? 'quest-licensing' : 'quest-mountains';
    if (route.startsWith('/p/') || route.startsWith('/user/')) page ||= 'profile';
    if (route.startsWith('/blog/')) page = 'blog';
    if (['/login','/signup','/upload','/manager/works','/manager/licensing'].includes(route)) page = 'discover';
    const filename = route === '/' ? 'index.html' : page ? `pages/${page}.html` : route.slice(1);
    const resolved = path.resolve(root, filename);
    const relative = path.relative(root,resolved);
    const allowed = page || /^(assets|pages)\//.test(filename) || ['app.js','styles.css','catalog.json'].includes(filename);
    if (!allowed || relative.startsWith('..') || path.isAbsolute(relative)) {
      response.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}).end('Page not found.');
      return;
    }
    const contents = await fs.readFile(resolved);
    response.writeHead(200,{'Content-Type':types[path.extname(resolved)] || 'application/octet-stream','Cache-Control':page ? 'no-cache' : 'public, max-age=3600'});
    if (request.method === 'HEAD') response.end(); else response.end(contents);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500, {'Content-Type':'text/plain; charset=utf-8'}).end(error.code === 'ENOENT' ? 'File not found.' : 'Unable to serve this page.');
  }
});
server.listen(port,'127.0.0.1',() => console.log(`500px clone: http://localhost:${port}`));
