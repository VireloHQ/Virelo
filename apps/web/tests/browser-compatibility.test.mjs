import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAppearanceTestModule } from './appearance-test-loader.mjs';

const api = await loadAppearanceTestModule('browser-compatibility.ts', {
  mediabunny: `
    export const ALL_FORMATS=[];
    export class BlobSource { constructor(file){this.file=file;} }
    export class Input {
      constructor({source}) {this.state=globalThis.__compatibility; this.state.inputs++;}
      async getPrimaryVideoTrack() {
        const s=this.state;
        if(s.failure)throw new Error('Synthetic parser failure');
        if(s.pending)return new Promise(()=>{});
        if(s.noVideo)return null;
        return {getCodec:async()=>s.videoCodec,getInternalCodecId:async()=> 'V_SYNTHETIC',
          getDisplayWidth:async()=>640,getDisplayHeight:async()=>360};
      }
      async getPrimaryAudioTrack() {
        const s=this.state;
        return s.silent?null:{getCodec:async()=>s.audioCodec,getInternalCodecId:async()=> 'A_SYNTHETIC',canDecode:async()=>s.audioSupported};
      }
      async getDurationFromMetadata(){return 12;}
      dispose(){this.state.disposed++;}
    }`
});

function fixture(t, changes={}) {
  const state={inputs:0,disposed:0,videoCodec:'avc',audioCodec:'aac',audioSupported:true,...changes};
  globalThis.__compatibility=state;
  t.after(()=>{delete globalThis.__compatibility;});
  return state;
}

test('software playback is limited to unknown video codecs or unsupported audio',()=>{
  assert.equal(api.needsSoftwarePlayback('avc'),false);
  assert.equal(api.needsSoftwarePlayback('hevc'),false);
  assert.equal(api.needsSoftwarePlayback(null),true);
  assert.equal(api.needsSoftwarePlayback('avc',false),true);
});
test('header inspection preserves native AAC even without a WebCodecs audio decoder',async t=>{
  const state=fixture(t,{audioSupported:false});
  const info=await api.inspectPlaybackCompatibility(new File(['synthetic'],'native.mp4'));
  assert.equal(info.requiresConversion,false);assert.equal(info.duration,12);assert.equal(state.disposed,1);
});
test('legacy MKV video is detected without decoding a frame or starting FFmpeg',async t=>{
  const state=fixture(t,{videoCodec:null});
  const info=await api.inspectPlaybackCompatibility(new File(['synthetic'],'legacy.mkv'));
  assert.equal(info.requiresConversion,true);assert.equal(info.videoCodec,'V_SYNTHETIC');
  assert.equal(info.width,640);assert.equal(state.inputs,1);assert.equal(state.disposed,1);
});
test('large native files are not incorrectly restricted by the software converter size limit',async t=>{
  fixture(t);
  const file=new File(['synthetic'],'large-native.mp4');Object.defineProperty(file,'size',{value:3_000_000_000});
  assert.equal((await api.inspectPlaybackCompatibility(file)).requiresConversion,false);
});
test('unsupported WMA-like audio needs conversion even with native video',async t=>{
  fixture(t,{audioCodec:null,audioSupported:false});
  const info=await api.inspectPlaybackCompatibility(new File(['synthetic'],'audio.mkv'));
  assert.equal(info.requiresConversion,true);assert.equal(info.audioCodec,'A_SYNTHETIC');
});
test('existing AC3 decoder and silent native video do not trigger software-video warnings',async t=>{
  const state=fixture(t,{audioCodec:'ac3',audioSupported:false});
  assert.equal((await api.inspectPlaybackCompatibility(new File(['synthetic'],'audio.mkv'))).requiresConversion,false);
  state.silent=true;
  assert.equal((await api.inspectPlaybackCompatibility(new File(['synthetic'],'silent.mkv'))).requiresConversion,false);
});
test('AVI warning is identified from its signature without loading a decoder',async t=>{
  const state=fixture(t),header=new Uint8Array(12);
  header.set(new TextEncoder().encode('RIFF'));header.set(new TextEncoder().encode('AVI '),8);
  assert.equal((await api.inspectPlaybackCompatibility(new File([header],'synthetic.avi'))).requiresConversion,true);
  assert.equal(state.inputs,0);assert.equal(state.disposed,0);
});
test('unreadable metadata does not abort the library scan and disposes the input',async t=>{
  const state=fixture(t,{failure:true});
  assert.equal(await api.inspectPlaybackCompatibility(new File(['synthetic'],'unreadable.mkv')),null);
  assert.equal(state.disposed,1);
});
test('metadata checks time out instead of blocking a scan indefinitely',async t=>{
  const state=fixture(t,{pending:true}),start=Date.now();
  assert.equal(await api.inspectPlaybackCompatibility(new File(['synthetic'],'pending.mkv')),null);
  assert.ok(Date.now()-start<5000);assert.equal(state.disposed,1);
});
