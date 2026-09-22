// SPDX-License-Identifier: MPL-2.0
// Static pages with local scripts and an optional click-to-load video player.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {renderGuide,guidePages} from './guide-markdown.mjs';
import {canonicalSlug,pageUrl,breadcrumbItems,structuredData} from './site-seo.mjs';
const config=JSON.parse(await fs.readFile('website/config.json','utf8'));
const metadata=JSON.parse(await fs.readFile('website/seo.json','utf8'));
if(process.argv.includes('--preview'))config.origin=null;
if(!config.storeUrl)throw Error('Configure the published Chrome Web Store URL in website/config.json.');
if(!/^[\w-]{11}$/.test(config.videoId||''))throw Error('Configure a valid YouTube video ID.');
const videoUrl='https://www.youtube.com/watch?v='+config.videoId;
const baseCsp="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'";
const videoCsp=baseCsp+"; frame-src https://www.youtube-nocookie.com";
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
for(const key of ['origin','storeUrl','hostingPrivacyUrl']) if(config[key] && new URL(config[key]).protocol!=='https:') throw Error(key+' must use HTTPS.');
if(config.origin){
  const base=new URL(config.origin);
  if(base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/')) throw Error('Website URL must have a trailing slash and no credentials, query or fragment.');
}
if(process.argv.includes('--release') && (!config.origin || !config.hostingName || !config.hostingPrivacyUrl)) throw Error('Before publication, configure the domain and hosting privacy disclosure in website/config.json.');
const out='output/site';
await fs.mkdir(out+'/assets',{recursive:true});
await fs.copyFile('website/styles.css',out+'/assets/styles.css');
await fs.copyFile('website/theme.js',out+'/assets/theme.js');
await fs.copyFile('website/video.js',out+'/assets/video.js');
await fs.copyFile('extension/icons/lion.svg',out+'/assets/lion.svg');
await fs.copyFile('LICENSE',out+'/LICENSE.txt');
await fs.copyFile('website/assets/octicons-LICENSE.txt',out+'/assets/octicons-LICENSE.txt');
// Keep the Search Console ownership file unchanged in every published build.
await fs.copyFile('website/verification/google345c4ce523429af8.html',out+'/google345c4ce523429af8.html');
for(const name of ['library.png','switcher.png'])
  await fs.copyFile('website/assets/'+name,out+'/assets/'+name);
const guides=await guidePages(fs);
const pages=[['','Home'],['privacy','Privacy'],['permissions','Permissions'],['support','Support'],['changelog','Changelog'],['uninstalled','Help me improve LeoTabs'],...guides.map(g=>[g.slug,g.title])];
if(Object.keys(metadata).length!==pages.length || pages.some(([slug])=>!metadata[slug]?.title || !metadata[slug]?.description))throw Error('Every page needs explicit SEO metadata in website/seo.json.');
const policy=await fs.readFile('extension/privacy.html','utf8');
const article=policy.match(/<article id="privacy-policy">([\s\S]*?)<\/article>/)?.[1];
if(!article)throw Error('Missing canonical privacy article.');
// GitHub mark from Primer Octicons (MIT); see website/assets/octicons-LICENSE.txt.
const githubLink='<a class="github-link" href="https://github.com/ringlochid/leotabs" aria-label="LeoTabs on GitHub" title="LeoTabs on GitHub"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943"/></svg></a>';
for(const [slug,title] of pages){
  const prefix='../'.repeat(slug?slug.split('/').length:0);
  const guide=guides.find(g=>g.slug===slug)||(slug==='permissions'?guides.find(g=>g.file==='permissions.md'):null);
  const guideLink=url=>{
    if(url==='../extension/privacy.html')return prefix+'privacy/';
    if(/^[\w-]+\.md(?:#.*)?$/.test(url)){
      const [file,fragment]=url.split('#'),target=guides.find(g=>g.file===file);
      if(!target)throw Error('Unknown guide link '+url);
      return prefix+canonicalSlug(target.slug,metadata)+'/'+(fragment?'#'+fragment:'');
    }
    return url;
  };
  let body=guide?renderGuide(guide.markdown,guideLink):slug==='privacy'?article:await fs.readFile('website/pages/'+(slug||'index')+'.html','utf8');
  // Keep published bytes identical across Windows checkouts and Linux Pages builds.
  body=body.replace(/\r\n/g,'\n');
  if(guide && slug!=='docs'){
    const headings=[...body.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)];
    if(headings.length>3){
      const contents='<details class="on-this-page"><summary>On this page</summary><nav aria-label="On this page"><ul>'+headings.map(([,id,label])=>'<li><a href="#'+id+'">'+label+'</a></li>').join('')+'</ul></nav></details>';
      body=body.replace(/(?=<h2\b)/,contents);
    }
  }
  if(slug && slug!=='uninstalled'){
    const crumbs=breadcrumbItems(slug,title,config.origin||'https://preview.invalid/',metadata);
    body='<nav class="guide-breadcrumb" aria-label="Breadcrumb">'+crumbs.map((item,index)=>index===crumbs.length-1?'<span aria-current="page">'+escape(item.name)+'</span>':'<a href="'+prefix+new URL(item.url).pathname.replace(new URL(config.origin||'https://preview.invalid/').pathname,'')+'">'+escape(item.name)+'</a>').join(' <span aria-hidden="true">/</span> ')+ '</nav>'+body;
  }
  if(guide && slug!=='docs')body+='<nav class="guide-next" aria-label="Related guides"><a href="'+prefix+'docs/">All guides</a><a href="'+prefix+'docs/saving-switching/">Save and reopen tabs</a><a href="'+prefix+'docs/import-export/">Backups and exports</a><a href="'+prefix+'docs/troubleshooting/">Troubleshooting</a></nav><p class="guide-install">LeoTabs is free for Chrome and Edge. <a href="'+escape(config.storeUrl)+'">Install LeoTabs from the Chrome Web Store</a>.</p>';
  body=body.replaceAll('{{INSTALL}}','<a class="button" href="'+escape(config.storeUrl)+'">Add to Chrome</a>');
  body=body.replaceAll('{{WATCH_VIDEO}}',`<a class="button secondary watch-video" href="${videoUrl}" data-video-id="${config.videoId}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="m10 8 6 4-6 4z" fill="currentColor"/></svg>Watch video</a>`);
  body=body.replaceAll('{{VIDEO_LINK}}',`<a href="${videoUrl}" target="_blank" rel="noopener">Watch on YouTube ↗</a>`);
  if(slug==='privacy' && config.hostingName && config.hostingPrivacyUrl) body=body.replace('Hosting details will be identified on the website before it is published.',`This website is hosted by ${escape(config.hostingName)}; see its <a href="${escape(config.hostingPrivacyUrl)}">privacy policy</a> for its handling of operational logs.`);
  const canonical=config.origin?pageUrl(config.origin,canonicalSlug(slug,metadata)):null;
  const schema=structuredData(slug,title,config,metadata);
  const schemaJSON=schema?JSON.stringify(schema).replaceAll('<','\\u003c'):null;
  const csp=(slug?baseCsp:videoCsp).replace("script-src 'self'", "script-src 'self'"+(schemaJSON?" 'sha256-"+createHash('sha256').update(schemaJSON).digest('base64')+"'":''));
  const social=canonical?`<meta property="og:type" content="website"><meta property="og:site_name" content="LeoTabs"><meta property="og:locale" content="en_US">
<meta property="og:title" content="${escape(metadata[slug].title)}"><meta property="og:description" content="${escape(metadata[slug].description)}"><meta property="og:url" content="${escape(canonical)}">
<meta property="og:image" content="${escape(new URL('assets/library.png',config.origin).href)}"><meta property="og:image:width" content="1920"><meta property="og:image:height" content="1200"><meta property="og:image:type" content="image/png"><meta property="og:image:alt" content="LeoTabs library with tabs, project collections, groups and notes">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(metadata[slug].title)}"><meta name="twitter:description" content="${escape(metadata[slug].description)}"><meta name="twitter:image" content="${escape(new URL('assets/library.png',config.origin).href)}"><meta name="twitter:image:alt" content="LeoTabs library with tabs, project collections, groups and notes">`:'';
  const html=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer"><meta name="description" content="${escape(metadata[slug].description)}">
${!config.origin||slug==='uninstalled'?'<meta name="robots" content="noindex,nofollow">':''}${canonical?'<link rel="canonical" href="'+escape(canonical)+'">':''}
<title>${escape(metadata[slug].title)}</title>
${social}
${schemaJSON?'<script type="application/ld+json">'+schemaJSON+'</script>':''}
<link rel="icon" href="${prefix}assets/lion.svg" type="image/svg+xml"><script src="${prefix}assets/theme.js"></script>${slug?'':'<script src="assets/video.js" defer></script>'}<link rel="stylesheet" href="${prefix}assets/styles.css"></head>
<body><a class="skip" href="#main">Skip to content</a><div class="wrap"><header class="site-head"><a class="brand" href="${prefix||'./'}"><img src="${prefix}assets/lion.svg" alt="" width="28" height="28">LeoTabs</a><nav aria-label="Main">${[['docs','Guide'],['privacy','Privacy'],['support','Support']].map(([id,label])=>`<a href="${prefix}${id}/"${slug===id||slug.startsWith(id+'/')?' aria-current="page"':''}>${label}</a>`).join('')}</nav><div class="header-actions"><label class="theme-control" hidden><select id="theme" aria-label="Colour theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>${githubLink}</div></header>
<main id="main"${slug?' class="prose"':''}>${body}</main>
<footer class="site-foot"><span>Made by <a href="https://github.com/ringlochid">Leo</a></span><nav aria-label="Footer"><a href="${prefix}privacy/">Privacy</a><a href="${prefix}permissions/">Permissions</a><a href="${prefix}changelog/">Changelog</a>${config.origin?'<a href="'+prefix+'sitemap.xml">Sitemap</a>':''}<a href="${prefix}LICENSE.txt">MPL-2.0</a><a href="mailto:support@ringlochid.me">Contact</a></nav></footer></div></body></html>`;
  const directory=path.join(out,slug);await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'index.html'),html);
}
const sitemapUrls=config.origin?pages.filter(([slug])=>slug!=='uninstalled' && canonicalSlug(slug,metadata)===slug).map(([slug])=>pageUrl(config.origin,slug)):[];
await fs.writeFile(out+'/sitemap.xml','<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+sitemapUrls.map(url=>'  <url><loc>'+escape(url)+'</loc></url>').join('\n')+'\n</urlset>\n');
await fs.writeFile(out+'/robots.txt',config.origin?'User-agent: *\nAllow: /\nSitemap: '+new URL('sitemap.xml',config.origin).href+'\n':'User-agent: *\nDisallow: /\n');
// Static-host hints; publish only the generated output/site directory.
await fs.writeFile(out+'/.nojekyll','');
// Per-page CSP, including the JSON-LD hash, lives in HTML. A second script policy
// here would block the hashed data on hosts that support this optional file.
await fs.writeFile(out+'/_headers',`/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: frame-ancestors 'none'\n`);
console.log(`Built ${pages.length} static pages, including ${guides.length} shared user guides. Nothing published.`);
