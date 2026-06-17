import os from 'node:os';
import path from 'node:path';
import { existsSync, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execa } from 'execa';

const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export const MODELS = {
  'tiny.en': { file: 'ggml-tiny.en.bin', url: `${HF}/ggml-tiny.en.bin`, mb: 75 },
  'base.en': { file: 'ggml-base.en.bin', url: `${HF}/ggml-base.en.bin`, mb: 142 },
  'small.en': { file: 'ggml-small.en.bin', url: `${HF}/ggml-small.en.bin`, mb: 466 },
};

export const DEFAULT_MODEL = 'base.en';
const TRANSCRIBERS = ['whisper-cli', 'whisper-cpp', 'whisper'];

export function modelCacheDir() {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'monogit', 'models');
}

export function modelPath(name) {
  const meta = MODELS[name];
  if (!meta) return null;
  return path.join(modelCacheDir(), meta.file);
}

export function hasModel(name) {
  const p = modelPath(name);
  return Boolean(p && existsSync(p));
}

async function onPath(bin) {
  const r = await execa('which', [bin], { reject: false });
  return r.exitCode === 0;
}

// First available whisper.cpp-style binary, or null.
export async function findTranscriber() {
  for (const bin of TRANSCRIBERS) {
    if (await onPath(bin)) return bin;
  }
  return null;
}

// A recorder and how it segments utterances, preferring sox then ffmpeg.
// Both stop on the trailing silence at the end of a spoken command (VAD),
// so the experience is hands-free — no keypress.
export async function findRecorder() {
  if (await onPath('sox')) return { bin: 'sox', mode: 'sox' };
  if (await onPath('ffmpeg')) return { bin: 'ffmpeg', mode: 'ffmpeg' };
  return null;
}

// sox records one utterance and exits: start once sound rises above the
// threshold, stop after `silenceDur` seconds back below it.
export function soxUtteranceCommand({ rate = 16000, silenceDur = 1.2, threshold = '2%' } = {}) {
  return `sox -d -q -r ${rate} -c 1 -b 16 {audio} silence 1 0.1 ${threshold} 1 ${silenceDur} ${threshold}`;
}

export function buildTranscribeCommand(bin, model) {
  return `${bin} -m "${model}" -nt -f {audio}`;
}

export async function canBrew() {
  return process.platform === 'darwin' && (await onPath('brew'));
}

export async function brewInstallWhisper() {
  return execa('brew', ['install', 'whisper-cpp'], { stdio: 'inherit', reject: false });
}

// Stream-download a model to the cache (atomic via a .part file). Calls
// onProgress(received, total) as it goes. Returns the final path.
export async function downloadModel(name, onProgress) {
  const meta = MODELS[name];
  if (!meta) throw new Error(`unknown model "${name}" (choose: ${Object.keys(MODELS).join(', ')})`);

  const dest = modelPath(name);
  await fs.mkdir(modelCacheDir(), { recursive: true });
  const tmp = `${dest}.part`;

  const res = await fetch(meta.url);
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;

  let received = 0;
  const source = Readable.fromWeb(res.body);
  source.on('data', (chunk) => {
    received += chunk.length;
    if (onProgress) onProgress(received, total);
  });

  try {
    await pipeline(source, createWriteStream(tmp));
    if (total && received !== total) throw new Error('incomplete download');
    await fs.rename(tmp, dest);
    return dest;
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
