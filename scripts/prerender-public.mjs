import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const root=fileURLToPath(new URL('../',import.meta.url)),dist=join(root,'dist');
const [template,app]=await Promise.all(['landing.html','index.html'].map(name=>readFile(join(dist,name),'utf8')));
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const plain=value=>value.replace(/<[^>]*>/g,'').replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi,(_,hex,decimal,named)=>
  hex?String.fromCodePoint(parseInt(hex,16)):decimal?String.fromCodePoint(Number(decimal)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[named]));
const server=await createServer({configFile:join(root,'vite.config.ts'),server:{middlewareMode:true},appType:'custom'});
const urls=[];
try{
  const {renderPublicPage,publicGraph,publicPaths}=await server.ssrLoadModule(join(root,'scripts/entry-public-server.tsx'));
  for(const paths of Object.values(publicPaths))for(const pathname of Object.values(paths)){
    const {html,meta,locale,page}=await renderPublicPage(pathname);
    // Extract only our trusted React FAQ markup so visible answers and schema cannot drift.
    const section=html.match(/<section class="landing-faq[\s\S]*?<\/section>/)?.[0]??'';
    const faq=Array.from(section.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g),match=>({name:plain(match[1]),answer:plain(match[2])}));
    if(page==='landing')assert.ok(faq.length>=4,'Visible FAQ missing: '+pathname);
    const graph=JSON.stringify(publicGraph(locale,page,faq)).replaceAll('<','\\u003c');
    const tags=[
      `<title>${escape(meta.title)}</title>`,
      `<meta name="description" content="${escape(meta.description)}">`,
      '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">',
      `<link rel="canonical" href="${meta.canonical}">`,
      ...[...meta.alternates,{locale:'x-default',href:'https://virelo.riyo.me'+publicPaths.en[page]}].map(item=>`<link rel="alternate" hreflang="${item.locale}" href="${item.href}">`),
      '<link rel="alternate" type="text/markdown" href="https://virelo.riyo.me/product.md" title="Virelo product facts">',
      ...Object.entries({type:'website',url:meta.canonical,site_name:'Virelo',title:meta.title,description:meta.description,
        locale:{en:'en_US',ja:'ja_JP','zh-CN':'zh_CN',ko:'ko_KR',ru:'ru_RU'}[locale],image:meta.image,'image:secure_url':meta.image,
        'image:type':'image/png','image:width':'1200','image:height':'630','image:alt':meta.imageAlt}).map(([key,value])=>`<meta property="og:${key}" content="${escape(value)}">`),
      ...Object.entries({card:'summary_large_image',url:meta.canonical,title:meta.title,description:meta.description,image:meta.image,'image:alt':meta.imageAlt}).map(([key,value])=>`<meta name="twitter:${key}" content="${escape(value)}">`),
      `<script type="application/ld+json">${graph}</script>`
    ].join('\n    ');
    const document=template.replace('<html lang="en"',`<html lang="${locale}"`).replace('<title>Virelo</title>',tags)
      .replace('<div id="root"></div>',()=>`<div id="root">${html}</div>`);
    const file=join(dist,pathname==='/'?'index.html':pathname.slice(1)+'.html');
    await mkdir(dirname(file),{recursive:true});await writeFile(file,document);
    assert.equal((document.match(/<h1\b/g)||[]).length,1,'One H1: '+pathname);
    urls.push(meta.canonical);
    console.log('Prerendered',locale,pathname);
  }
}finally{await server.close();}
await writeFile(join(dist,'app.html'),app);
await unlink(join(dist,'landing.html'));
const sitemap=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url=>`  <url><loc>${url}</loc><lastmod>2026-11-03</lastmod></url>`).join('\n')}\n</urlset>\n`;
await writeFile(join(dist,'sitemap.xml'),sitemap);
await writeFile(join(dist,'product.md'),await readFile(join(root,'web/public/llms-full.txt'),'utf8'));
console.log('Built ten crawlable public pages; private app shell kept separate.');
