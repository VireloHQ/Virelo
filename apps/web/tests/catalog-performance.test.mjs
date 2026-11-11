import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAppearanceTestModule as load} from './appearance-test-loader.mjs';

let serial=0;
async function catalog(t,count=5000){
  const key='__catalogPerf'+(++serial),state={reads:[],settings:{shortsIncludeLandscapes:false},items:Array.from({length:count},(_,index)=>({
    id:index+1,library_id:index%2+1,filename:'clip-'+index+'.mp4',title:'Clip '+index,sort_title:String(index).padStart(5,'0'),
    kind:'video',folder:index%3?'Movies/Sub':'Movies',width:index%5?1920:1080,height:index%5?1080:1920,
    liked:index%7===0?1:0,mtime:index,thumbnail_path:null
  }))};
  globalThis[key]=state;t.after(()=>delete globalThis[key]);
  const other=['addLocalLibrary','renameLocalLibrary','browserCapabilities','clearLocalMetadata','clearAllLocalMetadata',
    'getLocalScanStatus','getStoredMedia','ensureLocalThumbnail','listLocalLibraries','localMediaFile','localMediaUrl',
    'reconnectLocalLibrary','removeLocalLibrary','updateStoredMedia','startLocalScan','writeSettings'];
  const library=`const state=globalThis[${JSON.stringify(key)}];
    export const listStoredMedia=async()=>[...state.items];
    export const readSettings=async()=>state.settings;
    export const hydrateMedia=async item=>{state.reads.push(item.id);return {...item,thumbnail_path:'thumb:'+item.id};};
    ${other.map(name=>'export const '+name+'=()=>{};').join('\n')}`;
  const playlists=['createLocalPlaylist','deleteLocalPlaylist','getLocalPlaylist','listLocalPlaylists','updateLocalPlaylist'];
  const {api}=await load('api.ts',{'./local-library':library,'./local-playlists':playlists.map(name=>'export const '+name+'=()=>{};').join('\n')});
  return {api,state};
}

test('a filtered library page reads thumbnails only for the selected page, not all 5,000 videos',async t=>{
  const {api,state}=await catalog(t);
  const expected=state.items.filter(item=>item.library_id===2&&item.liked).slice(3,15);
  const result=await api.media({libraryId:2,liked:1,offset:3,limit:12});
  assert.deepEqual(result.map(item=>item.id),expected.map(item=>item.id));
  assert.deepEqual(state.reads,expected.map(item=>item.id));
  assert.ok(result.every(item=>item.thumbnail_path==='thumb:'+item.id));
  assert.ok(state.items.every(item=>item.thumbnail_path===null));
});

test('searches with no matches do not touch thumbnail storage',async t=>{
  const {api,state}=await catalog(t);
  assert.deepEqual(await api.media({search:'no-such-title',limit:20}),[]);
  assert.deepEqual(state.reads,[]);
});

test('folder recursion, search and sort retain their original results before thumbnail lookup',async t=>{
  const {api,state}=await catalog(t,60);
  const expected=state.items.filter(item=>item.folder==='Movies'&&item.title.toLowerCase().includes('1')).sort((a,b)=>b.mtime-a.mtime).slice(1,4);
  const result=await api.media({folder:'Movies',recursive:0,search:'1',sort:'newest',offset:1,limit:3});
  assert.deepEqual(result.map(item=>item.id),expected.map(item=>item.id));
  assert.equal(state.reads.length,expected.length);
});

test('Shorts retains deterministic order, totals, start position and liked state while hydrating only its page',async t=>{
  const {api,state}=await catalog(t);
  const full=await api.shorts({limit:5000,seed:123,startId:6});
  assert.equal(full.total,1000);assert.equal(full.items[0].id,6);
  state.reads.length=0;
  const page=await api.shorts({offset:25,limit:12,seed:123,startId:6});
  assert.equal(page.total,full.total);
  assert.deepEqual(page.items,full.items.slice(25,37));
  assert.deepEqual(state.reads,page.items.map(item=>item.id));
});

test('a landscape-only library with Shorts disabled performs no thumbnail reads for the Shorts row',async t=>{
  const {api,state}=await catalog(t);
  state.items.forEach(item=>{item.width=1920;item.height=1080;});
  assert.deepEqual(await api.shorts({limit:12}),{items:[],total:0});
  assert.deepEqual(state.reads,[]);
});

test('landscape inclusion and unpaginated media remain available',async t=>{
  const {api,state}=await catalog(t,50);
  state.settings.shortsIncludeLandscapes=true;
  assert.equal((await api.shorts({limit:8})).total,50);
  assert.equal(state.reads.length,8);
  state.reads.length=0;
  assert.equal((await api.media()).length,50);
  assert.equal(state.reads.length,50);
});
