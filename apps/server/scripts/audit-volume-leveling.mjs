import assert from 'node:assert/strict';
import {createRequire,stripTypeScriptTypes} from 'node:module';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||join(repo,'package.json'))('playwright');
const mode=JSON.parse(await readFile(join(repo,'package.json'),'utf8')).name==='virelo-web'?'web':'npm';
const modes=[[mode,repo]];
if(process.env.VIRELO_TEST_WEB_REPO)modes.push(['web',resolve(process.env.VIRELO_TEST_WEB_REPO)]);
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM});
try{
  for(const [mode,root] of modes){
    const values=moduleUrl(stripTypeScriptTypes(await readFile(join(root,'web/src/utils/volume-leveling.ts'),'utf8')));
    const graph=moduleUrl(stripTypeScriptTypes(await readFile(join(root,'web/src/utils/volume-leveler.ts'),'utf8')).replace("'./volume-leveling'",JSON.stringify(values)));
    const page=await browser.newPage();
    const results=await page.evaluate(async graph=>{
      const {createLevelingGraph,LEVELING_LOOKAHEAD,LEVELING_RECOVERY_HOLD,LEVELING_RECOVERY_DB_PER_SECOND}=await import(graph);
      const render=async({amplitude=.9,volume=1,frequency=440,transition,antiphase=false,enabled=true,muted=false,sampleRate=48000,noise=false,impulse=false}={})=>{
        const context=new OfflineAudioContext(2,sampleRate*2,sampleRate),buffer=context.createBuffer(2,sampleRate*2,sampleRate);
        let seed=1;
        for(let index=0;index<buffer.length;index++){
          seed=(Math.imul(seed,1664525)+1013904223)>>>0;
          const level=transition&&index<sampleRate*.25?transition[0]:transition?transition[1]:amplitude;
          const sample=(impulse?(index===Math.floor(sampleRate*.25)?1:0):noise?seed/4294967296*2-1:Math.sin(index/sampleRate*2*Math.PI*frequency))*level;
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
        const harmonicAmplitude=hz=>{
          let real=0,imaginary=0;
          const start=Math.round(1.5*sampleRate),end=Math.round(1.9*sampleRate);
          for(let index=start;index<end;index++){
            const phase=2*Math.PI*hz*index/sampleRate;
            real+=samples[index]*Math.cos(phase);imaginary+=samples[index]*Math.sin(phase);
          }
          return 2*Math.hypot(real,imaginary)/(end-start);
        };
        let harmonicEnergy=0;
        if(!transition&&!noise&&!impulse)for(let harmonic=2;harmonic<=10;harmonic++)harmonicEnergy+=harmonicAmplitude(frequency*harmonic)**2;
        const distortion=Math.sqrt(harmonicEnergy)/harmonicAmplitude(frequency);
        return {first:measure(transition ? .25+LEVELING_LOOKAHEAD+.006 : LEVELING_LOOKAHEAD+.006,transition ? .35+LEVELING_LOOKAHEAD+.006 : LEVELING_LOOKAHEAD+.106),steady:measure(1.65,1.85),all:measure(0,2),start:first/sampleRate,distortion};
      };
      const timingContext=new OfflineAudioContext(2,48000,48000),timingSource=timingContext.createBufferSource();
      const timingGraph=createLevelingGraph(timingContext,timingSource);
      const detector=timingGraph.nodes.find(node=>node instanceof BiquadFilterNode&&node.type==='lowpass');
      const timing={detectorHz:detector.frequency.value,attack:timingGraph.limiter.attack.value,release:timingGraph.limiter.release.value};
      timingGraph.nodes.forEach(node=>node.disconnect());
      const holdTiming=[];
      for(const [from,to] of [[.8,.2],[.2,.8]]){
        const context=new OfflineAudioContext(1,96000,48000),source=context.createBufferSource();
        const nodes=createLevelingGraph(context,source),signal=context.createConstantSource();
        nodes.output.disconnect();
        nodes.nodes.find(node=>node instanceof BiquadFilterNode&&node.type==='lowpass').disconnect();
        const response=nodes.nodes.find(node=>node instanceof WaveShaperNode&&node.curve.length===262145);
        response.curve=new Float32Array([-1,1]);
        signal.offset.value=from;signal.offset.setValueAtTime(to,.25);signal.connect(response);signal.start();
        nodes.nodes.at(-1).connect(context.destination);
        const samples=(await context.startRendering()).getChannelData(0);
        let changed=11520;
        while(changed<samples.length&&(to<from?samples[changed]>=.5:samples[changed]<=from+.00001))changed++;
        holdTiming.push(changed/48000);
      }
      const burstContext=new OfflineAudioContext(2,48000*3,48000),burst=burstContext.createBuffer(2,48000*3,48000);
      for(let index=0;index<burst.length;index++){
        const time=index/48000;
        const bass=time<.25?0:.7*Math.exp(-(time-.25)/.12)*Math.sin(2*Math.PI*40*(time-.25));
        for(let channel=0;channel<2;channel++)burst.getChannelData(channel)[index]=.04*Math.sin(2*Math.PI*500*time)+bass;
      }
      const burstSource=burstContext.createBufferSource();burstSource.buffer=burst;
      const burstGraph=createLevelingGraph(burstContext,burstSource),monitor=burstContext.createChannelMerger(2);
      burstGraph.volume(1,false);burstGraph.enable(true);burstGraph.output.disconnect();
      burstGraph.output.connect(monitor,0,0);
      // Observe the control signal separately; never send it to a real audio device.
      burstGraph.nodes.at(-1).connect(monitor,0,1);monitor.connect(burstContext.destination);burstSource.start();
      const burstResult=await burstContext.startRendering(),envelope=burstResult.getChannelData(1);
      let downward=0,upward=0,previous=envelope[48000],burstPeak=0,maxRecoveryDbPerSecond=0,maxStepDb=0,maxDipDb=0;
      for(let index=48048;index<48000*2.8;index+=48){
        const change=envelope[index]-previous;
        if(previous>0&&envelope[index]>0){const step=20*Math.log10(envelope[index]/previous);maxStepDb=Math.max(maxStepDb,step);maxDipDb=Math.max(maxDipDb,-step);}
        if(index>=50400&&envelope[index-2400]>0)maxRecoveryDbPerSecond=Math.max(maxRecoveryDbPerSecond,20*Math.log10(envelope[index]/envelope[index-2400])/.05);
        if(change<0)downward-=change;else upward+=change;
        previous=envelope[index];
      }
      for(const sample of burstResult.getChannelData(0))burstPeak=Math.max(burstPeak,Math.abs(sample));
      let attenuated=12000;
      while(attenuated<48000&&envelope[attenuated]>1)attenuated++;
      const burstRecovery={downward,upward,ratio:downward/upward,peak:burstPeak,attack:attenuated/48000-.25,maxRecoveryDbPerSecond,maxStepDb,maxDipDb};
      return {
        loud:await render(),medium:await render({amplitude:.1}),quiet:await render({amplitude:.02}),
        silence:await render({transition:[0,.9]}),jump:await render({transition:[.04,.9]}),
        tailQuiet:await render({transition:[.9,.04]}),tailSilence:await render({transition:[.9,0]}),impulse:await render({impulse:true}),
        bass:await render({frequency:40}),bass30:await render({frequency:30}),bass45:await render({frequency:45}),
        bass60:await render({frequency:60}),bass75:await render({frequency:75}),bass100:await render({frequency:100}),noise:await render({noise:true}),
        half:await render({volume:.5}),antiphase:await render({antiphase:true}),
        muted:await render({muted:true}),off:await render({enabled:false}),
        rate44100:await render({sampleRate:44100}),rate96000:await render({sampleRate:96000}),
        bass44100:await render({frequency:40,sampleRate:44100}),bass96000:await render({frequency:40,sampleRate:96000}),
        lookahead:LEVELING_LOOKAHEAD,timing,holdTiming,burstRecovery,recoveryHold:LEVELING_RECOVERY_HOLD,recoveryRate:LEVELING_RECOVERY_DB_PER_SECOND
      };
    },graph);
    for(const name of ['loud','medium','quiet','silence','jump','bass','noise','rate44100','rate96000']){
      const {first,steady}=results[name],difference=20*Math.log10(first.rms/steady.rms);
      assert.ok(difference<2&&difference>-3,mode+' '+name+' opening stays protected without a long fade-in: '+difference);
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
    assert.equal(results.lookahead,.03,'audible lookahead remains 30ms');
    assert.equal(results.timing.detectorHz,25,'detector response speed is unchanged');
    assert.ok(Math.abs(results.timing.attack-.003)<1e-8&&Math.abs(results.timing.release-.15)<1e-7,'limiter attack/release timing is unchanged');
    assert.ok(Math.abs(results.holdTiming[0]-.25)<2/48000,'gain attenuation is not delayed by the denser hold');
    assert.ok(Math.abs(results.holdTiming[1]-(.25+results.recoveryHold))<.012,'only upward recovery uses the new hold; attenuation stays immediate');
    for(const name of ['loud','rate44100','rate96000'])assert.ok(results[name].start>=.029&&results[name].start<.045,mode+' '+name+' adds no playback latency');
    for(const name of ['bass30','bass','bass45','bass60','bass75','bass100','bass44100','bass96000']){
      console.log('MEASURE',mode,name,'distortion',(results[name].distortion*100).toFixed(4)+'%');
      assert.ok(results[name].distortion<.001,mode+' '+name+' gain tracking does not distort steady bass: '+results[name].distortion);
    }
    console.log('MEASURE',mode,'bass-burst recovery',JSON.stringify(results.burstRecovery));
    assert.ok(results.burstRecovery.upward>.01,'gain recovers after a loud decaying bass burst');
    assert.ok(results.burstRecovery.maxRecoveryDbPerSecond<results.recoveryRate+.7,'recovery stays bounded over perceptual 50ms windows');
    assert.ok(results.burstRecovery.maxStepDb<.04&&results.burstRecovery.maxDipDb<.01,'recovery has no audible gain jumps or repeated dips');
    assert.ok(results.burstRecovery.attack<.015,'a bass burst is attenuated within the existing lookahead');
    assert.ok(results.burstRecovery.peak<.4,'a bass burst does not cause an opening or recovery blast');
    console.log('PASS',mode,'manual volume, stereo, mute, bypass and bounded lookahead');
    await page.close();
  }
}finally{await browser.close();}
