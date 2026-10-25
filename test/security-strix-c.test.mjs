// Regression tests for Strix findings C (request & file integrity):
//   vuln-0003 — API request path injection via unencoded resource IDs
//   vuln-0007 — unstable auto-minted idempotency key in `pay`
//   vuln-0008 — path traversal + silent overwrite in invoice PDF downloads
//   vuln-0009 — destructive delete/cancel without a confirmation gate
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const cli = new URL('../dist/cli.mjs', import.meta.url).pathname;

async function fixture(t, responder = () => ({ success: true, data: { id: 'synthetic', deleted: true } })) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    requests.push({ method: req.method, url: req.url, body });
    const out = responder(requests.at(-1));
    res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.body ?? out));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/v2`;
  const run = (args, input = '') => new Promise((resolve, reject) => {
    const env = { ...process.env, GIGSTACK_API_KEY: 'synthetic-test-token', GIGSTACK_API_BASE_URL: base, GIGSTACK_TEAM: '', NO_COLOR: '1' };
    const child = spawn(process.execPath, [cli, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
  return { run, requests, base };
}

// ─── vuln-0003: path injection via unencoded resource IDs ───────────────────

test('vuln-0003: traversal-carrying ID never reaches the server (segment rejects it)', async t => {
  const f = await fixture(t);
  // --yes bypasses the confirmation gate so we isolate the path-injection defense.
  const r = await f.run(['clients', 'delete', 'c1/../../webhooks/wh1', '--yes', '--json']);
  assert.equal(r.code, 1, r.stdout);
  assert.match(JSON.parse(r.stdout).error.message, /inválid/i);
  assert.equal(f.requests.length, 0, 'no authenticated request may be issued for a traversal ID');
});

test('vuln-0003: query characters in an ID are percent-encoded into one path segment, not a real query', async t => {
  const f = await fixture(t, () => ({ success: true, data: { id: 'p1' } }));
  const r = await f.run(['payments', 'get', 'p1?team=other&limit=1', '--json']);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(f.requests.length, 1);
  const url = new URL(f.requests[0].url, 'http://x');
  assert.equal(url.pathname, '/v2/payments/p1%3Fteam%3Dother%26limit%3D1');
  assert.equal(url.searchParams.get('team'), null, 'the injected team query must not survive');
  assert.equal(url.searchParams.get('limit'), null);
});

// ─── vuln-0007: stable idempotency key in `pay` ─────────────────────────────

const PAY_UUID = '11111111-1111-4111-8111-111111111111';

test('vuln-0007: retrying pay with the same --operation-id presents the same idempotency_key', async t => {
  const f = await fixture(t, () => ({ success: true, data: { id: 'payment_x' } }));
  const args = ['pay', '--email', 'a@b.test', '--amount', '100', '--description', 'test', '--operation-id', PAY_UUID, '--json'];
  const r1 = await f.run(args);
  const r2 = await f.run(args);
  assert.equal(r1.code, 0, r1.stdout);
  assert.equal(r2.code, 0, r2.stdout);
  const keys = f.requests.map(req => JSON.parse(req.body).idempotency_key);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], PAY_UUID);
  assert.equal(keys[1], PAY_UUID, 'a retry must reuse the key so the server dedupes it');
});

test('vuln-0007: pay refuses to auto-mint a key in non-interactive mode', async t => {
  const f = await fixture(t);
  const r = await f.run(['pay', '--email', 'a@b.test', '--amount', '100', '--description', 'test', '--json']);
  assert.equal(r.code, 1, r.stdout);
  assert.match(JSON.parse(r.stdout).error.message, /operation-id/);
  assert.equal(f.requests.length, 0, 'no payment may be registered without a stable key');
});

// ─── vuln-0008: PDF download traversal + silent overwrite ───────────────────

const pdf = Buffer.from('%PDF-1.4 regression').toString('base64');

test('vuln-0008: a traversal uuid cannot write a PDF outside --out', async t => {
  const f = await fixture(t, () => ({ pdf }));
  const outDir = await mkdtemp(join(tmpdir(), 'gigstack-sec-out-'));
  t.after(() => rm(dirname(outDir), { recursive: true, force: true }).catch(() => {}));
  const escaped = join(dirname(outDir), 'escaped-write.pdf');
  const r = await f.run(['invoices', 'sat', 'download', '../escaped-write', '-o', outDir, '--json']);
  assert.equal(r.code, 1, r.stdout);
  assert.equal(existsSync(escaped), false, 'the write must not escape the intended directory');
});

test('vuln-0008: a downloaded PDF is never silently overwritten', async t => {
  const f = await fixture(t, () => ({ pdf }));
  const outDir = await mkdtemp(join(tmpdir(), 'gigstack-sec-ow-'));
  t.after(() => rm(outDir, { recursive: true, force: true }).catch(() => {}));
  const uuid = 'a1b2c3d4';
  const first = await f.run(['invoices', 'sat', 'download', uuid, '-o', outDir, '--json']);
  assert.equal(first.code, 0, first.stdout);
  assert.equal(existsSync(join(outDir, `${uuid}.pdf`)), true);
  const second = await f.run(['invoices', 'sat', 'download', uuid, '-o', outDir, '--json']);
  assert.equal(second.code, 1, 'a second download to the same name must refuse, not overwrite');
  assert.match(JSON.parse(second.stdout).error.message, /ya existe/i);
});

// ─── vuln-0009: confirmation gate on destructive commands ───────────────────

for (const args of [
  ['clients', 'delete', 'client_abc'],
  ['services', 'delete', 'service_abc'],
  ['invoices', 'cancel', 'a1b2c3d4', '--motive', '02'],
]) {
  test(`vuln-0009: \`${args.slice(0, 2).join(' ')}\` refuses without --yes when non-interactive`, async t => {
    const f = await fixture(t);
    const r = await f.run([...args, '--json']);
    assert.equal(r.code, 1, r.stdout);
    assert.equal(f.requests.length, 0, 'the destructive mutation must not be issued without confirmation');
  });
}

test('vuln-0009: clients delete proceeds with --yes', async t => {
  const f = await fixture(t);
  const r = await f.run(['clients', 'delete', 'client_abc', '--yes', '--json']);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].method, 'DELETE');
  assert.equal(new URL(f.requests[0].url, 'http://x').pathname, '/v2/clients/client_abc');
});
