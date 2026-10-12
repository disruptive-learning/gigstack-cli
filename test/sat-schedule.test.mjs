import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const cli = new URL('../dist/cli.mjs', import.meta.url).pathname;
async function fixture(t, data) {
  const requests = [];
  const server = createServer(async (req, res) => {
    for await (const _ of req);
    requests.push({ method: req.method, url: req.url });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, data }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/v2`;
  const run = args => new Promise((resolve, reject) => {
    const env = { ...process.env, GIGSTACK_API_KEY: 'synthetic-test-token', GIGSTACK_API_BASE_URL: base, GIGSTACK_TEAM: '', NO_COLOR: '1' };
    const child = spawn(process.execPath, [cli, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end('');
  });
  return { run, requests };
}
const schedule = { schedule: null, sat_completed: true, fiel_uploaded: true, registered: true, registered_at: 1, sync_start_date: '2021-01-01', fiel: null };
const sync = { synced: true, sync_from: '2021-01-01', last_sync: '2026-10-10', monthly_cap: 5000, message: null };

test('schedule show reads sync_status as returned by the current API', async t => {
  const f = await fixture(t, { ...schedule, sync_status: sync, prodigia: { ...sync, sync_from: 'alias-only' } });
  const result = await f.run(['invoices', 'sat', 'schedule', 'show']);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(f.requests.map(r => `${r.method} ${new URL(r.url, 'http://x').pathname}`), ['GET /v2/invoices/download/schedule']);
  assert.match(result.stdout, /Sincronización con el SAT/);
  assert.match(result.stdout, /2021-01-01/);
  assert.doesNotMatch(result.stdout, /alias-only|Prodigia/);
});

test('schedule show falls back to the deprecated prodigia alias', async t => {
  const f = await fixture(t, { ...schedule, prodigia: { ...sync, last_sync: 'from-alias' } });
  const result = await f.run(['invoices', 'sat', 'schedule', 'show']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /from-alias/);
});

test('schedule show --json passes sync_status through unchanged', async t => {
  const f = await fixture(t, { ...schedule, sync_status: sync });
  const result = await f.run(['invoices', 'sat', 'schedule', 'show', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).sync_status, sync);
});
