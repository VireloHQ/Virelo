import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire, stripTypeScriptTypes } from 'node:module';

const { chromium } = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url)('playwright');
const moduleUrl = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const values = moduleUrl(stripTypeScriptTypes(await readFile(new URL('../../../packages/web-ui/src/utils/volume-leveling.ts', import.meta.url), 'utf8')));
const graph = moduleUrl(stripTypeScriptTypes(await readFile(new URL('../../../packages/web-ui/src/utils/volume-leveler.ts', import.meta.url), 'utf8')).replace("'./volume-leveling'", JSON.stringify(values)));
const browser = await chromium.launch({ headless: true, executablePath: process.env.VIRELO_TEST_CHROMIUM });
try {
  const page = await browser.newPage();
  const results = await page.evaluate(async graph => {
    const { createLevelingGraph } = await import(graph);
    const results = [];
    const fixtures = [
      ...[1, 2, 4, 8, 12, 20].map(beat => ({ beat })),
      { beat: 4, amplitude: .02 }, { beat: 4, center: 60 }, { beat: 4, center: 1000 },
      { beat: 4, rate: 44100 }, { beat: 4, rate: 96000 }, { beat: 4, speech: true }
    ];
    for (const fixture of fixtures) {
      const { beat, rate = 48000, amplitude = .2, center = 400, speech = false } = fixture;
      const context = new OfflineAudioContext(2, rate * 3, rate), buffer = context.createBuffer(2, rate * 3, rate);
      for (let index = 0; index < buffer.length; index++) {
        const time = index / rate;
        // A steady high-frequency voice shares a mix with two nearby musical notes.
        let sample = amplitude * Math.sin(2 * Math.PI * center * time) + amplitude * Math.sin(2 * Math.PI * (center + beat) * time) + .04 * Math.sin(2 * Math.PI * 2100 * time);
        if (speech) for (let harmonic = 1; harmonic <= 6; harmonic++) sample += .05 / harmonic * Math.sin(2 * Math.PI * 147 * harmonic * time) * (.6 + .4 * Math.sin(2 * Math.PI * 3 * time));
        for (let channel = 0; channel < 2; channel++) buffer.getChannelData(channel)[index] = sample;
      }
      const source = context.createBufferSource(); source.buffer = buffer;
      const nodes = createLevelingGraph(context, source); nodes.volume(1, false); nodes.enable(true); nodes.output.disconnect();
      const monitor = context.createChannelMerger(2); nodes.output.connect(monitor, 0, 0); nodes.nodes.at(-1).connect(monitor, 0, 1); monitor.connect(context.destination); source.start();
      const started = performance.now(), output = await context.startRendering(), control = output.getChannelData(1);
      const renderMs = Math.round(performance.now() - started);
      const gainDb = [];
      for (let index = rate; index < 3 * rate; index += 48) gainDb.push(20 * Math.log10(Math.max(1e-8, control[index])));
      const mean = gainDb.reduce((sum, value) => sum + value, 0) / gainDb.length;
      const modulation = Math.sqrt(gainDb.reduce((sum, value) => sum + (value - mean) ** 2, 0) / gainDb.length);
      const voiceDb = [], audible = output.getChannelData(0), frame = Math.round(rate * .05);
      for (let start = rate; start + frame <= buffer.length; start += Math.round(rate * .025)) {
        let real = 0, imaginary = 0, weights = 0;
        for (let index = 0; index < frame; index++) {
          const weight = .5 - .5 * Math.cos(2 * Math.PI * index / (frame - 1)), phase = 2 * Math.PI * 2100 * (start + index) / rate;
          real += audible[start + index] * weight * Math.cos(phase); imaginary += audible[start + index] * weight * Math.sin(phase); weights += weight;
        }
        voiceDb.push(20 * Math.log10(2 * Math.hypot(real, imaginary) / weights));
      }
      results.push({ beat, rate, amplitude, center, speech, renderMs, modulationDb: modulation, rangeDb: Math.max(...gainDb) - Math.min(...gainDb), voiceRangeDb: Math.max(...voiceDb) - Math.min(...voiceDb) });
      nodes.dispose(); nodes.nodes.forEach(node => node.disconnect());
    }
    return results;
  }, graph);
  console.log(JSON.stringify(results, null, 2));
  for (const result of results) assert.ok(result.modulationDb < .3 && result.rangeDb < 1 && result.voiceRangeDb < 1, 'a steady voice must not tremble with other musical notes: ' + JSON.stringify(result));
} finally { await browser.close(); }
