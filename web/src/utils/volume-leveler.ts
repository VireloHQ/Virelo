import { levelingGainDb, LEVELING_MAX_BOOST_DB } from './volume-leveling';

export const LEVELING_LOOKAHEAD = .03;
let curves: { square: Float32Array<ArrayBuffer>; gain: Float32Array<ArrayBuffer>; quietGain: Float32Array<ArrayBuffer>; absolute: Float32Array<ArrayBuffer> } | undefined;
function levelingCurves() {
  if (curves) return curves;
  const square = new Float32Array(4097), absolute = new Float32Array(4097), gain = new Float32Array(262145), quietGain = new Float32Array(262145);
  for (let index = 0; index < square.length; index++) {
    const sample = index / (square.length - 1) * 2 - 1;
    square[index] = sample * sample;
    absolute[index] = Math.abs(sample);
  }
  for (let index = 0; index < gain.length; index++) {
    const power = Math.max(0, index / (gain.length - 1) * 2 - 1) * 4;
    const db = levelingGainDb(-.691 + 10 * Math.log10(power));
    gain[index] = db === null ? 10 ** (LEVELING_MAX_BOOST_DB / 20) : 10 ** (db / 20);
    const quietDb=levelingGainDb(-.691+10*Math.log10(power/256));
    quietGain[index]=quietDb===null?1:10**(quietDb/20);
  }
  return curves = { square, gain, quietGain, absolute };
}

// The detector runs ahead of the delayed audible path, entirely in the audio graph.
export function createLevelingGraph(context: BaseAudioContext, source: AudioNode) {
  const curves = levelingCurves();
  const delay = context.createDelay(.1), gain = context.createGain(), limiter = context.createDynamicsCompressor();
  const gate = context.createGain(), mute = context.createGain();
  const mix = context.createGain(), highpass = context.createBiquadFilter(), shelf = context.createBiquadFilter();
  const split = context.createChannelSplitter(2), mean = context.createGain(), smooth = context.createBiquadFilter();
  const response = context.createWaveShaper(), control = context.createGain();
  const quietScale=context.createGain(),quietSplit=context.createChannelSplitter(2);
  const quietMean=context.createGain(),quietSmooth=context.createBiquadFilter(),quietResponse=context.createWaveShaper();
  const windowNodes: AudioNode[] = [];
  const squares = [context.createWaveShaper(), context.createWaveShaper()];
  delay.delayTime.value = LEVELING_LOOKAHEAD;
  gain.gain.value = 0; gate.gain.value = 0; mute.gain.value = 0;
  mix.gain.value = .5;
  mix.channelCount = 2; mix.channelCountMode = 'explicit'; mix.channelInterpretation = 'speakers';
  highpass.type = 'highpass'; highpass.frequency.value = 38; highpass.Q.value = .5;
  shelf.type = 'highshelf'; shelf.frequency.value = 1500; shelf.gain.value = 4;
  mean.gain.value = .5;
  smooth.type = 'lowpass'; smooth.frequency.value = 25; smooth.Q.value = .5;
  response.curve = curves.gain;
  quietScale.gain.value=16;quietMean.gain.value=.5;
  quietSmooth.type='lowpass';quietSmooth.frequency.value=25;quietSmooth.Q.value=.5;
  quietResponse.curve=curves.quietGain;
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = .003; limiter.release.value = .15;
  source.connect(delay); delay.connect(gain); gain.connect(limiter);
  limiter.connect(gate); gate.connect(mute); mute.connect(context.destination);
  source.connect(mix); mix.connect(highpass); highpass.connect(shelf); shelf.connect(split);
  squares.forEach((square, index) => { square.curve = curves.square; split.connect(square, index); square.connect(mean); });
  mean.connect(smooth); smooth.connect(response);
  // A parallel high-sensitivity detector preserves quiet-level precision without clipping the main detector.
  shelf.connect(quietScale);quietScale.connect(quietSplit);
  const quietSquares=[context.createWaveShaper(),context.createWaveShaper()];
  quietSquares.forEach((square,index)=>{square.curve=curves.square;quietSplit.connect(square,index);square.connect(quietMean);});
  quietMean.connect(quietSmooth);quietSmooth.connect(quietResponse);
  const minimumOf=(left:AudioNode,right:AudioNode)=>{
    const minimum=context.createGain(),negate=context.createGain(),difference=context.createGain();
    const absolute=context.createWaveShaper(),restore=context.createGain();
    minimum.gain.value=.5;negate.gain.value=-1;difference.gain.value=1/32;restore.gain.value=-32;
    absolute.curve=curves.absolute;
    left.connect(minimum);right.connect(minimum);left.connect(difference);right.connect(negate);negate.connect(difference);
    difference.connect(absolute);absolute.connect(restore);restore.connect(minimum);
    windowNodes.push(minimum,negate,difference,absolute,restore);
    return minimum;
  };
  // Cover the existing 30ms hold at 1ms intervals instead of only its endpoints.
  let envelope: AudioNode = minimumOf(response,quietResponse);
  for (const seconds of [.001, .002, .004, .008, LEVELING_LOOKAHEAD - .015]) {
    const hold = context.createDelay(.1);
    hold.delayTime.value = seconds;
    envelope.connect(hold);
    windowNodes.push(hold);
    envelope = minimumOf(envelope,hold);
  }
  envelope.connect(control); control.connect(gain.gain);
  const reset = () => {
    const now = context.currentTime;
    gate.gain.cancelScheduledValues(now);
    gate.gain.setValueAtTime(0, now);
    gate.gain.setValueAtTime(1, now + LEVELING_LOOKAHEAD);
  };
  reset();
  return {
    limiter, output: mute,
    nodes: [source, delay, gain, limiter, gate, mute, mix, highpass, shelf, split, ...squares, mean, smooth, response, quietScale, quietSplit, ...quietSquares, quietMean, quietSmooth, quietResponse, ...windowNodes, control],
    reset,
    volume(volume: number, muted: boolean) {
      const now = context.currentTime;
      mute.gain.setValueAtTime(muted ? 0 : Math.max(0,Math.min(1,volume)), now);
    },
    enable(enabled: boolean) {
      const now = context.currentTime;
      gain.gain.setValueAtTime(enabled ? 0 : 1, now);
      control.gain.setValueAtTime(enabled ? 1 : 0, now);
      limiter.threshold.setValueAtTime(enabled ? -3 : 0, now);
      limiter.ratio.setValueAtTime(enabled ? 20 : 1, now);
    }
  };
}

type Graph = ReturnType<typeof createLevelingGraph> & { element: HTMLMediaElement };
export class VolumeLeveler {
  readonly context: AudioContext;
  private graphs = new Map<HTMLMediaElement, Graph>();
  private enabled = true;
  constructor() { this.context = new AudioContext({ latencyHint: 'playback' }); }
  async resume() { if (this.context.state !== 'running') await this.context.resume(); }
  bind(elements: HTMLMediaElement[]) {
    for (const element of elements) if (element.currentSrc && new URL(element.currentSrc, location.href).origin !== location.origin)
      throw new Error('Volume leveling is unavailable for this source.');
    for (const [element, graph] of this.graphs) if (!elements.includes(element)) { this.remove(graph); this.graphs.delete(element); }
    for (const element of elements) {
      if (this.graphs.has(element)) continue;
      const audio = createLevelingGraph(this.context, this.context.createMediaElementSource(element));
      const graph: Graph = { ...audio, element };
      graph.enable(this.enabled);
      element.addEventListener('loadstart', graph.reset); element.addEventListener('seeking', graph.reset);
      this.graphs.set(element, graph);
    }
  }
  has(element: HTMLMediaElement) { return this.graphs.has(element); }
  volume(element: HTMLMediaElement, volume: number, muted: boolean) {
    const graph=this.graphs.get(element);
    if(!graph)return;
    graph.volume(volume,muted);
    // Keep the detector independent of the user's final output level.
    element.volume=1;
    element.muted=muted;
  }
  enable(enabled: boolean) {
    this.enabled = enabled;
    for (const graph of this.graphs.values()) graph.enable(enabled);
  }
  private remove(graph: Graph) {
    graph.element.removeEventListener('loadstart', graph.reset); graph.element.removeEventListener('seeking', graph.reset);
    graph.nodes.forEach(node => node.disconnect());
  }
  dispose() { for (const graph of this.graphs.values()) this.remove(graph); this.graphs.clear(); void this.context.close().catch(() => {}); }
}
