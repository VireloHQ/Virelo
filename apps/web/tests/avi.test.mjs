import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AVI_CORE_PATH,AVI_MAX_FILE_BYTES,isAviFile,aviPlaybackInfo} from '../web/src/utils/avi.ts';

const metadata=()=>({format:{format_name:'avi',duration:'40.048'},streams:[
 {index:0,codec_type:'video',codec_name:'mpeg4',width:960,height:540,duration:'40'},
 {index:1,codec_type:'audio',codec_name:'mp3',channels:1,channel_layout:'mono',tags:{language:'eng'},disposition:{}},
 {index:2,codec_type:'audio',codec_name:'pcm_s16le',channels:2,channel_layout:'stereo',tags:{title:'Alternate'},disposition:{default:1}}
]});
test('AVI sniffing checks the RIFF AVI signature, not just the extension',async()=>{
 const header=new Uint8Array(12);header.set(new TextEncoder().encode('RIFF'));header.set(new TextEncoder().encode('AVI '),8);
 assert.equal(await isAviFile(new File([header],'clip.AVI')),true);
 assert.equal(await isAviFile(new File(['not an avi container'],'clip.avi')),false);
 assert.equal(await isAviFile(new File([header],'clip.mp4')),false);
 assert.equal(await isAviFile(new File(['RIFF'],'clip.avi')),false);
});
test('AVI metadata preserves source resolution, selectable audio and the video timeline',()=>{
 const info=aviPlaybackInfo(metadata());
 assert.equal(info.duration,40);assert.equal(info.videoCodec,'mpeg4');assert.equal(info.width,960);assert.equal(info.height,540);
 assert.deepEqual(info.qualityOptions.map(q=>q.height),[540,480,360]);
 assert.equal(info.defaultAudioStream,2);assert.deepEqual(info.audioTracks.map(t=>t.index),[1,2]);
 assert.equal(info.audioTracks[0].language,'eng');assert.equal(info.audioTracks[1].title,'Alternate');
 assert.equal(info.requiresTranscode,true);assert.equal(info.requiresVideoTranscode,true);
});
test('AVI metadata supports silent video and format-duration fallback',()=>{
 const data=metadata();data.streams=data.streams.slice(0,1);delete data.streams[0].duration;
 const info=aviPlaybackInfo(data);assert.equal(info.duration,40.048);assert.equal(info.defaultAudioStream,null);assert.equal(info.requiresAudioTranscode,false);
});
test('invalid AVI metadata is rejected instead of allocating unbounded frames or timelines',()=>{
 for(const value of [null,{}, {format:{format_name:'mp4'},streams:[]}])assert.throws(()=>aviPlaybackInfo(value));
 for(const [key,value] of [['width',0],['height',-1],['width',Infinity],['width',30000]]){
  const data=metadata();data.streams[0][key]=value;assert.throws(()=>aviPlaybackInfo(data));
 }
 for(const value of ['NaN','0','-1','604801']){
  const data=metadata();delete data.streams[0].duration;data.format.duration=value;assert.throws(()=>aviPlaybackInfo(data));
 }
 const data=metadata();data.streams[1].index=-1;assert.throws(()=>aviPlaybackInfo(data));
});
test('AVI codec assets are versioned with the pinned package and a conservative browser size limit',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(AVI_CORE_PATH,'/assets/ffmpeg-'+pkg.dependencies['@ffmpeg/core']);
 assert.ok(AVI_MAX_FILE_BYTES<=2**31);
});
