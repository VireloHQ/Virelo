import assert from 'node:assert/strict';
import {createRequire,stripTypeScriptTypes} from 'node:module';
import {readFile} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)('playwright');
const moduleUrl=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const values=moduleUrl(stripTypeScriptTypes(await readFile(new URL('../../../packages/web-ui/src/utils/volume-leveling.ts',import.meta.url),'utf8')));
const graph=moduleUrl(stripTypeScriptTypes(await readFile(new URL('../../../packages/web-ui/src/utils/volume-leveler.ts',import.meta.url),'utf8')).replace("'./volume-leveling'",JSON.stringify(values)));
const browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM});
try {
  const page=await browser.newPage();
  const results=await page.evaluate(async graph=>{
    const {createLevelingGraph,LEVELING_LOOKAHEAD}=await import(graph);
    const render=async({rate=48000,frequency=440,amplitude=.01,channels=2,measurement,enabled=true,volume=1,muted=false,contrast=false})=>{
      const context=new OfflineAudioContext(channels,rate*4,rate),input=context.createBuffer(channels,rate*4,rate);
      for(let channel=0;channel<channels;channel++)for(let i=0;i<input.length;i++){
        const level=contrast?(i<rate?.02:i<rate*2?.4:.04):amplitude;
        input.getChannelData(channel)[i]=level*Math.sin(2*Math.PI*frequency*i/rate);
      }
      const source=context.createBufferSource();source.buffer=input;
      const node=createLevelingGraph(context,source);node.measurement(measurement);node.volume(volume,muted);node.enable(enabled);
      source.start();
      const output=await context.startRendering();
      const windows=[.5,1.5,2.5].map(start=>{
        let original=0,audible=0;
        for(let channel=0;channel<channels;channel++)for(let i=Math.round(start*rate);i<Math.round((start+.2)*rate);i++){
          original+=input.getChannelData(channel)[i]**2;
          audible+=output.getChannelData(channel)[i]**2;
        }
        return {ratio:Math.sqrt(audible/original),db:10*Math.log10(audible/original)};
      });
      node.dispose();node.nodes.forEach(node=>node.disconnect());
      return {windows,lookahead:LEVELING_LOOKAHEAD};
    };
    const quiet=[];
    for(const rate of [44100,48000,96000])for(const frequency of [40,440,2100])for(const channels of [1,2])
      quiet.push({rate,frequency,channels,...await render({rate,frequency,channels})});
    return {
      quiet,
      measured:await render({contrast:true,measurement:{integratedLufs:-12,truePeakDb:-5}}),
      measuredQuiet:await render({measurement:{integratedLufs:-35,truePeakDb:-20}}),
      half:await render({contrast:true,measurement:{integratedLufs:-12,truePeakDb:-5},volume:.5}),
      off:await render({measurement:{integratedLufs:-12,truePeakDb:-5},enabled:false}),
      muted:await render({measurement:{integratedLufs:-12,truePeakDb:-5},muted:true}),
      invalid:await render({measurement:{integratedLufs:NaN,truePeakDb:-5}})
    };
  },graph);
  for(const fixture of results.quiet)for(const window of fixture.windows)
    assert.ok(window.ratio<=1.0001,'quiet audio must never be boosted: '+JSON.stringify(fixture));
  for(const window of results.measured.windows)assert.ok(Math.abs(window.db+6)<.05,'the same measured gain preserves every scene: '+JSON.stringify(window));
  for(const window of results.measuredQuiet.windows)assert.ok(window.ratio<=1.0001,'a quiet measured recording is not boosted');
  for(let i=0;i<3;i++)assert.ok(Math.abs(results.half.windows[i].ratio/results.measured.windows[i].ratio-.5)<.001,'manual volume applies after measured gain');
  assert.ok(Math.abs(results.off.windows[0].db)<.001,'OFF remains the original level');
  assert.equal(results.muted.windows[0].ratio,0,'mute stays silent');
  assert.ok(results.invalid.windows.every(window=>Number.isFinite(window.ratio)&&window.ratio<=1.0001),'invalid measurements safely fall back');
  assert.equal(results.measured.lookahead,.03,'measured playback adds no new delay');
  console.log('PASS attenuation-only audio in 18 frequency/rate/channel combinations; constant -6dB measured gain, scene contrast, volume, mute, bypass and 30ms lookahead');
}finally{await browser.close();}

