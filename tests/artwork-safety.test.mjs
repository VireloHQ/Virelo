import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {VireloDB} from '../dist/db.js';
import {refreshMissingMetadata} from '../dist/metadata.js';

test('provider IDs cannot escape the artwork folder and failed downloads are reported without halting matching',async t=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-artwork-safety-')),data=join(root,'data');await mkdir(data);
  const db=new VireloDB(data),previous=globalThis.fetch,key=process.env.VIRELO_TMDB_API_KEY;delete process.env.VIRELO_TMDB_API_KEY;
  t.after(async()=>{db.close();globalThis.fetch=previous;if(key===undefined)delete process.env.VIRELO_TMDB_API_KEY;else process.env.VIRELO_TMDB_API_KEY=key;await rm(root,{recursive:true,force:true});});
  const library=db.addLibrary(join(root,'media'),'Media');
  const item=db.upsertMedia({library_id:library.id,path:join(library.path,'Example.mp4'),filename:'Example.mp4',title:'Example',sort_title:'example',kind:'movie',
    series_title:null,season:null,episode:null,year:null,duration:10,width:640,height:360,video_codec:'h264',audio_codec:'aac',container:'mp4',
    folder:'',size:1,mtime:1,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null});
  const id='nested/../../../outside',protectedFile=join(root,'outside-poster.jpg');await writeFile(protectedFile,'keep original');
  let valid=false;
  globalThis.fetch=async input=>{
    const url=String(input);
    if(url.includes('/catalog/movie/'))return Response.json({metas:[{id,name:'Example'}]});
    if(url.includes('/meta/movie/'))return Response.json({meta:{id,name:'Example',poster:'https://images.example/poster.jpg',background:'https://images.example/backdrop.jpg'}});
    if(url.startsWith('https://images.example/'))return new Response(valid?Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4nUAAAAASUVORK5CYII=','base64'):Buffer.from('not an image'),{headers:{'content-type':'image/png'}});
    throw Error('Unexpected fixture request');
  };
  const failed=await refreshMissingMetadata(db,data);assert.equal(failed.updated,1);assert.equal(failed.artworkFailed,2);
  assert.equal(db.getMedia(item.id).poster_path,null);assert.deepEqual(await readdir(join(data,'artwork')),[]);
  valid=true;
  const repaired=await refreshMissingMetadata(db,data);assert.equal(repaired.artworkFailed,0);
  for(const path of [db.getMedia(item.id).poster_path,db.getMedia(item.id).backdrop_path]){
    assert.ok(!relative(join(data,'artwork'),path).startsWith('..'));assert.match(path,/nested%2F/);
  }
  assert.equal(await readFile(protectedFile,'utf8'),'keep original');
});
