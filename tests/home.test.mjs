import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHome,distinctDiscoveryShelves,mediaGenres,moviesOutsideRecent} from '../dist/home.js';
const item=(id,patch={})=>({id,library_id:1,title:'Title '+id,kind:'movie',series_title:null,season:null,episode:null,
  duration:7200,width:1920,height:1080,genres:null,added_at:id,updated_at:id,...patch});
const episode=(id,n,patch={})=>item(id,{kind:'series',series_title:'A series',season:1,episode:n,duration:1200,...patch});
test('favorites preserve each liked episode rather than collapsing a series', () => {
  assert.deepEqual(buildHome([episode(1, 1, { liked: 1 }), episode(2, 2, { liked: 1 })]).favorites.map(value => value.id), [2, 1]);
});

test('series shelves use one title and continue from the next numbered episode',()=>{
  const data=buildHome([episode(1,1,{progress_completed:1}),episode(2,2),episode(3,3),episode(4,0,{season:0})]);
  assert.equal(data.series.length,1);assert.equal(data.series[0].id,2);
  assert.deepEqual(data.nextEpisodes.map(i=>i.id),[2]);assert.equal(data.unwatched.length,0);
  assert.equal(data.recent.length,1);
});
test('partial episodes stay in Continue watching without duplicate Up next entries',()=>{
  const data=buildHome([episode(1,1,{progress_completed:1}),episode(2,2,{progress_position:100,progress_updated_at:90}),episode(3,3)]);
  assert.deepEqual(data.continueWatching.map(i=>i.id),[2]);assert.equal(data.nextEpisodes.length,0);
  assert.equal(data.series[0].id,2);
});
test('episode selection does not wrap to an earlier season or invent a missing episode',()=>{
  assert.equal(buildHome([episode(1,1),episode(2,2,{progress_completed:1})]).nextEpisodes.length,0);
  assert.equal(buildHome([episode(1,1,{progress_completed:1}),episode(2,4,{season:2})]).nextEpisodes[0].id,2);
});
test('new shows start at their first episode and duplicates across libraries remain separate',()=>{
  const data=buildHome([episode(20,8),episode(1,1),episode(30,1,{library_id:2})]);
  assert.deepEqual(new Set(data.series.map(i=>i.id)),new Set([1,30]));
  assert.equal(data.unwatched.length,2);
  assert.ok(data.unwatched.some(i=>i.id===1));assert.ok(!data.unwatched.some(i=>i.id===20));
});
test('portrait clips are separate from movie discovery and short movies use real durations',()=>{
  const data=buildHome([item(1,{duration:5400}),item(2,{duration:60}),item(3,{duration:5401}),
    item(4,{duration:null}),item(5,{duration:10}),item(6,{duration:2000,width:720,height:1280}),item(7,{duration:3000,progress_completed:1})]);
  assert.deepEqual(data.quickWatches.map(i=>i.id),[2,1]);assert.equal(data.movies.some(i=>i.id===6),false);
  assert.equal(data.unwatched.some(i=>i.id===7),false);assert.equal(data.total,7);
  assert.deepEqual(buildHome([item(6,{width:720,height:1280,liked:1})]).favorites.map(i=>i.id),[6]);
});
test('unwatched discovery is stable within a day, includes older titles, and never mutates input',()=>{
  const items=Array.from({length:200},(_,i)=>item(i+1));const before=JSON.stringify(items);
  const first=buildHome(items,86400000).unwatched.map(i=>i.id);
  assert.deepEqual(first,buildHome(items,86400001).unwatched.map(i=>i.id));
  assert.notDeepEqual(first,buildHome(items,172800000).unwatched.map(i=>i.id));
  assert.ok(first.some(id=>id<100));assert.equal(JSON.stringify(items),before);assert.equal(first.length,24);
});
test('genres handle JSON, legacy text, duplicates and malformed metadata without fake shelves',()=>{
  assert.deepEqual(mediaGenres('["Drama","Drama","Comedy",4]'),['Drama','Comedy']);
  assert.deepEqual(mediaGenres('Action, Adventure'),['Action','Adventure']);assert.deepEqual(mediaGenres('[broken'),[]);
  const data=buildHome([item(1,{genres:'Drama'}),item(2,{genres:'Drama'}),item(3,{genres:'Drama'}),item(4,{genres:'Comedy'})]);
  assert.equal(data.genres.length,1);assert.equal(data.genres[0].name,'Drama');
  assert.equal(buildHome([item(1)]).genres.length,0);
});
test('Movies offers older titles beyond Recent before applying the shelf limit',()=>{
  const items=Array.from({length:80},(_,i)=>item(i+1)),before=JSON.stringify(items);
  const home=buildHome(items,86400000);
  assert.deepEqual(home.recent.map(i=>i.id),Array.from({length:24},(_,i)=>80-i));
  assert.deepEqual(home.movies.map(i=>i.id),Array.from({length:24},(_,i)=>56-i));
  assert.deepEqual(moviesOutsideRecent(home.movies,home.recent),home.movies);
  assert.equal(JSON.stringify(items),before);
});
test('small libraries retain movie-category candidates but do not repeat the Recent shelf',()=>{
  for(const count of [0,1,6,24]){
    const home=buildHome(Array.from({length:count},(_,i)=>item(i+1)));
    assert.equal(home.movies.length,count);
    assert.equal(home.recent.length,count);
    assert.equal(moviesOutsideRecent(home.movies,home.recent).length,0);
  }
});
test('Movies fills available older candidates without repeating the recent remainder',()=>{
  const home=buildHome(Array.from({length:29},(_,i)=>item(i+1)));
  assert.equal(home.movies.length,24);
  assert.deepEqual(moviesOutsideRecent(home.movies,home.recent).map(i=>i.id),[5,4,3,2,1]);
  assert.equal(new Set(home.movies.map(i=>i.id)).size,home.movies.length);
  assert.ok(home.movies.every(i=>i.kind==='movie'));
});
test('mixed libraries keep older movies visible without disturbing history or favorites',()=>{
  const movies=Array.from({length:30},(_,i)=>item(i+1,{liked:i===29?1:0,progress_position:i===28?100:0}));
  const home=buildHome([...movies,episode(100,1),episode(101,2),item(200,{width:720,height:1280})]);
  assert.deepEqual(home.recent.slice(0,2).map(i=>i.id),[200,101]);
  assert.equal(home.series.length,1);
  assert.ok(moviesOutsideRecent(home.movies,home.recent).some(i=>i.id===1));
  assert.ok(!home.movies.some(i=>i.id===200||i.kind==='series'));
  assert.deepEqual(home.continueWatching.map(i=>i.id),[29]);
  assert.deepEqual(home.favorites.map(i=>i.id),[30]);
});
test('bulk imports and repeated refreshes preserve deterministic complementary shelves',()=>{
  const items=Array.from({length:50},(_,i)=>item(i+1,{added_at:1000}));
  const first=buildHome(items,86400000),again=buildHome([...items].reverse(),172800000);
  assert.deepEqual(first.recent,again.recent);
  assert.deepEqual(first.movies,again.movies);
  assert.equal(moviesOutsideRecent(first.movies,first.recent).length,24);
});

test('discovery rows do not repeat Recent or each other simply by changing order',()=>{
  const recent=[item(1),item(2)],unique=[item(3),item(4)];
  const shelves=[recent.toReversed(),unique,unique.toReversed(),[item(5)],[]];
  const before=JSON.stringify(shelves);
  assert.deepEqual(distinctDiscoveryShelves(recent,shelves),[[],unique,[],[item(5)],[]]);
  assert.equal(JSON.stringify(shelves),before);
  assert.deepEqual(distinctDiscoveryShelves([],[[item(1)]]),[[item(1)]]);
});
test('duplicate discovery collections compare series titles without merging separate libraries',()=>{
  const recent=[episode(2,2)];
  assert.deepEqual(distinctDiscoveryShelves(recent,[[episode(1,1)],[episode(3,1,{library_id:2})]]),
    [[],[episode(3,1,{library_id:2})]]);
});
test('completed-by-ratio titles are not suggested as unwatched or in-progress',()=>{
  const data=buildHome([item(1,{progress_position:95,progress_duration:100}),item(2,{progress_position:20,progress_duration:100})]);
  assert.deepEqual(data.continueWatching.map(i=>i.id),[2]);assert.equal(data.unwatched.length,0);
});

test('Home keeps hidden libraries out of every discovery shelf',async()=>{
  const {mkdtemp,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {VireloDB}=await import('../dist/db.js');
  const dir=await mkdtemp(join(tmpdir(),'virelo-home-'));let db=new VireloDB(dir);
  try{
    const visible=db.addLibrary(join(dir,'visible'),'Visible',false),hidden=db.addLibrary(join(dir,'hidden'),'Hidden',false);
    for(const library of [visible,hidden])for(let i=1;i<=4;i++)db.upsertMedia({
      ...item(i),library_id:library.id,path:join(library.path,'Film '+i+'.mp4'),filename:'Film '+i+'.mp4',sort_title:'film '+i,year:2020,
      video_codec:'h264',audio_codec:'aac',container:'mp4',folder:'',size:1,mtime:1,
      thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:'Drama',external_id:null
    });
    db.close();db=new VireloDB(dir);db.addLibrary(visible.path,'Visible',false);
    const home=db.getHome();assert.equal(home.total,4);
    for(const values of Object.values(home))if(Array.isArray(values))for(const entry of values){
      if(entry.items)for(const media of entry.items)assert.equal(media.library_id,visible.id);
      else assert.equal(entry.library_id,visible.id);
    }
    db.addLibrary(hidden.path,'Hidden');assert.equal(db.getHome().total,8);
  }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
