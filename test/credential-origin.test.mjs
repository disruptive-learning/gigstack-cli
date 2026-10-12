import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const cli = new URL('../dist/cli.mjs', import.meta.url).pathname;
async function fixture(t) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: { id: 'team_test', settings: {} } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const dir = await mkdtemp(join(tmpdir(), 'gigstack-origin-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const base = `http://127.0.0.1:${server.address().port}/v2`;
  async function profile(baseUrl = base) {
    await writeFile(join(dir, 'credentials.json'), JSON.stringify({ activeProfile: 'fixture', profiles: { fixture: { apiKey: 'synthetic-stored-bearer', environment: 'test', ...(baseUrl === null ? {} : { baseUrl }) } } }), { mode: 0o600 });
  }
  function run(args, values = {}) {
    const env = { ...process.env, GIGSTACK_CONFIG_DIR: dir };
    delete env.GIGSTACK_API_KEY; delete env.GIGSTACK_API_BASE_URL; delete env.GIGSTACK_TEAM;
    Object.assign(env, values);
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args, '--json'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
      child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
    });
  }
  return { requests, dir, base, profile, run };
}
test('stored profile rejects flag/environment origin overrides before reads, writes or whoami', async t => {
  const f = await fixture(t); await f.profile('https://api.gigstack.io/v2');
  const commands = [['teams', 'get', 'team_test'], ['whoami', '--team', 'team_test'], ['teams', 'update', 'team_test', '--data', '{"brand":{"alias":"fixture"}}']];
  for (const args of commands) for (const method of ['flag', 'environment']) {
    const r = await f.run(method === 'flag' ? [...args, '--base-url', f.base] : args, method === 'environment' ? { GIGSTACK_API_BASE_URL: f.base } : {});
    assert.equal(r.code, 1, r.stdout);
    assert.equal(JSON.parse(r.stdout).error.code, 'credential_origin_mismatch');
    assert.ok(!r.stdout.includes('synthetic-stored-bearer'));
  }
  assert.equal(f.requests.length, 0);
});
test('legacy profiles default to production origin and cannot silently migrate using --base-url', async t => {
  const f = await fixture(t); await f.profile(null);
  const r = await f.run(['teams', 'get', 'team_test', '--base-url', f.base]);
  assert.equal(r.code, 1); assert.equal(JSON.parse(r.stdout).error.code, 'credential_origin_mismatch');
  assert.equal(f.requests.length, 0);
});
test('saved staging origin works, same-origin path changes work, different ports are refused', async t => {
  const f = await fixture(t); await f.profile();
  for (const args of [['teams', 'get', 'team_test'], ['whoami', '--team', 'team_test'], ['teams', 'get', 'team_test', '--base-url', f.base.replace('/v2', '/alternate')]]) {
    const r = await f.run(args); assert.equal(r.code, 0, r.stdout);
  }
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[2].url, '/alternate/teams/team_test');
  assert.ok(f.requests.every(req => req.authorization === 'Bearer synthetic-stored-bearer'));
  const other = await fixture(t);
  const r = await f.run(['whoami', '--team', 'team_test', '--base-url', other.base]);
  assert.equal(r.code, 1); assert.equal(other.requests.length, 0);
});
test('explicit login key configures a new staging profile without reusing saved credentials', async t => {
  const f = await fixture(t); await f.profile('https://api.gigstack.io/v2');
  const r = await f.run(['login', '--profile', 'local', '--team', 'team_test', '--base-url', f.base, '--api-key', 'synthetic-explicit-key']);
  assert.equal(r.code, 0, r.stdout); assert.ok(!r.stdout.includes('synthetic-explicit-key'));
  assert.equal(f.requests[0].authorization, 'Bearer synthetic-explicit-key');
  const saved = JSON.parse(await readFile(join(f.dir, 'credentials.json'), 'utf8'));
  assert.equal(saved.profiles.local.baseUrl, f.base);
  assert.equal((await f.run(['teams', 'get', 'team_test'])).code, 0);
});
test('explicit environment credential and API configuration preserve CI/local development', async t => {
  const f = await fixture(t); await f.profile('https://api.gigstack.io/v2');
  const r = await f.run(['teams', 'get', 'team_test'], { GIGSTACK_API_KEY: 'synthetic-ci-key', GIGSTACK_API_BASE_URL: f.base });
  assert.equal(r.code, 0, r.stdout); assert.equal(f.requests[0].authorization, 'Bearer synthetic-ci-key');
});
