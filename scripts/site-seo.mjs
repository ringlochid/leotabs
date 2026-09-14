// SPDX-License-Identifier: MPL-2.0
// Shared metadata contract for the static site and its verifier.
export function canonicalSlug(slug, metadata) {
  return metadata[slug]?.canonicalSlug ?? slug;
}

export function pageUrl(origin, slug) {
  return new URL(slug ? slug + '/' : '', origin).href;
}

export function breadcrumbItems(slug, title, origin, metadata) {
  if (!slug || slug === 'uninstalled') return [];
  const items = [{name: 'LeoTabs', url: pageUrl(origin, '')}];
  if (slug.startsWith('docs/') && canonicalSlug(slug, metadata).startsWith('docs/'))
    items.push({name: 'Guides', url: pageUrl(origin, 'docs')});
  items.push({name: title, url: pageUrl(origin, canonicalSlug(slug, metadata))});
  return items;
}

export function structuredData(slug, title, config, metadata) {
  if (!config.origin || slug === 'uninstalled') return null;
  const canonical = pageUrl(config.origin, canonicalSlug(slug, metadata));
  const graph = [{
    '@type': 'WebPage', '@id': canonical + '#webpage', url: canonical,
    name: metadata[slug].title, description: metadata[slug].description, inLanguage: 'en',
    about: {'@type': 'Thing', name: 'LeoTabs', url: config.origin,
      sameAs: ['https://github.com/ringlochid/leotabs', config.storeUrl]}
  }];
  if (!slug) graph[0].primaryImageOfPage = {'@type': 'ImageObject',
    url: new URL('assets/library.png', config.origin).href, width: 1920, height: 1200};
  const crumbs = breadcrumbItems(slug, title, config.origin, metadata);
  if (crumbs.length) {
    graph[0].breadcrumb = {'@id': canonical + '#breadcrumb'};
    graph.push({'@type': 'BreadcrumbList', '@id': canonical + '#breadcrumb',
      itemListElement: crumbs.map((item, index) => ({'@type': 'ListItem', position: index + 1,
        name: item.name, item: item.url}))});
  }
  // Do not manufacture reviews to qualify for Google's SoftwareApplication result.
  return {'@context': 'https://schema.org', '@graph': graph};
}
