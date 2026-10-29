export function resolvePage(route, manifest, licensingQuests) {
  let page = manifest[route];
  if (['/popular','/fresh','/editors-picks','/upcoming','/discover'].includes(route)) page = manifest[route] || 'discover';
  if (route.startsWith('/photo/')) page ||= 'photo-lines';
  if (/^\/galler(?:y|ies)\/[^/]+$/.test(route)) page = 'gallery';
  if (route.startsWith('/quest/')) page ||= licensingQuests.has(route) ? 'quest-licensing' : 'quest-mountains';
  if (route.startsWith('/p/') || route.startsWith('/user/')) page ||= 'profile';
  if (route.startsWith('/blog/')) page = 'blog';
  if (['/login','/signup','/upload','/manager/works','/manager/licensing'].includes(route)) page = 'discover';
  return page;
}
