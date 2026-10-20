import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.mjs', import.meta.url).pathname;
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const EMAIL = 'person@example.com';
const EXPIRES = Date.UTC(2026, 9, 26, 12);
const created = { success: true, data: { team_id: 'team_sandbox', billing_account_id: 'ba_sandbox', livemode: false, api_key: { test: 'sk_test_synthetic_once' }, credential_delivery: 'first_response', claim: { sent_to: EMAIL, expires_at: EXPIRES, delivery: 'sent' } } };

async function fixture(t, reply = () => [201, created]) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const parsed = body ? JSON.parse(body) : undefined;
    requests.push({ method: req.method, url: req.url, body: parsed, authorization: req.headers.authorization, idempotencyKey: req.headers['idempotency-key'] });
    const [status, payload] = reply(req.url, parsed);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const dir = await mkdtemp(join(tmpdir(), 'gigstack-signup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const base = `http://127.0.0.1:${server.address().port}/v2`;
  function run(args, env = {}) {
    const childEnv = { ...process.env, GIGSTACK_CONFIG_DIR: dir, GIGSTACK_API_BASE_URL: base, ...env };
    delete childEnv.GIGSTACK_API_KEY; delete childEnv.GIGSTACK_TEAM;
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args, '--json'], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
      child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
    });
  }
  return { requests, dir, base, run };
}

const signupArgs = ['signup', '--sandbox', '--email', EMAIL, '--name', 'Example Person'];

test('signup sends the public request without credentials and stores the test key like login', async t => {
  const f = await fixture(t);
  // A stored credential must not be sent to a public route.
  await writeFile(join(f.dir, 'credentials.json'), JSON.stringify({ activeProfile: 'prod', profiles: { prod: { apiKey: 'synthetic-stored-bearer', environment: 'production' } } }), { mode: 0o600 });
  const r = await f.run(signupArgs);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(f.requests.length, 1);
  const [req] = f.requests;
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/v2/auth/sandbox');
  assert.equal(req.authorization, undefined);
  assert.match(req.idempotencyKey, /^[A-Za-z0-9._:-]{8,128}$/);
  assert.deepEqual(req.body, { email: EMAIL, name: 'Example Person', agent: { client: `gigstack-cli/${pkg.version}` } });
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'created');
  assert.equal(out.team_id, 'team_sandbox');
  assert.equal(out.profile, 'sandbox');
  assert.equal(out.idempotency_key, req.idempotencyKey);
  assert.ok(!r.stdout.includes('sk_test_synthetic_once'), 'a saved key is never printed');
  assert.ok(out.next_steps.some(s => s.includes('gigstack signup claim --team team_sandbox')));
  const saved = JSON.parse(await readFile(join(f.dir, 'credentials.json'), 'utf8'));
  assert.deepEqual(saved.profiles.sandbox, { apiKey: 'sk_test_synthetic_once', environment: 'test', baseUrl: f.base });
  assert.equal(saved.activeProfile, 'sandbox');
  assert.equal(saved.profiles.prod.apiKey, 'synthetic-stored-bearer');
  assert.equal((await stat(join(f.dir, 'credentials.json'))).mode & 0o777, 0o600);
});

test('--no-save prints the key once and writes nothing; --idempotency-key is sent verbatim', async t => {
  const f = await fixture(t);
  const r = await f.run([...signupArgs, '--no-save', '--idempotency-key', 'retry-key-0001']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.api_key.test, 'sk_test_synthetic_once');
  assert.equal(out.profile, null);
  assert.equal(f.requests[0].idempotencyKey, 'retry-key-0001');
  await assert.rejects(readFile(join(f.dir, 'credentials.json')));
});

test('an existing profile name is refused before any request', async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, 'credentials.json'), JSON.stringify({ activeProfile: 'sandbox', profiles: { sandbox: { apiKey: 'synthetic-old', environment: 'test' } } }), { mode: 0o600 });
  const r = await f.run(signupArgs);
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).error.code, 'profile_exists');
  assert.equal(f.requests.length, 0);
});

test('signup requires --sandbox, --email and --name', async t => {
  const f = await fixture(t);
  for (const args of [['signup', '--email', EMAIL, '--name', 'X'], ['signup', '--sandbox', '--name', 'X'], ['signup', '--sandbox', '--email', EMAIL]]) {
    const r = await f.run(args);
    assert.equal(r.code, 1, args.join(' '));
  }
  assert.equal(f.requests.length, 0);
});

test('404 says the feature is not enabled', async t => {
  const f = await fixture(t, () => [404, { success: false, error: { code: 'not_found', message: 'Not found' } }]);
  for (const args of [signupArgs, ['signup', 'claim', '--team', 'team_sandbox', '--code', '123456']]) {
    const r = await f.run(args);
    assert.equal(r.code, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.error.status, 404);
    assert.match(out.error.message, /no está habilitada/);
  }
});

test('409 sandbox_pending_claim surfaces team_id and claim without a key or a saved profile', async t => {
  const f = await fixture(t, () => [409, { success: false, error: { code: 'sandbox_pending_claim', message: 'pending' }, data: { team_id: 'team_pending', claim: { sent_to: EMAIL, expires_at: EXPIRES, delivery: 'sent' } } }]);
  const r = await f.run(signupArgs);
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'sandbox_pending_claim');
  assert.equal(out.team_id, 'team_pending');
  assert.equal(out.claim.sent_to, EMAIL);
  await assert.rejects(readFile(join(f.dir, 'credentials.json')));
});

test('other refusals keep their code; server faults report the idempotency key for a retry', async t => {
  for (const [status, code, retry] of [[409, 'email_already_exists', false], [400, 'email_not_allowed', false], [429, 'rate_limit_exceeded', false], [409, 'sandbox_outcome_unknown', true], [503, 'sandbox_unavailable', true]]) {
    const f = await fixture(t, () => [status, { success: false, error: { code, message: 'synthetic' } }]);
    const r = await f.run(signupArgs);
    assert.equal(r.code, 1, code);
    const out = JSON.parse(r.stdout);
    assert.equal(out.error.code, code);
    assert.equal(out.error.status, status);
    assert.equal(Boolean(out.idempotency_key), retry, code);
    if (retry) assert.equal(out.idempotency_key, f.requests[0].idempotencyKey);
  }
});

test('signup claim sends exactly { team_id, code } without credentials', async t => {
  const f = await fixture(t, () => [200, { success: true, data: { claimed: true, team_id: 'team_sandbox', password_email: 'sent', next: 'Check your email to set your password, then go live from the app' } }]);
  const r = await f.run(['signup', 'claim', '--team', 'team_sandbox', '--code', '123456'], { GIGSTACK_API_KEY: 'synthetic-env-key' });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(f.requests, [{ method: 'POST', url: '/v2/auth/sandbox/claim', body: { team_id: 'team_sandbox', code: '123456' }, authorization: undefined, idempotencyKey: undefined }]);
  assert.equal(JSON.parse(r.stdout).claimed, true);
});

test('signup claim validates input locally and maps invalid_or_expired_code', async t => {
  const f = await fixture(t, () => [400, { success: false, error: { code: 'invalid_or_expired_code', message: 'bad' } }]);
  for (const args of [['signup', 'claim', '--code', '123456'], ['signup', 'claim', '--team', 'team_sandbox', '--code', '12ab']]) {
    assert.equal((await f.run(args)).code, 1);
  }
  assert.equal(f.requests.length, 0);
  const r = await f.run(['signup', 'claim', '--team', 'team_sandbox', '--code', '000000']);
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.error.code, 'invalid_or_expired_code');
  assert.match(out.hint, /signup --sandbox/);
});
