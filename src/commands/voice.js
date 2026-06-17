import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { readConfig } from '../utils/config.js';
import { resolvePushArgs } from '../utils/git.js';
import { interpret, isStopWord, isAffirmative, PHRASE_HELP } from '../core/voice.js';
import {
  MODELS,
  DEFAULT_MODEL,
  modelPath,
  hasModel,
  findTranscriber,
  findRecorder,
  soxUtteranceCommand,
  buildTranscribeCommand,
  canBrew,
  brewInstallWhisper,
  downloadModel,
} from '../core/voice-setup.js';
import { statusCommand } from './dashboard.js';
import { reposListCommand } from './repos.js';
import { commitCommand } from './commit.js';
import { stageUntrackedDefault } from '../core/commit.js';
import { gitProxyCommand } from './git-proxy.js';
import { visualCommand } from './visual.js';
import { showCommand } from './show.js';
import { tidyCommand } from './tidy.js';

function substitute(command, audio) {
  if (command.includes('{audio}')) return command.replace(/\{audio\}/g, `"${audio}"`);
  return `${command} "${audio}"`;
}

function cleanTranscript(text) {
  return String(text)
    .replace(/\[\d{2}:\d{2}[:.]\d{2}[\d.:]*\s*-->\s*[\d:.]+\]/g, '') // whisper timestamps
    .replace(/\[[^\]]*\]/g, '') // any remaining bracketed annotations
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- provisioning (offer brew install + auto-download model) ----

async function confirm(message, def) {
  const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message, default: def }]);
  return ok;
}

function renderProgress(label, received, total) {
  if (total) {
    const w = 24;
    const filled = Math.round((received / total) * w);
    const pct = Math.round((received / total) * 100);
    process.stderr.write(`\r  ${label} ${'█'.repeat(filled)}${'░'.repeat(w - filled)} ${pct}%`);
  } else {
    process.stderr.write(`\r  ${label} ${(received / 1e6).toFixed(0)} MB`);
  }
}

async function ensureTranscriberBinary(yes) {
  let bin = await findTranscriber();
  if (bin) return bin;

  console.log(chalk.yellow('\nNo speech transcriber found.'));
  if (await canBrew()) {
    if (yes || (await confirm('Install whisper.cpp via Homebrew now?', false))) {
      console.log(chalk.gray('Running `brew install whisper-cpp`…\n'));
      await brewInstallWhisper();
      bin = await findTranscriber();
      if (bin) return bin;
    }
  }
  console.log(chalk.gray('Install whisper.cpp (e.g. `brew install whisper-cpp`), then re-run `monogit voice`.\n'));
  return null;
}

async function ensureModel(name, yes) {
  if (!MODELS[name]) {
    console.log(chalk.red(`\nUnknown voice model "${name}". Choose: ${Object.keys(MODELS).join(', ')}.\n`));
    return null;
  }
  if (hasModel(name)) return modelPath(name);

  const meta = MODELS[name];
  if (!yes) {
    console.log(chalk.cyan(`\nVoice needs the whisper ${name} model (~${meta.mb} MB).`));
    if (!(await confirm('Download it now?', true))) {
      console.log(chalk.gray('Skipped. Set "voice.model"/"voice.transcribe" in .monogit.json to use your own.\n'));
      return null;
    }
  }
  try {
    const dest = await downloadModel(name, (r, t) => renderProgress(`downloading ${meta.file}`, r, t));
    process.stderr.write('\n');
    console.log(chalk.green(`✔ Model ready: ${dest}\n`));
    return dest;
  } catch (err) {
    process.stderr.write('\n');
    console.log(chalk.red(`❌ Could not download model: ${err.message}\n`));
    return null;
  }
}

// ---- utterance capture (hands-free; stops on the silence after speech) ----

// ffmpeg can't auto-stop, so we watch silencedetect on stderr and cut the
// recording once silence follows actual speech.
function captureFfmpegUtterance(audio, { device = ':0', threshold = '-35dB', silence = 1.2, maxSeconds = 20 }) {
  return new Promise((resolve) => {
    const input =
      process.platform === 'darwin' ? ['-f', 'avfoundation', '-i', device] : ['-f', 'alsa', '-i', 'default'];
    const proc = execa(
      'ffmpeg',
      ['-hide_banner', ...input, '-af', `silencedetect=noise=${threshold}:d=${silence}`, '-ar', '16000', '-ac', '1', '-y', audio],
      { reject: false }
    );
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      proc.kill('SIGINT'); // graceful — ffmpeg finalizes the wav
    };
    proc.stderr?.on('data', (d) => {
      for (const line of String(d).split('\n')) {
        const m = line.match(/silence_start:\s*([\d.]+)/);
        if (m && parseFloat(m[1]) > 0.4) finish(); // spoke, then went quiet → end of command
      }
    });
    const cap = setTimeout(finish, maxSeconds * 1000);
    proc.finally(() => {
      clearTimeout(cap);
      resolve();
    });
  });
}

async function transcribe(transcribeCmd, audio) {
  const result = await execa(substitute(transcribeCmd, audio), { shell: true, reject: false, all: true });
  let text = '';
  for (const candidate of [`${audio}.txt`, audio.replace(/\.wav$/, '.txt')]) {
    try {
      text = await fs.readFile(candidate, 'utf8');
      await fs.rm(candidate, { force: true });
      break;
    } catch {
      // fall back to stdout
    }
  }
  if (!text) text = result.stdout || '';
  return cleanTranscript(text);
}

// Capture one spoken command and return its transcript.
async function listenOnce(pipeline) {
  const audio = path.join(os.tmpdir(), `monogit_voice_${process.pid}_${Date.now()}.wav`);
  try {
    await pipeline.capture(audio);
    return await transcribe(pipeline.transcribe, audio);
  } finally {
    await fs.rm(audio, { force: true });
  }
}

// Build a record/transcribe pipeline, auto-provisioning what's missing.
async function resolveVoicePipeline(voice, options) {
  if (!process.stdin.isTTY) {
    console.log(chalk.red('\n❌ Voice capture needs an interactive terminal (or pass text: `monogit voice "status"`).\n'));
    return null;
  }

  let transcribeCmd = voice.transcribe;
  if (!transcribeCmd) {
    const bin = await ensureTranscriberBinary(options.yes);
    if (!bin) return null;
    const model = await ensureModel(voice.model || DEFAULT_MODEL, options.yes);
    if (!model) return null;
    transcribeCmd = buildTranscribeCommand(bin, model);
  }

  let capture;
  if (voice.record) {
    // A configured recorder must self-terminate at the end of an utterance (VAD).
    capture = (audio) => execa(substitute(voice.record, audio), { shell: true, stdio: 'ignore', reject: false });
  } else {
    const recorder = await findRecorder();
    if (!recorder) {
      console.log(chalk.red('\n❌ No recorder found. Install `ffmpeg` or `sox`, or set "voice.record".\n'));
      return null;
    }
    if (recorder.mode === 'sox') {
      const cmd = soxUtteranceCommand();
      capture = (audio) => execa(substitute(cmd, audio), { shell: true, stdio: 'ignore', reject: false });
    } else {
      capture = (audio) => captureFfmpegUtterance(audio, { device: voice.device || ':0' });
    }
  }

  return { capture, transcribe: transcribeCmd };
}

// ---- command dispatch ----

async function dispatch(intent, { commitUntracked = true } = {}) {
  switch (intent.kind) {
    case 'status':
      return statusCommand({});
    case 'list':
      return reposListCommand();
    case 'commit':
      // Voice "commit" stages everything (incl. new files) by default;
      // set voice.commitUntracked=false to commit tracked changes only.
      return commitCommand([], commitUntracked ? { message: [intent.message], addAll: true } : { message: [intent.message], a: true });
    case 'branch-create':
      return gitProxyCommand('checkout', ['-b', intent.branch], {});
    case 'checkout':
      return gitProxyCommand('checkout', [intent.branch], {});
    case 'merge':
      return gitProxyCommand('merge', [intent.branch], {});
    case 'push':
      return gitProxyCommand('push', resolvePushArgs(), {});
    case 'pull':
      return gitProxyCommand('pull', [], {});
    case 'fetch':
      return gitProxyCommand('fetch', [], {});
    case 'log':
      return visualCommand('log', [], {});
    case 'diff':
      return visualCommand('diff', [], {});
    case 'show':
      return showCommand(undefined, {});
    case 'tidy':
      return tidyCommand({ dryRun: true }); // voice never deletes
    default:
      return undefined;
  }
}

// Interpret + (confirm) + run a single transcript. `confirmFn` is null to skip.
async function handleTranscript(transcript, { dryRun, confirmFn, commitUntracked }) {
  console.log(chalk.gray(`\n🗣  Heard: `) + chalk.white(`"${transcript}"`));
  const intent = interpret(transcript);

  if (intent.kind === 'unknown') {
    console.log(chalk.yellow("🤔 Didn't recognize that. Try:"));
    for (const line of PHRASE_HELP) console.log(chalk.gray('   ' + line));
    return;
  }
  if (intent.kind === 'need-message') {
    console.log(chalk.yellow('🤔 Heard "commit" but no message. Say: "commit message <your message>".'));
    return;
  }

  console.log(chalk.cyan(`→ monogit ${intent.label}`));
  if (dryRun) return;

  if (intent.write && confirmFn) {
    const ok = await confirmFn(intent);
    if (!ok) {
      console.log(chalk.gray('Skipped.'));
      return;
    }
  }
  await dispatch(intent, { commitUntracked });
}

export async function voiceCommand(phrase, options = {}) {
  const config = await readConfig();
  const voice = config.voice || {};
  const confirmEnabled = voice.confirm !== false && !options.yes;
  const commitUntracked = stageUntrackedDefault(config); // default: commit everything

  // 1) Text passed directly or piped in — no mic, no loop.
  if (phrase && phrase.length) {
    const typedConfirm = confirmEnabled
      ? async (intent) =>
          process.stdin.isTTY ? confirm(`Run \`monogit ${intent.label}\`?`, true) : Boolean(options.yes)
      : null;
    await handleTranscript(phrase.join(' '), { dryRun: options.dryRun, confirmFn: typedConfirm, commitUntracked });
    return;
  }
  if (!process.stdin.isTTY) {
    const text = (await readStdin()).trim();
    if (!text) return console.log(chalk.yellow('\nNothing heard.\n'));
    // No terminal to confirm at — run reads, but skip writes unless --yes.
    const pipedConfirm = options.yes ? null : async () => false;
    await handleTranscript(text, { dryRun: options.dryRun, confirmFn: pipedConfirm, commitUntracked });
    return;
  }

  // 2) Live mic — resolve the pipeline (provisioning prompts happen here).
  const pipeline = await resolveVoicePipeline(voice, options);
  if (!pipeline) return;

  // Spoken confirmation keeps writes safe without breaking hands-free.
  const spokenConfirm = confirmEnabled
    ? async () => {
        console.log(chalk.gray('   say "yes" to run, or "no" to skip…'));
        const answer = await listenOnce(pipeline);
        console.log(chalk.gray(`   🗣  "${answer}"`));
        return isAffirmative(answer);
      }
    : null;

  // 3a) Single utterance.
  if (options.once) {
    const text = await listenOnce(pipeline);
    if (!text) return console.log(chalk.yellow('\nNothing heard.\n'));
    await handleTranscript(text, { dryRun: options.dryRun, confirmFn: spokenConfirm, commitUntracked });
    return;
  }

  // 3b) Continuous, hands-free loop.
  console.log(
    chalk.cyan.bold('\n🎙️  Listening continuously. ') +
      chalk.gray('Speak a command, pause, and it runs. Say "stop" or press Ctrl-C to end.\n')
  );
  let stop = false;
  const onSigint = () => {
    stop = true;
  };
  process.on('SIGINT', onSigint);
  try {
    while (!stop) {
      const text = await listenOnce(pipeline);
      if (stop) break;
      if (!text) continue; // silence / noise — keep listening
      if (isStopWord(text)) {
        console.log(chalk.gray(`\n🗣  Heard: "${text}"`));
        break;
      }
      await handleTranscript(text, { dryRun: options.dryRun, confirmFn: spokenConfirm, commitUntracked });
    }
  } finally {
    process.off('SIGINT', onSigint);
  }
  console.log(chalk.cyan('\n👋 Stopped listening.\n'));
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
