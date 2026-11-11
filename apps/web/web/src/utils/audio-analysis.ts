import type { AudioLoudness } from './volume-leveling.ts';
import { measuredLevelingGainDb } from './volume-leveling.ts';

// loudnorm reports INPUT measurements, not the normalized output or RMS.
export function parseLoudnorm(log: string): AudioLoudness | null {
  const blocks = log.match(/\{[^{}]*"input_i"[^{}]*\}/g);
  if (!blocks?.length) throw new Error('Audio analysis did not return a loudness measurement.');
  const data = JSON.parse(blocks.at(-1)!);
  const number=/^-?\d+(?:\.\d+)?$/;
  if (typeof data.input_i !== 'string' || typeof data.input_tp !== 'string'
    || ![data.input_i,data.input_tp].every(value=>value==='-inf'||number.test(value)))
    throw new Error('Audio analysis returned an invalid loudness measurement.');
  if (data.input_i === '-inf' && (data.input_tp === '-inf' || Number(data.input_tp)>=-120&&Number(data.input_tp)<=20)) return null;
  const loudness = { integratedLufs: Number(data.input_i), truePeakDb: Number(data.input_tp) };
  if (measuredLevelingGainDb(loudness) === null) throw new Error('Audio analysis returned an invalid loudness measurement.');
  return loudness;
}
