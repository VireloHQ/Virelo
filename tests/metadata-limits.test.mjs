import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VireloDB } from '../dist/db.js';
import { refreshMetadata, refreshMissingMetadata } from '../dist/metadata.js';

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'virelo-metadata-limits-')),db=new VireloDB(root);
  const originalFetch=globalThis.fetch,apiKey=process.env.VIRELO_TMDB_API_KEY;
  delete process.env.VIRELO_TMDB_API_KEY;
  t.after(async()=>{db.close();globalThis.fetch=originalFetch;if(apiKey===undefined)delete process.env.VIRELO_TMDB_API_KEY;else process.env.VIRELO_TMDB_API_KEY=apiKey;await rm(root,{recursive:true,force:true});});
  const media=join(root,'media');await mkdir(media);
  const path=join(media,'Example.mp4');await writeFile(path,'original fixture bytes');
  const library=db.addLibrary(media,'Media');
  const item=db.upsertMedia({library_id:library.id,path,filename:'Example.mp4',title:'Example',sort_title:'example',kind:'movie',series_title:null,season:null,episode:null,year:null,duration:10,width:640,height:360,video_codec:'h264',audio_codec:'aac',container:'mp4',folder:'',size:22,mtime:1,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null});
  return {root,db,item,path};
}

function oversizedResponse(prefix, megabytes, suffix, contentType) {
  let count=0,cancelled=false;
  const body=new ReadableStream({pull(controller){
    if(count===0)controller.enqueue(prefix);
    else if(count<=megabytes)controller.enqueue(Buffer.alloc(1024*1024,32));
    else {controller.enqueue(suffix);controller.close();}
    count++;
  },cancel(){cancelled=true;}});
  // The actual, decoded bytes must be bounded even when Content-Length lies.
  return {response:new Response(body,{headers:{'content-type':contentType,'content-length':'1'}}),cancelled:()=>cancelled};
}

test('oversized metadata is cancelled before parsing or issuing detail requests',async t=>{
  const {db,root,item,path}=await fixture(t);
  const large=oversizedResponse(Buffer.from('{"metas":[{"id":"tt123","name":"Example"}],"padding":"'),17,Buffer.from('"}'),'application/json');
  let requests=0;
  globalThis.fetch=async()=>{requests++;return large.response;};
  await assert.rejects(refreshMetadata(db,root,item.id),/Remote response exceeds the size limit/);
  assert.equal(large.cancelled(),true);
  assert.equal(requests,1);
  assert.equal(db.getMedia(item.id).external_id,null);
  assert.equal(await readFile(path,'utf8'),'original fixture bytes');
});

test('oversized artwork is cancelled and its temporary download is removed',async t=>{
  const {db,root,item,path}=await fixture(t);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4nUAAAAASUVORK5CYII=','base64');
  const large=oversizedResponse(png.subarray(0,32),33,png.subarray(-12),'image/png');
  globalThis.fetch=async input=>{
    if(String(input).includes('/catalog/'))return Response.json({metas:[{id:'tt123',name:'Example'}]});
    if(String(input).includes('/meta/'))return Response.json({meta:{id:'tt123',name:'Example',poster:'https://images.example/huge.png'}});
    return large.response;
  };
  const result=await refreshMissingMetadata(db,root);
  assert.equal(result.updated,1);
  assert.equal(result.artworkFailed,1);
  assert.equal(large.cancelled(),true);
  assert.equal(db.getMedia(item.id).poster_path,null);
  assert.deepEqual(await readdir(join(root,'artwork')),[]);
  assert.equal(await readFile(path,'utf8'),'original fixture bytes');
});
