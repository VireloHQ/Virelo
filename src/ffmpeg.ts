import { spawn, type ChildProcess } from 'node:child_process';
import { rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { imageFileExists, prepareGeneratedFile } from './image-files.js';

export interface PlaybackTrack {
  index: number;
  typeIndex: number;
  codec: string;
  language: string | null;
  title: string | null;
  channels: number | null;
  channelLayout: string | null;
  default: boolean;
  forced: boolean;
  supported: boolean;
}

export interface PlaybackInfo {
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  qualityOptions: PlaybackQuality[];
  audioTracks: PlaybackTrack[];
  subtitleTracks: PlaybackTrack[];
  defaultAudioStream: number | null;
  requiresVideoTranscode: boolean;
  requiresAudioTranscode: boolean;
  requiresTranscode: boolean;
}

export interface PlaybackQuality {
  height: number;
  label: string;
  bitrate: number;
}

const DIRECT_VIDEO_CODECS = new Set(['h264', 'av1', 'vp8', 'vp9']);
const DIRECT_AUDIO_CODECS = new Set(['aac', 'flac', 'mp3', 'opus', 'vorbis']);
const TEXT_SUBTITLE_CODECS = new Set(['ass', 'mov_text', 'ssa', 'subrip', 'text', 'webvtt']);

const QUALITY_BITRATES: Record<number, number> = {
  2160: 12_000_000,
  1440: 8_000_000,
  1080: 5_000_000,
  720: 2_800_000,
  480: 1_400_000,
  360: 800_000
};

export function limitMediaProcess(child:ChildProcess,milliseconds:number){
  const timer=setTimeout(()=>child.kill('SIGKILL'),milliseconds);timer.unref();
  const clear=()=>clearTimeout(timer);
  child.once('error',clear);child.once('close',clear);
  return child;
}

export function playbackQualities(width: number | null, height: number | null): PlaybackQuality[] {
  if (!width || !height) return [];
  const sourceHeight = Math.max(144, Math.round(Math.min(width, height) / 2) * 2);
  const standards = [2160, 1440, 1080, 720, 480, 360];
  const heights = [sourceHeight, ...standards.filter((candidate) => candidate < sourceHeight)]
    .filter((candidate, index, values) => values.indexOf(candidate) === index);
  return heights.map((qualityHeight) => ({
    height: qualityHeight,
    label: qualityHeight >= 2160 ? '4K' : `${qualityHeight}p`,
    bitrate: QUALITY_BITRATES[qualityHeight] ?? Math.max(500_000, Math.round(qualityHeight * qualityHeight * 4.3))
  }));
}

async function canRun(command: string): Promise<boolean> {
  return await new Promise((resolve) => {
    let child;
    try {
      child = limitMediaProcess(spawn(command, ['-version'], { stdio: 'ignore', windowsHide: true }),5000);
    } catch {
      resolve(false);
      return;
    }
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}

let ffmpegAvailable: boolean | undefined;
let ffprobeAvailable: boolean | undefined;

export async function hasFfmpeg() {
  return ffmpegAvailable ??= await canRun(process.env.FFMPEG_PATH || 'ffmpeg');
}

export async function hasFfprobe() {
  return ffprobeAvailable ??= await canRun(process.env.FFPROBE_PATH || 'ffprobe');
}

const playbackProbes = new Map<string, { fingerprint: string; promise: Promise<any | null> }>();
async function ffprobeJson(path: string): Promise<any | null> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return null;
  const fingerprint = `${process.env.FFPROBE_PATH || 'ffprobe'}:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  const cached = playbackProbes.get(path);
  if (cached?.fingerprint === fingerprint) return cached.promise;
  const promise = runFfprobeJson(path);
  playbackProbes.delete(path);
  playbackProbes.set(path, { fingerprint, promise });
  if (playbackProbes.size > 64) playbackProbes.delete(playbackProbes.keys().next().value!);
  const result = await promise;
  if (!result && playbackProbes.get(path)?.promise === promise) playbackProbes.delete(path);
  return result;
}

async function runFfprobeJson(path: string): Promise<any | null> {
  if (!(await hasFfprobe())) return null;
  return await new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let child;
    try {
      child = limitMediaProcess(spawn(process.env.FFPROBE_PATH || 'ffprobe', ['-v','quiet','-print_format','json','-show_format','-show_streams',path], { windowsHide: true }),30000);
    } catch {
      resolve(null);
      return;
    }
    child.stdout?.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.once('error', () => resolve(null));
    child.once('close', (code) => {
      if (code !== 0) return resolve(null);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { resolve(null); }
    });
  });
}

export async function probeMedia(path: string): Promise<{
  duration: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
} | null> {
  const data = await ffprobeJson(path);
  if (!data) return null;
  const video = Array.isArray(data.streams) ? data.streams.find((s: any) => s.codec_type === 'video') : null;
  const audio = Array.isArray(data.streams) ? data.streams.find((s: any) => s.codec_type === 'audio') : null;
  return {
    duration: Number.isFinite(Number(data.format?.duration)) ? Number(data.format.duration) : null,
    width: Number.isFinite(Number(video?.width)) ? Number(video.width) : null,
    height: Number.isFinite(Number(video?.height)) ? Number(video.height) : null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    container: data.format?.format_name?.split(',')[0] ?? null
  };
}

export async function probePlaybackInfo(path: string): Promise<PlaybackInfo | null> {
  const data = await ffprobeJson(path);
  if (!data || !Array.isArray(data.streams)) return null;
  const video = data.streams.find((stream: any) => stream.codec_type === 'video');
  let audioTypeIndex = 0;
  let subtitleTypeIndex = 0;
  const audioTracks: PlaybackTrack[] = [];
  const subtitleTracks: PlaybackTrack[] = [];
  for (const stream of data.streams) {
    if (stream.codec_type !== 'audio' && stream.codec_type !== 'subtitle') continue;
    const codec = String(stream.codec_name || 'unknown').toLowerCase();
    const track: PlaybackTrack = {
      index: Number(stream.index),
      typeIndex: stream.codec_type === 'audio' ? audioTypeIndex++ : subtitleTypeIndex++,
      codec,
      language: typeof stream.tags?.language === 'string' ? stream.tags.language : null,
      title: typeof stream.tags?.title === 'string' ? stream.tags.title : null,
      channels: Number.isFinite(Number(stream.channels)) ? Number(stream.channels) : null,
      channelLayout: typeof stream.channel_layout === 'string' ? stream.channel_layout : null,
      default: Boolean(stream.disposition?.default),
      forced: Boolean(stream.disposition?.forced),
      supported: stream.codec_type === 'audio' || TEXT_SUBTITLE_CODECS.has(codec)
    };
    if (stream.codec_type === 'audio') audioTracks.push(track); else subtitleTracks.push(track);
  }
  const defaultAudio = audioTracks.find((track) => track.default) ?? audioTracks[0];
  const videoCodec = typeof video?.codec_name === 'string' ? video.codec_name.toLowerCase() : null;
  const width = Number.isFinite(Number(video?.width)) ? Number(video.width) : null;
  const height = Number.isFinite(Number(video?.height)) ? Number(video.height) : null;
  const requiresVideoTranscode = Boolean(videoCodec && !DIRECT_VIDEO_CODECS.has(videoCodec));
  const requiresAudioTranscode = Boolean(defaultAudio && !DIRECT_AUDIO_CODECS.has(defaultAudio.codec));
  return {
    videoCodec,
    width,
    height,
    qualityOptions: playbackQualities(width, height),
    audioTracks,
    subtitleTracks,
    defaultAudioStream: defaultAudio?.index ?? null,
    requiresVideoTranscode,
    requiresAudioTranscode,
    requiresTranscode: requiresVideoTranscode || requiresAudioTranscode
  };
}

export async function makeThumbnail(source: string, target: string, duration?: number | null, replace=false): Promise<boolean> {
  if(!replace&&await imageFileExists(target))return true;
  if (!(await hasFfmpeg())) return false;
  await prepareGeneratedFile(target);
  const temporary=`${target}.${randomUUID()}.tmp.jpg`;
  const seek = duration && duration >= 1 ? Math.min(duration * 0.12, 60) : 0;
  try {
    for(const position of seek>0?[seek,0]:[0]){
      const generated=await new Promise<boolean>((resolve) => {
        let child;
        try {
          child = limitMediaProcess(spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
            '-hide_banner','-loglevel','error','-ss',String(position),'-i',source,'-frames:v','1','-vf','scale=min(960\\,iw):-2','-q:v','3','-y',temporary
          ], { stdio: 'ignore', windowsHide: true }),60000);
        } catch {
          resolve(false);
          return;
        }
        child.once('error', () => resolve(false));
        child.once('close', (code) => resolve(code === 0));
      });
      if(!generated||!await imageFileExists(temporary))continue;
      await prepareGeneratedFile(target);
      await rename(temporary,target);
      return true;
    }
    return false;
  }finally{await rm(temporary,{force:true}).catch(()=>{});}
}
