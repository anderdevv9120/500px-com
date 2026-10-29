import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { resolvePage } from '../routes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '_site');
const basePath = (process.env.PAGES_BASE_PATH ?? '/500px-com').replace(/\/+$/, '');
assert.match(basePath, /^(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/, 'Expected a URL base path, such as /500px-com or an empty string');

// Rebase local URL literals in the exported copies; retain the captured source files.
const rebase = text => text.replace(/(["'`])\/(?=[A-Za-z0-9])/g, `$1${basePath}/`)
  .replace(/(url\()\/(?=[A-Za-z0-9])/g, `$1${basePath}/`)
  .replace(/href=(["'])\/\1/g, `href=$1${basePath}/$1`);
assert.equal(rebase('href="/" src="/assets/a.jpg" url(/assets/a.jpg)'), `href="${basePath}/" src="${basePath}/assets/a.jpg" url(${basePath}/assets/a.jpg)`);
assert.equal(rebase('href="//cdn.example/a" href="https://example.com/a"'), 'href="//cdn.example/a" href="https://example.com/a"');
assert.equal(rebase('if (/facebook|apple|google/.test(href))'), 'if (/facebook|apple|google/.test(href))');

const files = ['index.html', 'app.js', 'styles.css', 'catalog.json',
  ...(await fs.readdir(path.join(root, 'pages'))).map(name => `pages/${name}`)];
const sources = new Map(await Promise.all(files.map(async name => [name, await fs.readFile(path.join(root, name), 'utf8')])));
const manifest = JSON.parse(sources.get('pages/manifest.json'));
const catalog = JSON.parse(sources.get('catalog.json'));
const galleries = JSON.parse(sources.get('pages/galleries.json'));
const blog = JSON.parse(sources.get('pages/blog-posts.json'));
const licensingQuests = new Set(catalog.quests.filter(quest => quest.type === 'LICENSING').map(quest => quest.href));
const routes = new Set([...Object.keys(manifest), '/popular', '/upcoming', '/login', '/signup', '/upload', '/manager/works', '/manager/licensing']);
for (const text of sources.values()) {
  for (const [, value] of text.matchAll(/["'`(](\/(?!\/)[^"'`<>\s)]+)/g)) {
    const route = value.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    if (!route.includes('$') && resolvePage(route, manifest, licensingQuests)) routes.add(route);
  }
}
for (const profile of Object.values(galleries.profiles)) {
  for (const gallery of profile.galleries) routes.add(`/galleries/${gallery.id}`);
}
for (const gallery of galleries.grants) routes.add(`/gallery/${gallery.id}`);
for (const post of blog.posts) {
  routes.add(`/blog/${post.slug}`);
  for (const category of post.categories) routes.add(`/blog/category/${category}`);
}

assert.equal(path.dirname(output), path.resolve(root), 'Export must stay inside the project');
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
await fs.cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
for (const [name, source] of sources) {
  let contents = rebase(source);
  if (name === 'app.js') {
    // Pages adds trailing slashes to directory routes; fixture URLs have none.
    contents = contents.replaceAll('location.pathname', 'deployedPathname')
      .replaceAll('^\\/', `^${basePath.replaceAll('.', '\\.').replaceAll('/', '\\/')}\\/`);
    contents = `const deployedPathname = location.pathname === '${basePath}/' ? location.pathname : location.pathname.replace(/\\/$/, '') || '/';\n${contents}`;
    new Script(contents, { filename: 'exported app.js' });
  }
  const destination = path.join(output, name);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, contents);
}
for (const route of routes) {
  const page = resolvePage(route, manifest, licensingQuests);
  const source = sources.get(route === '/' ? 'index.html' : `pages/${page}.html`);
  assert.ok(source, `Missing page for ${route}`);
  const destination = path.resolve(output, `.${route}`, 'index.html');
  assert.ok(destination.startsWith(output + path.sep), `Route must stay inside export: ${route}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, rebase(source));
}
await fs.writeFile(path.join(output, '.nojekyll'), '');
await fs.writeFile(path.join(output, '404.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Page not found</title><h1>Page not found</h1><p>This URL is not included in the static snapshot.</p><a href="${basePath}/">Return to 500px</a></html>\n`);
console.log(`Exported ${routes.size} routes to _site with base path ${basePath || '/'}.`);
