import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, stat, lstat, symlink, chmod, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.mjs', import.meta.url).pathname;

async function fixture(t) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: { id: 'team_test', legal_name: 'Fixture', settings: {} } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const dir = await mkdtemp(join(tmpdir(), 'gigstack-harden-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const base = `http://127.0.0.1:${server.address().port}/v2`;
  async function profile(baseUrl = base) {
    await writeFile(join(dir, 'credentials.json'), JSON.stringify({ activeProfile: 'fixture', profiles: { fixture: { apiKey: 'synthetic-stored-bearer', environment: 'test', ...(baseUrl === null ? {} : { baseUrl }) } } }), { mode: 0o600 });
  }
  function run(args, values = {}, configDir = dir) {
    const env = { ...process.env, GIGSTACK_CONFIG_DIR: configDir };
    delete env.GIGSTACK_API_KEY; delete env.GIGSTACK_API_BASE_URL; delete env.GIGSTACK_TEAM;
    Object.assign(env, values);
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args, '--json'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
      child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
    });
  }
  return { requests, dir, base, profile, run };
}

// vuln-0005: doctor must enforce the same origin-binding guard as whoami and must
// never send the saved profile key to an attacker-chosen --base-url / env origin.
test('vuln-0005: doctor refuses origin override and does not leak the saved key (flag + env)', async t => {
  const f = await fixture(t); await f.profile('https://api.gigstack.io/v2');
  for (const variant of ['flag', 'environment']) {
    const r = await f.run(
      variant === 'flag' ? ['doctor', '--base-url', f.base] : ['doctor'],
      variant === 'environment' ? { GIGSTACK_API_BASE_URL: f.base } : {}
    );
    assert.equal(JSON.parse(r.stdout).ok, false, r.stdout);
    assert.ok(!r.stdout.includes('synthetic-stored-bearer'), 'saved key must not appear in output');
  }
  assert.equal(f.requests.length, 0, 'no request should reach the attacker origin');
});

// vuln-0006 (PoC B): a pre-planted symlink at credentials.json must not be followed.
test('vuln-0006: login refuses to write the key through a pre-planted credentials symlink', async t => {
  const f = await fixture(t);
  const stolen = join(f.dir, 'stolen.json');
  await writeFile(stolen, '{}', { mode: 0o644 });
  await symlink(stolen, join(f.dir, 'credentials.json'));
  const r = await f.run(['login', '--team', 'team_test', '--base-url', f.base, '--api-key', 'synthetic-explicit-key']);
  assert.notEqual(r.code, 0, 'login should fail rather than follow the symlink');
  const leaked = await readFile(stolen, 'utf8');
  assert.ok(!leaked.includes('synthetic-explicit-key'), 'key must not be written through the symlink');
});

// vuln-0006 (PoC C): a pre-existing world-readable store must end up 0600 after a write.
test('vuln-0006: login tightens a pre-existing 0644 credentials file to 0600', async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, 'credentials.json'), JSON.stringify({ profiles: {}, activeProfile: '' }), { mode: 0o644 });
  await chmod(join(f.dir, 'credentials.json'), 0o644);
  const r = await f.run(['login', '--team', 'team_test', '--base-url', f.base, '--api-key', 'synthetic-explicit-key']);
  assert.equal(r.code, 0, r.stdout);
  const mode = (await stat(join(f.dir, 'credentials.json'))).mode & 0o777;
  assert.equal(mode & 0o077, 0, `expected owner-only mode, got ${mode.toString(8)}`);
});

// vuln-0006 (PoC F): a symlinked GIGSTACK_CONFIG_DIR must be rejected, not followed.
test('vuln-0006: login refuses a symlinked config directory', async t => {
  const f = await fixture(t);
  const attackerDir = await mkdtemp(join(tmpdir(), 'gigstack-attacker-'));
  t.after(() => rm(attackerDir, { recursive: true, force: true }));
  const linkDir = join(f.dir, 'linked-config');
  await symlink(attackerDir, linkDir);
  const r = await f.run(['login', '--team', 'team_test', '--base-url', f.base, '--api-key', 'synthetic-explicit-key'], {}, linkDir);
  assert.notEqual(r.code, 0, 'login should refuse a symlinked config dir');
  await assert.rejects(stat(join(attackerDir, 'credentials.json')), 'no credentials should be written into the attacker dir');
});

// vuln-0004: profile name "__proto__" must be rejected, not silently drop the key
// and retarget requests to production via prototype pollution.
test('vuln-0004: login rejects reserved/dangerous profile names and stores nothing', async t => {
  const f = await fixture(t);
  for (const name of ['__proto__', 'constructor', 'prototype', 'bad/name']) {
    const r = await f.run(['login', '--profile', name, '--team', 'team_test', '--base-url', f.base, '--api-key', 'synthetic-explicit-key']);
    assert.notEqual(r.code, 0, `profile "${name}" must be rejected`);
  }
  assert.equal(f.requests.length, 0, 'rejection must happen before any API request');
  await assert.rejects(stat(join(f.dir, 'credentials.json')), 'no credential store should be created');
});

// vuln-0004 defense-in-depth: a store corrupted with activeProfile "__proto__" must
// resolve to "not authenticated", not Object.prototype → Bearer undefined to prod.
test('vuln-0004: a corrupted __proto__ store resolves as unauthenticated, not production', async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, 'credentials.json'), JSON.stringify({ profiles: {}, activeProfile: '__proto__' }), { mode: 0o600 });
  const r = await f.run(['whoami']);
  assert.notEqual(r.code, 0, r.stdout);
  assert.equal(f.requests.length, 0, 'must not send Bearer undefined to any origin');
});
