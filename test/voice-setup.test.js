import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { MODELS, DEFAULT_MODEL, modelPath, buildTranscribeCommand, modelCacheDir } from '../src/core/voice-setup.js';

test('the default model is a known model', () => {
  assert.ok(MODELS[DEFAULT_MODEL], 'DEFAULT_MODEL must exist in MODELS');
  assert.match(MODELS[DEFAULT_MODEL].url, /^https:\/\/huggingface\.co\//);
});

test('modelCacheDir honors XDG_CACHE_HOME', () => {
  const prev = process.env.XDG_CACHE_HOME;
  try {
    process.env.XDG_CACHE_HOME = '/tmp/xdg';
    assert.equal(modelCacheDir(), path.join('/tmp/xdg', 'monogit', 'models'));
  } finally {
    if (prev === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = prev;
  }
});

test('modelPath maps to the cache dir; unknown models return null', () => {
  const p = modelPath('base.en');
  assert.ok(p.endsWith(path.join('monogit', 'models', 'ggml-base.en.bin')));
  assert.equal(modelPath('nope'), null);
});

test('buildTranscribeCommand quotes the model and templates the audio', () => {
  const cmd = buildTranscribeCommand('whisper-cli', '/m/base.en.bin');
  assert.equal(cmd, 'whisper-cli -m "/m/base.en.bin" -nt -f {audio}');
  assert.ok(cmd.includes('{audio}'));
});
