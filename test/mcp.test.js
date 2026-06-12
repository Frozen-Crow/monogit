import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

const SERVER = fileURLToPath(new URL('../src/mcp/server.js', import.meta.url));
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

let ws;

before(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'monogit-mcp-'));
  for (const r of ['api', 'web']) {
    const repo = path.join(ws, r);
    await fs.mkdir(repo);
    await execa('git', ['init', '-b', 'main'], { cwd: repo, env });
    await fs.writeFile(path.join(repo, 'f'), '1');
    await execa('git', ['add', '-A'], { cwd: repo, env });
    await execa('git', ['commit', '-m', 'init'], { cwd: repo, env });
  }
  await fs.writeFile(path.join(ws, '.monogit.json'), JSON.stringify({ repos: ['api', 'web'] }));
});

after(async () => {
  await fs.rm(ws, { recursive: true, force: true });
});

// Send JSON-RPC request lines, collect responses keyed by id.
function rpc(requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { cwd: ws, env });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', () => {
      const byId = {};
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.id !== undefined && msg.id !== null) byId[msg.id] = msg;
      }
      resolve(byId);
    });
    for (const r of requests) child.stdin.write(JSON.stringify(r) + '\n');
    child.stdin.end();
  });
}

test('initialize returns protocol version and serverInfo', async () => {
  const res = await rpc([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }]);
  assert.equal(res[1].result.protocolVersion, '2025-06-18');
  assert.equal(res[1].result.serverInfo.name, 'monogit');
  assert.ok(res[1].result.capabilities.tools);
});

test('tools/list exposes the monogit tools', async () => {
  const res = await rpc([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]);
  const names = res[2].result.tools.map((t) => t.name);
  for (const expected of ['monogit_status', 'monogit_commit', 'monogit_exec', 'monogit_tidy', 'monogit_show']) {
    assert.ok(names.includes(expected), `missing tool ${expected}`);
  }
});

test('tools/call monogit_status returns per-repo state', async () => {
  const res = await rpc([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'monogit_status', arguments: {} } },
  ]);
  const data = JSON.parse(res[2].result.content[0].text);
  assert.equal(data.length, 2);
  assert.deepEqual(data.map((d) => d.repo).sort(), ['api', 'web']);
  assert.equal(data.every((d) => d.ok && d.branch === 'main'), true);
});

test('unknown tool yields a JSON-RPC error', async () => {
  const res = await rpc([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nope', arguments: {} } },
  ]);
  assert.ok(res[2].error, 'expected an error response');
  assert.equal(res[2].error.code, -32602);
});
