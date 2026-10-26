import { levelingGainDb, signalLevel } from './volume-leveling';

type Graph={element:HTMLMediaElement;source:MediaElementAudioSourceNode;gain:GainNode;limiter:DynamicsCompressorNode;nodes:AudioNode[];analysers:AnalyserNode[];buffers:Float32Array<ArrayBuffer>[];recent:number[];reset:()=>void;};
export class VolumeLeveler {
  readonly context:AudioContext;
  private graphs=new Map<HTMLMediaElement,Graph>();
  constructor(){this.context=new AudioContext({latencyHint:'playback'});}
  async resume(){if(this.context.state!=='running')await this.context.resume();}
  bind(elements:HTMLMediaElement[]){
    for(const [element,graph] of this.graphs)if(!elements.includes(element)){this.remove(graph);this.graphs.delete(element);}
    for(const element of elements){
      if(this.graphs.has(element))continue;
      if(element.currentSrc&&new URL(element.currentSrc,location.href).origin!==location.origin)throw new Error('Volume leveling is unavailable for this source.');
      const gain=this.context.createGain(),limiter=this.context.createDynamicsCompressor();
      const mix=this.context.createGain(),highpass=this.context.createBiquadFilter(),shelf=this.context.createBiquadFilter(),split=this.context.createChannelSplitter(2);
      mix.channelCount=2;mix.channelCountMode='explicit';mix.channelInterpretation='speakers';
      highpass.type='highpass';highpass.frequency.value=38;highpass.Q.value=.5;
      shelf.type='highshelf';shelf.frequency.value=1500;shelf.gain.value=4;
      const analysers=[this.context.createAnalyser(),this.context.createAnalyser()];
      for(const node of analysers)node.fftSize=4096;
      const source=this.context.createMediaElementSource(element);
      source.connect(gain);gain.connect(limiter);limiter.connect(this.context.destination);
      source.connect(mix);mix.connect(highpass);highpass.connect(shelf);shelf.connect(split);
      analysers.forEach((node,index)=>split.connect(node,index));
      const graph:Graph={element,source,gain,limiter,nodes:[source,gain,limiter,mix,highpass,shelf,split,...analysers],analysers,buffers:analysers.map(()=>new Float32Array(4096)),recent:[],reset:()=>{}};
      graph.reset=()=>{graph.recent=[];gain.gain.cancelScheduledValues(this.context.currentTime);gain.gain.setTargetAtTime(1,this.context.currentTime,.08);};
      element.addEventListener('loadstart',graph.reset);element.addEventListener('seeking',graph.reset);
      this.graphs.set(element,graph);
    }
  }
  enable(enabled:boolean){
    for(const graph of this.graphs.values()){
      graph.reset();
      graph.limiter.threshold.setValueAtTime(enabled?-3:0,this.context.currentTime);
      graph.limiter.knee.value=0;graph.limiter.ratio.value=enabled?20:1;
      graph.limiter.attack.value=.003;graph.limiter.release.value=.15;
    }
  }
  tick(){
    if(this.context.state!=='running')return;
    for(const graph of this.graphs.values()){
      const element=graph.element;
      if(element.paused||element.seeking||element.muted||element.volume<.01||element.readyState<2)continue;
      graph.analysers.forEach((node,index)=>node.getFloatTimeDomainData(graph.buffers[index]));
      const {level,peak}=signalLevel(graph.buffers,element.volume);
      if(levelingGainDb(level,peak)===null)continue;
      graph.recent.push(level);if(graph.recent.length>12)graph.recent.shift();
      if(graph.recent.length<3)continue;
      const sorted=[...graph.recent].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)];
      const db=levelingGainDb(median,peak);
      if(db===null)continue;
      const target=10**(db/20),now=this.context.currentTime;
      graph.gain.gain.setTargetAtTime(target,now,target<graph.gain.gain.value ? .12 : 1.2);
    }
  }
  private remove(graph:Graph){
    graph.element.removeEventListener('loadstart',graph.reset);graph.element.removeEventListener('seeking',graph.reset);
    graph.nodes.forEach(node=>node.disconnect());
  }
  dispose(){for(const graph of this.graphs.values())this.remove(graph);this.graphs.clear();void this.context.close().catch(()=>{});}
}
