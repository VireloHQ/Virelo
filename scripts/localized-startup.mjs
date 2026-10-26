import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
export function localizedStartup(directory) {
  return {
    name: 'localized-startup',
    transformIndexHtml(html) {
      const keys=Array.from(html.matchAll(/data-startup-message="([^"]+)"/g),match=>match[1]);
      keys.push('The app did not finish starting. Check that the server is still running.','The app stopped before it could display a page. Try again.','Could not load {url}');
      const catalogs=Object.fromEntries(readdirSync(directory).filter(file=>file.endsWith('.json')).map(file=>{
        const catalog=JSON.parse(readFileSync(join(directory,file),'utf8'));
        return [file.slice(0,-5),Object.fromEntries(keys.map(key=>[key,catalog[key]??key]))];
      }));
      return {html,tags:[{tag:'template',attrs:{id:'startup-catalogs'},children:JSON.stringify(catalogs).replaceAll('&','\\u0026').replaceAll('<','\\u003c'),injectTo:'body-prepend'}]};
    }
  };
}
