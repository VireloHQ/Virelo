import assert from 'node:assert/strict';
import {createRequire,stripTypeScriptTypes} from 'node:module';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||join(repo,'package.json'))('playwright');
const modes=[['npm',repo]];
if(process.env.VIRELO_TEST_WEB_REPO)modes.push(['web',resolve(process.env.VIRELO_TEST_WEB_REPO)]);
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM});
try{
  for(const [mode,root] of modes){
    const values=moduleUrl(stripTypeScriptTypes(await readFile(join(root,'web/src/utils/volume-leveling.ts'),'utf8')));
    const graph=moduleUrl(stripTypeScriptTypes(await readFile(join(root,'web/src/utils/volume-leveler.ts'),'utf8')).replace("'./volume-leveling'",JSON.stringify(values)));
    const page=await browser.newPage();
    const results=await page.evaluate(async graph=>{
      const {createLevelingGraph,LEVELING_LOOKAHEAD}=await import(graph);
      const render=async({amplitude=.9,volume=1,frequency=440,transition,antiphase=false,enabled=true,muted=false,sampleRate=48000,noise=false,impulse=false}={})=>{
        const context=new OfflineAudioContext(2,sampleRate,sampleRate),buffer=context.createBuffer(2,sampleRate,sampleRate);
        let seed=1;
        for(let index=0;index<sampleRate;index++){
          seed=(Math.imul(seed,1664525)+1013904223)>>>0;
          const level=transition&&index<sampleRate*.25?transition[0]:transition?transition[1]:amplitude;
          const sample=(impulse?(index===Math.floor(sampleRate*.25)?1:0):noise?seed/4294967296*2-1:Math.sin(index/sampleRate*2*Math.PI*frequency))*level*volume;
          buffer.getChannelData(0)[index]=sample;buffer.getChannelData(1)[index]=sample*(antiphase?-1:1);
        }
        const source=context.createBufferSource();source.buffer=buffer;
        const nodes=createLevelingGraph(context,source);nodes.volume(volume,muted);nodes.enable(enabled);source.start();
        const samples=(await context.startRendering()).getChannelData(0);
        const measure=(start,end)=>{
          let energy=0,peak=0;
          for(let index=Math.floor(start*sampleRate);index<Math.floor(end*sampleRate);index++){energy+=samples[index]**2;peak=Math.max(peak,Math.abs(samples[index]));}
          return {rms:Math.sqrt(energy/(Math.floor(end*sampleRate)-Math.floor(start*sampleRate))),peak};
        };
        let first=0;while(first<samples.length&&Math.abs(samples[first])<.00001)first++;
        return {first:measure(transition ? .25+LEVELING_LOOKAHEAD+.006 : LEVELING_LOOKAHEAD+.006,transition ? .35+LEVELING_LOOKAHEAD+.006 : LEVELING_LOOKAHEAD+.106),steady:measure(.65,.85),all:measure(0,1),start:first/sampleRate};
      };
      return {
        loud:await render(),medium:await render({amplitude:.1}),quiet:await render({amplitude:.02}),
        silence:await render({transition:[0,.9]}),jump:await render({transition:[.04,.9]}),
        tailQuiet:await render({transition:[.9,.04]}),tailSilence:await render({transition:[.9,0]}),impulse:await render({impulse:true}),
        bass:await render({frequency:40}),noise:await render({noise:true}),
        half:await render({volume:.5}),antiphase:await render({antiphase:true}),
        muted:await render({muted:true}),off:await render({enabled:false}),
        rate44100:await render({sampleRate:44100}),rate96000:await render({sampleRate:96000})
      };
    },graph);
    for(const name of ['loud','medium','quiet','silence','jump','bass','noise','rate44100','rate96000']){
      const {first,steady}=results[name],difference=20*Math.log10(first.rms/steady.rms);
      assert.ok(Math.abs(difference)<2,mode+' '+name+' first audible window stays within 2dB of settled output: '+difference);
      assert.ok(first.peak<.4,mode+' '+name+' has no loud opening burst: '+first.peak);
      console.log('PASS',mode,name,'opening difference',difference.toFixed(3)+'dB');
    }
    assert.ok(Math.abs(results.half.steady.rms/results.loud.steady.rms-.5)<.015,'manual volume remains proportional');
    assert.ok(Math.abs(results.antiphase.steady.rms/results.loud.steady.rms-1)<.01,'antiphase stereo does not disappear in the detector');
    assert.equal(results.muted.steady.peak,0,'mute stays silent');
    assert.ok(results.off.steady.rms>.6,'disabled processing preserves original loudness');
    assert.ok(results.loud.start>=.029&&results.loud.start<.045,'bounded lookahead does not add a long playback delay');
    for(const name of ['tailQuiet','tailSilence'])assert.ok(results[name].all.peak<.4,mode+' '+name+' does not boost the queued loud tail: '+results[name].all.peak);
    assert.ok(results.impulse.all.peak<=1,mode+' transient limiter prevents clipping: '+results.impulse.all.peak);
    console.log('PASS',mode,'manual volume, stereo, mute, bypass and bounded lookahead');
    await page.close();
  }
}finally{await browser.close();}
