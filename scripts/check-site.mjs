// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {guidePages,renderGuide} from './guide-markdown.mjs';
import {canonicalSlug,pageUrl} from './site-seo.mjs';
const root=path.resolve('output/site');
const config=JSON.parse(await fs.readFile('website/config.json','utf8'));
if(process.argv.includes('--preview'))config.origin=null;
const metadata=JSON.parse(await fs.readFile('website/seo.json','utf8'));
const guides=await guidePages(fs);
const pages=['index.html',...['privacy','permissions','support','changelog','uninstalled',...guides.map(g=>g.slug)].map(s=>s+'/index.html')];
const titles=new Set(),descriptions=new Set(),expectedSitemap=new Set();
const decode=text=>text.replace(/&(?:amp|lt|gt|quot|#39);/g,value=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[value]));
for(const file of pages){
  const full=path.join(root,file),html=await fs.readFile(full,'utf8');
  const slug=file==='index.html'?'':file.slice(0,-'/index.html'.length);
  const titleTags=[...html.matchAll(/<title>(.*?)<\/title>/g)],descriptionTags=[...html.matchAll(/<meta name="description" content="([^"]*)">/g)];
  if(titleTags.length!==1 || descriptionTags.length!==1)throw Error('Expected one title and description: '+file);
  const title=decode(titleTags[0][1]),description=decode(descriptionTags[0][1]);
  if(title!==metadata[slug]?.title || description!==metadata[slug]?.description)throw Error('Incorrect page metadata: '+file);
  if(titles.has(title) || descriptions.has(description))throw Error('Duplicate title or description: '+file);
  titles.add(title);descriptions.add(description);
  const prefix='../'.repeat(file.split('/').length-1);
  const themeTag='<script src="'+prefix+'assets/theme.js"></script>';
  if(html.split(themeTag).length!==2)throw Error('Expected one local theme script in '+file);
  const videoTag='<script src="assets/video.js" defer></script>';
  if(file==='index.html' && html.split(videoTag).length!==2)throw Error('Expected the local video script on the homepage.');
  const dataScripts=[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if(dataScripts.length!==(config.origin && slug!=='uninstalled'?1:0))throw Error('Unexpected JSON-LD count: '+file);
  for(const [tag,json] of dataScripts){
    const data=JSON.parse(json),graph=data['@graph'];
    if(data['@context']!=='https://schema.org' || !Array.isArray(graph) || graph[0]?.['@type']!=='WebPage')throw Error('Invalid page schema: '+file);
    if(graph[0].name!==title || graph[0].description!==description || graph[0].url!==pageUrl(config.origin,canonicalSlug(slug,metadata)))throw Error('Schema does not match page: '+file);
    if(/"(?:aggregateRating|review|FAQPage|SoftwareApplication)"/.test(json))throw Error('Unsupported rich-result claims: '+file);
    const breadcrumb=graph.find(item=>item['@type']==='BreadcrumbList');
    if(slug && (!breadcrumb || !html.includes('aria-label="Breadcrumb"')))throw Error('Missing visible/structured breadcrumbs: '+file);
    if(breadcrumb && (breadcrumb.itemListElement.length<2 || breadcrumb.itemListElement.some((item,i)=>item.position!==i+1 || !item.name || !item.item.startsWith(config.origin))))throw Error('Invalid breadcrumb items: '+file);
    const hash=createHash('sha256').update(json).digest('base64');
    if(!html.includes("'sha256-"+hash+"'"))throw Error('CSP must allow exactly the generated JSON-LD: '+file);
  }
  const permittedScripts=html.replace(themeTag,'').replace(file==='index.html'?videoTag:'\0','').replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g,'');
  if(/<script|<iframe|\son\w+=|\{\{/i.test(permittedScripts))throw Error('Unexpected script, eagerly loaded embed or unresolved placeholder in '+file);
  if(file==='index.html' && (!html.includes('data-video-id="'+config.videoId+'"') || !html.includes("frame-src https://www.youtube-nocookie.com")))throw Error('Missing video trigger or player CSP.');
  if(!html.includes('aria-label="Colour theme"'))throw Error('Missing accessible theme control in '+file);
  if((html.match(/<h1\b/g)||[]).length!==1)throw Error('Expected one h1 in '+file);
  if(!html.includes('support@ringlochid.me'))throw Error('Missing contact in '+file);
  if(config.origin){
    const canonical=pageUrl(config.origin,canonicalSlug(slug,metadata));
    if((html.match(/rel="canonical"/g)||[]).length!==1 || !html.includes('<link rel="canonical" href="'+canonical+'">'))throw Error('Incorrect canonical URL in '+file);
    for(const [attribute,name,value] of [['property','og:title',title],['property','og:description',description],['property','og:url',canonical],['property','og:image',new URL('assets/library.png',config.origin).href],['name','twitter:card','summary_large_image']]){
      const matches=[...html.matchAll(new RegExp('<meta '+attribute+'="'+name+'" content="([^"]*)">','g'))];
      if(matches.length!==1 || decode(matches[0][1])!==value)throw Error('Incorrect social metadata '+name+': '+file);
    }
    if(slug!=='uninstalled' && canonicalSlug(slug,metadata)===slug)expectedSitemap.add(canonical);
    if(file==='uninstalled/index.html') {
      if(!html.includes('content="noindex,nofollow"'))throw Error('The uninstall page should not be indexed.');
    } else if(html.includes('noindex'))throw Error('Published page must not be noindex: '+file);
  }else if(!html.includes('content="noindex,nofollow"') || /rel="canonical"|property="og:url"/.test(html))throw Error('Preview must stay noindex without public URLs: '+file);
  for(const [,url] of html.matchAll(/(?:href|src)="([^"]+)"/g)){
    if(/^(?:https:|mailto:|#)/.test(url))continue;
    const target=path.resolve(path.dirname(full),url.split('#')[0]);
    if(!target.startsWith(root+path.sep) && target!==root)throw Error('Link escapes site: '+url);
    const stat=await fs.stat(target);
    const destination=stat.isDirectory()?path.join(target,'index.html'):target;
    await fs.stat(destination);
    const fragment=url.split('#')[1];
    if(fragment && destination.endsWith('.html') && !(await fs.readFile(destination,'utf8')).includes('id="'+fragment+'"'))throw Error('Missing link fragment '+url+' in '+file);
    if(url.includes('docs/permissions/'))throw Error('Internal link should use canonical permissions page: '+file);
  }
  for(const [tag] of html.matchAll(/<(?:img|link)\b[^>]*>/g))
    if(!tag.includes('rel="canonical"') && /(?:src|href)="https?:/.test(tag))throw Error('Remote asset in '+file);
}
const sitemap=await fs.readFile(root+'/sitemap.xml','utf8');
if(!sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'))throw Error('Invalid sitemap namespace');
const locations=[...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(([,url])=>decode(url));
if(locations.length!==expectedSitemap.size || new Set(locations).size!==locations.length || locations.some(url=>!expectedSitemap.has(url)))throw Error('Sitemap must list exactly the indexable canonical pages.');
if(/<lastmod>|<priority>|<changefreq>/.test(sitemap))throw Error('Do not invent sitemap dates or ranking hints.');
if((await fs.readFile(root+'/google345c4ce523429af8.html','utf8'))!==(await fs.readFile('website/verification/google345c4ce523429af8.html','utf8')))throw Error('Search Console verification file changed.');
const canonical=(await fs.readFile('extension/privacy.html','utf8')).match(/<article id="privacy-policy">([\s\S]*?)<\/article>/)[1];
const rendered=await fs.readFile(root+'/privacy/index.html','utf8');
if(!config.hostingName && !rendered.includes(canonical))throw Error('Website privacy differs from canonical source.');
for(const guide of guides){
  const html=await fs.readFile(path.join(root,guide.slug,'index.html'),'utf8');
  for(const [,title] of renderGuide(guide.markdown).matchAll(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/g))
    if(!html.includes(title))throw Error('Guide content missing: '+guide.file);
}
console.log(`Checked ${pages.length} pages and ${guides.length} shared guides: unique metadata, canonical URLs, ${locations.length} sitemap entries, social previews, JSON-LD/CSP, links, assets, contact, headings and no eagerly loaded embeds.`);
