import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes,createRequire} from 'node:module';
import {createServer} from 'node:http';
const {chromium}=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url)('playwright');
const data=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const values=data(stripTypeScriptTypes(await readFile(new URL('../web/src/utils/volume-leveling.ts',import.meta.url),'utf8')));
const graph=data(stripTypeScriptTypes(await readFile(new URL('../web/src/utils/volume-leveler.ts',import.meta.url),'utf8')).replace("'./volume-leveling'",JSON.stringify(values)));
const browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM,args:['--autoplay-policy=no-user-gesture-required']});
const server=createServer((_request,response)=>response.end('<!doctype html><body></body>'));
await new Promise(done=>server.listen(0,'127.0.0.1',done));
try{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port);
  const results=await page.evaluate(async graph=>{
    const {VolumeLeveler}=await import(graph);
    const wav=amplitude=>{
      const rate=48000,count=rate*2,bytes=new ArrayBuffer(44+count*4),view=new DataView(bytes);
      const text=(offset,value)=>[...value].forEach((char,index)=>view.setUint8(offset+index,char.charCodeAt(0)));
      text(0,'RIFF');view.setUint32(4,36+count*4,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);
      view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,rate,true);view.setUint32(28,rate*4,true);
      view.setUint16(32,4,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,count*4,true);
      for(let index=0;index<count;index++)for(let channel=0;channel<2;channel++)view.setInt16(44+index*4+channel*2,Math.sin(2*Math.PI*440*index/rate)*amplitude*32767,true);
      return URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
    };
    const video=document.body.appendChild(document.createElement('video'));video.loop=true;video.volume=.01;video.src=wav(.8);
    const leveler=new VolumeLeveler();leveler.bind([video]);
    const initialOutput=leveler.graphs.get(video).output.gain.value;
    leveler.volume(video,.01,false);leveler.enable(true);await leveler.resume();await video.play();
    const meter=leveler.context.createAnalyser();meter.fftSize=2048;
    leveler.graphs.get(video).output.connect(meter);
    const worklet=URL.createObjectURL(new Blob([`registerProcessor('measure',class extends AudioWorkletProcessor {
      process(inputs){const channel=inputs[0]?.[0];if(channel){let power=0,peak=0;for(const value of channel){power+=value*value;peak=Math.max(peak,Math.abs(value));}this.port.postMessage({time:currentTime,rms:Math.sqrt(power/channel.length),peak});}return true;}
    });`],{type:'text/javascript'}));
    await leveler.context.audioWorklet.addModule(worklet);
    const monitor=new AudioWorkletNode(leveler.context,'measure');leveler.graphs.get(video).output.connect(monitor);monitor.connect(leveler.context.destination);
    const frames=[];monitor.port.onmessage=event=>frames.push(event.data);
    const sample=async()=>{await new Promise(done=>setTimeout(done,160));const samples=new Float32Array(2048);meter.getFloatTimeDomainData(samples);return Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length);};
    const results=[];
    for(const volume of [.01,.05,.1,.25,.5,1,.5,.1,.01]){leveler.volume(video,volume,false);results.push({volume,rms:await sample()});}
    leveler.volume(video,1,false);await sample();frames.length=0;
    const changedAt=leveler.context.currentTime;leveler.volume(video,.01,false);await sample();
    const settling=frames.filter(frame=>frame.time>changedAt+.006&&frame.time<changedAt+.07);
    const peakAfterLowering=Math.max(...settling.map(frame=>frame.peak));
    const mastering=[];leveler.volume(video,.1,false);
    for(const amplitude of [.01,.02,.05,.2,.8]){video.src=wav(amplitude);await video.play();await new Promise(done=>setTimeout(done,180));mastering.push({amplitude,rms:await sample()});}
    leveler.volume(video,.01,true);const muted=await sample();
    leveler.volume(video,.01,false);const unmuted=await sample();
    leveler.enable(false);const bypass=await sample();
    leveler.enable(true);const restored=await sample();
    video.src=wav(.0001);await video.play();leveler.volume(video,1,false);const noise=await sample();
    const nativeVolume=video.volume;
    const unrelated=document.createElement('video');unrelated.volume=.1;leveler.volume(unrelated,1,false);
    const untouched=unrelated.volume;
    leveler.dispose();video.pause();video.remove();return {initialOutput,results,peakAfterLowering,mastering,muted,unmuted,bypass,restored,noise,nativeVolume,untouched};
  },graph);
  console.log(JSON.stringify(results,null,2));
  assert.equal(results.initialOutput,0,'new graphs stay silent until the requested output volume is applied');
  for(let index=0;index<results.results.length-1;index++){
    const current=results.results[index],next=results.results[index+1];
    assert.ok(next.volume>current.volume?next.rms>current.rms:next.rms<current.rms,'real media output follows the manual volume direction');
  }
  assert.ok(Number.isFinite(results.peakAfterLowering)&&results.peakAfterLowering>0&&results.peakAfterLowering<.011,'lowering manual volume is safe immediately, not after the lookahead flushes');
  const loudness=results.mastering.map(item=>20*Math.log10(item.rms));
  assert.ok(Math.max(...loudness)-Math.min(...loudness)<3,'quiet and loud masters converge instead of retaining a large inter-video difference');
  assert.equal(results.muted,0,'mute is silent at final output');
  assert.ok(results.unmuted>0&&results.unmuted<.004,'unmuting retains the low manual level');
  assert.ok(results.bypass>results.restored&&results.bypass<.009,'bypass retains final manual attenuation');
  assert.ok(results.noise<.0004,'near-silence is not amplified to the maximum boost');
  assert.equal(results.nativeVolume,1,'owned media supplies an unscaled signal independent of the UI level');
  assert.equal(results.untouched,.1,'unmanaged media volume cannot be reset by the leveler');
}finally{await browser.close();await new Promise(done=>server.close(done));}
