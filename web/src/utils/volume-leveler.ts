import { levelingGainDb, measuredLevelingGainDb, LEVELING_MAX_BOOST_DB, type AudioLoudness } from './volume-leveling';

export const LEVELING_LOOKAHEAD = .03;
export const LEVELING_RECOVERY_DB_PER_SECOND = 3;
export const LEVELING_RECOVERY_HOLD = 1;
const MAX_GAIN = 10 ** (LEVELING_MAX_BOOST_DB / 20), RECOVERY_RANGE_DB = LEVELING_MAX_BOOST_DB + 24;
let curves: { square: Float32Array<ArrayBuffer>; gain: Float32Array<ArrayBuffer>; quietGain: Float32Array<ArrayBuffer>; quietHoldGain: Float32Array<ArrayBuffer>; absolute: Float32Array<ArrayBuffer>; toLog: Float32Array<ArrayBuffer>; fromLog: Float32Array<ArrayBuffer> } | undefined;
function levelingCurves() {
  if (curves) return curves;
  const square = new Float32Array(4097), absolute = new Float32Array(4097);
  const gain = new Float32Array(262145), quietGain = new Float32Array(262145), quietHoldGain = new Float32Array(262145);
  const toLog = new Float32Array(262145), fromLog = new Float32Array(262145);
  for (let index = 0; index < square.length; index++) {
    const sample = index / (square.length - 1) * 2 - 1;
    square[index] = sample * sample; absolute[index] = Math.abs(sample);
  }
  for (let index = 0; index < gain.length; index++) {
    const sample = index / (gain.length - 1) * 2 - 1, power = Math.max(0, sample) * 4;
    const db = levelingGainDb(-.691 + 10 * Math.log10(power));
    const quietDb = levelingGainDb(-.691 + 10 * Math.log10(power / 256));
    gain[index] = db === null ? MAX_GAIN : 10 ** (db / 20);
    quietGain[index] = quietDb === null ? 1 : 10 ** (quietDb / 20);
    quietHoldGain[index] = quietDb === null ? MAX_GAIN : quietGain[index];
    // Zero-filled delay buffers represent neutral maximum gain, not attenuation.
    toLog[index] = sample < 10 ** (-RECOVERY_RANGE_DB / 20) / 2 ? 0 : Math.max(-1, Math.min(0, 20 * Math.log10(sample) / RECOVERY_RANGE_DB));
    fromLog[index] = 10 ** ((LEVELING_MAX_BOOST_DB + RECOVERY_RANGE_DB * Math.max(-1, Math.min(0, sample))) / 20);
  }
  return curves = { square, gain, quietGain, quietHoldGain, absolute, toLog, fromLog };
}

function minimumOf(context: BaseAudioContext, left: AudioNode, right: AudioNode, nodes: AudioNode[]) {
  const minimum = context.createGain(), negate = context.createGain(), difference = context.createGain();
  const absolute = context.createWaveShaper(), restore = context.createGain();
  minimum.gain.value = .5; negate.gain.value = -1; difference.gain.value = 1 / 32; restore.gain.value = -32;
  absolute.curve = levelingCurves().absolute;
  left.connect(minimum); right.connect(minimum); left.connect(difference); right.connect(negate); negate.connect(difference);
  difference.connect(absolute); absolute.connect(restore); restore.connect(minimum);
  nodes.push(minimum, negate, difference, absolute, restore);
  return minimum;
}

function createEnvelope(context: BaseAudioContext, source: AudioNode) {
  const curves = levelingCurves(), nodes: AudioNode[] = [];
  const mix = context.createGain(), highpass = context.createBiquadFilter(), shelf = context.createBiquadFilter();
  const split = context.createChannelSplitter(2), mean = context.createGain(), smooth = context.createBiquadFilter(), response = context.createWaveShaper();
  const quietScale = context.createGain(), quietSplit = context.createChannelSplitter(2), quietMean = context.createGain();
  const quietSmooth = context.createBiquadFilter(), quietResponse = context.createWaveShaper(), quietHoldResponse = context.createWaveShaper();
  const squares = [context.createWaveShaper(), context.createWaveShaper()], quietSquares = [context.createWaveShaper(), context.createWaveShaper()];
  mix.gain.value = .5; mix.channelCount = 2; mix.channelCountMode = 'explicit'; mix.channelInterpretation = 'speakers';
  highpass.type = 'highpass'; highpass.frequency.value = 38; highpass.Q.value = .5;
  shelf.type = 'highshelf'; shelf.frequency.value = 1500; shelf.gain.value = 4;
  mean.gain.value = .5; smooth.type = 'lowpass'; smooth.frequency.value = 25; smooth.Q.value = .5;
  response.curve = curves.gain;
  quietScale.gain.value = 16; quietMean.gain.value = .5;
  quietSmooth.type = 'lowpass'; quietSmooth.frequency.value = 25; quietSmooth.Q.value = .5;
  quietResponse.curve = curves.quietGain; quietHoldResponse.curve = curves.quietHoldGain;
  source.connect(mix); mix.connect(highpass); highpass.connect(shelf); shelf.connect(split);
  squares.forEach((square, index) => { square.curve = curves.square; split.connect(square, index); square.connect(mean); });
  mean.connect(smooth); smooth.connect(response);
  shelf.connect(quietScale); quietScale.connect(quietSplit);
  quietSquares.forEach((square, index) => { square.curve = curves.square; quietSplit.connect(square, index); square.connect(quietMean); });
  quietMean.connect(quietSmooth); quietSmooth.connect(quietResponse); quietSmooth.connect(quietHoldResponse);
  nodes.push(mix, highpass, shelf, split, ...squares, mean, smooth, response, quietScale, quietSplit, ...quietSquares, quietMean, quietSmooth, quietResponse, quietHoldResponse);

  // The original fast path still protects the complete 30ms of queued audio.
  let fast: AudioNode = minimumOf(context, response, quietResponse, nodes);
  for (const seconds of [.001, .002, .004, .008, LEVELING_LOOKAHEAD - .015]) {
    const past = context.createDelay(.1); past.delayTime.value = seconds; fast.connect(past); nodes.push(past);
    fast = minimumOf(context, fast, past, nodes);
  }
  const target = minimumOf(context, response, quietHoldResponse, nodes);
  const scale = context.createGain(), toLog = context.createWaveShaper(), fromLog = context.createWaveShaper(), reference = context.createConstantSource();
  scale.gain.value = 1 / MAX_GAIN; scale.channelCount = 1; scale.channelCountMode = 'explicit';
  toLog.curve = curves.toLog; fromLog.curve = curves.fromLog; reference.offset.value = 1;
  target.connect(scale); scale.connect(toLog); nodes.push(scale, toLog, fromLog, reference);
  let held: AudioNode = toLog;
  // Hold short gaps between notes/syllables; binary taps avoid main-thread polling.
  for (const seconds of [.001, .002, .004, .008, .016, .032, .064, .128, .256, LEVELING_RECOVERY_HOLD - .511]) {
    const past = context.createDelay(seconds + .001); past.delayTime.value = seconds; held.connect(past); nodes.push(past);
    held = minimumOf(context, held, past, nodes);
  }
  // min(g(t), g(t-d)+rate*d) bounds recovery in dB without slowing attenuation.
  for (const seconds of [.01, .02, .04, .08, .16, .32, .64, 1.28, 2.56, 5.12, 10.24]) {
    const past = context.createDelay(seconds + .001), offset = context.createGain(), sum = context.createGain();
    past.delayTime.value = seconds; offset.gain.value = LEVELING_RECOVERY_DB_PER_SECOND * seconds / RECOVERY_RANGE_DB;
    held.connect(past); past.connect(sum); reference.connect(offset); offset.connect(sum);
    nodes.push(past, offset, sum); held = minimumOf(context, held, sum, nodes);
  }
  held.connect(fromLog); reference.start();
  return { input: mix, output: minimumOf(context, fast, fromLog, nodes), nodes, dispose() { reference.stop(); } };
}

// The detector runs ahead of the delayed audible path, entirely in the audio graph.
export function createLevelingGraph(context: BaseAudioContext, source: AudioNode) {
  const delay = context.createDelay(.1), gain = context.createGain(), limiter = context.createDynamicsCompressor();
  const gate = context.createGain(), mute = context.createGain(), control = context.createGain(), makeup = context.createGain();
  delay.delayTime.value = LEVELING_LOOKAHEAD; gain.gain.value = 0; gate.gain.value = 0; mute.gain.value = 0;
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = .003; limiter.release.value = .15;
  source.connect(delay); delay.connect(gain); gain.connect(limiter); limiter.connect(makeup); makeup.connect(gate); gate.connect(mute); mute.connect(context.destination);
  control.connect(gain.gain);
  let enabled=true, measured:number|null=null;
  const update=()=>{
    const now=context.currentTime;
    // Crossfade mode changes inside the existing lookahead, without slowing the detector.
    gain.gain.setTargetAtTime(enabled?(measured===null?0:10**(measured/20)):1,now,.003);
    control.gain.setTargetAtTime(enabled&&measured===null?1:0,now,.003);
    limiter.threshold.setValueAtTime(enabled?-3:0,now);limiter.ratio.setValueAtTime(enabled?20:1,now);
    // Cancel the native compressor's fixed, automatic makeup gain (Web Audio spec).
    makeup.gain.setValueAtTime(enabled?10**(-3*(1-1/20)*.6/20):1,now);
  };
  let envelope: ReturnType<typeof createEnvelope> | undefined;
  const reset = () => {
    if (envelope) { source.disconnect(envelope.input); envelope.dispose(); envelope.nodes.forEach(node => node.disconnect()); }
    envelope = createEnvelope(context, source); envelope.output.connect(control);
    const now = context.currentTime;
    gate.gain.cancelScheduledValues(now); gate.gain.setValueAtTime(0, now); gate.gain.setValueAtTime(1, now + LEVELING_LOOKAHEAD);
  };
  reset();
  update();
  return {
    limiter, output: mute,
    get nodes() { return [source, delay, gain, limiter, makeup, gate, mute, ...envelope!.nodes, control]; },
    reset,
    dispose() { envelope?.dispose(); },
    volume(volume: number, muted: boolean) { mute.gain.setValueAtTime(muted ? 0 : Math.max(0, Math.min(1, volume)), context.currentTime); },
    measurement(value?:AudioLoudness|null) { measured=measuredLevelingGainDb(value);update(); },
    enable(value: boolean) { enabled=value;update(); }
  };
}

type Graph = ReturnType<typeof createLevelingGraph> & { element: HTMLMediaElement };
export class VolumeLeveler {
  readonly context: AudioContext;
  private graphs = new Map<HTMLMediaElement, Graph>();
  private enabled = true;
  private measured:AudioLoudness|null=null;
  constructor() { this.context = new AudioContext({ latencyHint: 'playback' }); }
  async resume() { if (this.context.state !== 'running') await this.context.resume(); }
  bind(elements: HTMLMediaElement[]) {
    for (const element of elements) if (element.currentSrc && new URL(element.currentSrc, location.href).origin !== location.origin)
      throw new Error('Volume leveling is unavailable for this source.');
    for (const [element, graph] of this.graphs) if (!elements.includes(element)) { this.remove(graph); this.graphs.delete(element); }
    for (const element of elements) {
      if (this.graphs.has(element)) continue;
      const audio = createLevelingGraph(this.context, this.context.createMediaElementSource(element));
      const graph: Graph = Object.assign(audio, { element });
      graph.enable(this.enabled);
      graph.measurement(this.measured);
      element.addEventListener('loadstart', graph.reset); element.addEventListener('seeking', graph.reset);
      this.graphs.set(element, graph);
    }
  }
  has(element: HTMLMediaElement) { return this.graphs.has(element); }
  measurement(value?:AudioLoudness|null) {
    this.measured=value??null;
    for(const graph of this.graphs.values())graph.measurement(this.measured);
  }
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
    graph.dispose();
    graph.nodes.forEach(node => node.disconnect());
  }
  dispose() { for (const graph of this.graphs.values()) this.remove(graph); this.graphs.clear(); void this.context.close().catch(() => {}); }
}
