import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.mjs', import.meta.url).pathname;
const KEY = 'sk_test_synthetic_sandbox_key_0001';

/** Local API double: `routes['POST /v2/auth/sandbox']` = (req, body) => [status, json] | 'drop'. */
async function fixture(t, routes = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const path = req.url.split('?')[0];
      requests.push({ method: req.method, url: req.url, path, headers: req.headers, body });
      const handler = routes[`${req.method} ${path}`];
      const out = handler ? handler(req, body) : [404, { success: false, error: { code: 'not_found', message: 'Not found' } }];
      if (out === 'drop') { req.socket.destroy(); return; }
      res.statusCode = out[0];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(out[1]));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const dir = await mkdtemp(join(tmpdir(), 'gigstack-signup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const base = `http://127.0.0.1:${server.address().port}/v2`;
  const credentials = async () => JSON.parse(await readFile(join(dir, 'credentials.json'), 'utf8'));
  async function profile(profiles, activeProfile = Object.keys(profiles)[0]) {
    await writeFile(join(dir, 'credentials.json'), JSON.stringify({ activeProfile, profiles }), { mode: 0o600 });
  }
  function run(args, { json = true, env: extra = {}, baseUrl = true } = {}) {
    const env = { ...process.env, GIGSTACK_CONFIG_DIR: dir, GIGSTACK_API_TIMEOUT_MS: '5000' };
    delete env.GIGSTACK_API_KEY; delete env.GIGSTACK_API_BASE_URL; delete env.GIGSTACK_TEAM; delete env.GIGSTACK_APP_ORIGIN;
    Object.assign(env, extra);
    const argv = [cli, ...args, ...(baseUrl ? ['--base-url', base] : []), ...(json ? ['--json'] : [])];
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, argv, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
      child.on('error', reject);
      child.on('close', code => resolve({ code, stdout, stderr, json: (() => { try { return JSON.parse(stdout); } catch { return null; } })() }));
    });
  }
  return { requests, dir, base, run, profile, credentials };
}

const EXPIRES = Date.UTC(2026, 10, 17, 18, 0, 0);
const created = () => [201, {
  success: true,
  data: {
    team_id: 'team_sbx1', billing_account_id: 'ba_sbx1', livemode: false,
    api_key: { test: KEY }, credential_delivery: 'first_response',
    claim: { sent_to: 'ana@example.com', expires_at: EXPIRES, delivery: 'sent' },
    test_issuer: { rfc: 'EKU9003173C9', legal_name: 'ESCUELA KEMPER URGATE', tax_system: '601', zip: '42501' },
  },
}];
const signupArgs = ['signup', '--email', 'ana@example.com', '--name', 'Ana Pérez'];

test('signup 201 sends a public request and saves the test key as an active test profile', async t => {
  const f = await fixture(t, { 'POST /v2/auth/sandbox': created });
  const r = await f.run(signupArgs);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(f.requests.length, 1);
  const req = f.requests[0];
  assert.equal(req.headers.authorization, undefined);
  assert.match(req.headers['idempotency-key'], /^[A-Za-z0-9._:-]{8,128}$/);
  assert.equal(req.body.email, 'ana@example.com');
  assert.equal(req.body.name, 'Ana Pérez');
  assert.match(req.body.agent.client, /^gigstack-cli\/\d+\.\d+\.\d+$/);
  assert.match(req.body.agent.client, /^[A-Za-z0-9 ._:/@+-]{1,64}$/);
  assert.deepEqual(Object.keys(req.body).sort(), ['agent', 'email', 'name']);
  assert.equal(r.json.status, 'created');
  assert.equal(r.json.api_key.test, KEY);
  assert.equal(r.json.profile, 'sandbox');
  assert.equal(r.json.idempotency_key, req.headers['idempotency-key']);
  assert.equal(r.json.claim.expires_at_iso, new Date(EXPIRES).toISOString());
  assert.equal(r.json.next_steps.length, 3);
  assert.match(r.json.next_steps[0], /gigstack demo/);
  assert.match(r.json.next_steps[1], /gigstack signup claim <código>/);
  assert.match(r.json.next_steps[2], /https:\/\/app\.gigstack\.pro\/home/);
  const creds = await f.credentials();
  assert.equal(creds.activeProfile, 'sandbox');
  assert.deepEqual(creds.profiles.sandbox, {
    apiKey: KEY, environment: 'test', baseUrl: f.base, teamId: 'team_sbx1',
    sandbox: { email: 'ana@example.com', claimExpiresAt: EXPIRES, claimed: false },
  });
});

test('signup human output never prints the saved key', async t => {
  const f = await fixture(t, { 'POST /v2/auth/sandbox': created });
  const r = await f.run([...signupArgs, '--profile', 'mi-prueba'], { json: false });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY));
  assert.match(r.stdout, /team_sbx1/);
  assert.match(r.stdout, /gigstack demo --profile mi-prueba/);
  assert.match(r.stdout, /gigstack signup claim <código> --profile mi-prueba/);
  assert.equal((await f.credentials()).profiles['mi-prueba'].apiKey, KEY);
});

test('signup 409 sandbox_pending_claim reports the team, saves nothing and points the claim at the team id', async t => {
  const f = await fixture(t, {
    'POST /v2/auth/sandbox': () => [409, {
      success: false, error: { code: 'sandbox_pending_claim', message: 'This email has an unclaimed sandbox; a new claim code was sent to it' },
      data: { team_id: 'team_old', claim: { sent_to: 'ana@example.com', expires_at: EXPIRES, delivery: 'sent' } },
    }],
  });
  const r = await f.run(signupArgs);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.status, 'pending_claim');
  assert.equal(r.json.team_id, 'team_old');
  assert.equal(r.json.api_key.test, null);
  assert.equal(r.json.next_steps.length, 2);
  assert.match(r.json.next_steps[0], /gigstack signup claim <código> --team-id team_old/);
  assert.ok(!existsSync(join(f.dir, 'credentials.json')));
});

test('signup 404 says the feature is off and nothing was created', async t => {
  const f = await fixture(t);
  const r = await f.run(signupArgs);
  assert.equal(r.code, 1);
  assert.equal(r.json.error.status, 404);
  assert.match(r.json.error.message, /no está habilitado/);
  assert.match(r.json.error.message, /No se creó nada/);
});

test('signup maps email_already_exists, email_not_allowed and rate limits to clear errors', async t => {
  const cases = [
    ['email_already_exists', 409, 'Email already registered', /ya tiene una cuenta de gigstack/],
    ['email_not_allowed', 400, 'Use a permanent email address the person reads; disposable inboxes are not accepted', /permanent email/],
    ['rate_limit_exceeded', 429, 'Too many sandbox requests. Retry in 1200 seconds.', /No se creó nada/],
  ];
  for (const [code, status, message, expected] of cases) {
    const f = await fixture(t, { 'POST /v2/auth/sandbox': () => [status, { success: false, error: { code, message } }] });
    const r = await f.run(signupArgs);
    assert.equal(r.code, 1, code);
    assert.equal(r.json.error.code, code);
    assert.equal(r.json.error.status, status);
    assert.match(r.json.error.message, expected);
    assert.equal(r.json.error.retry_command, undefined, code);
    assert.ok(!existsSync(join(f.dir, 'credentials.json')));
  }
});

test('signup with an unknown outcome prints the Idempotency-Key and a retry reuses it', async t => {
  let calls = 0;
  const f = await fixture(t, { 'POST /v2/auth/sandbox': () => (++calls === 1 ? 'drop' : created()) });
  const r = await f.run(signupArgs);
  assert.equal(r.code, 1);
  assert.equal(r.json.error.outcome, 'unknown');
  const sent = f.requests[0].headers['idempotency-key'];
  assert.equal(r.json.error.idempotency_key, sent);
  assert.match(r.json.error.retry_command, new RegExp(`--idempotency-key ${sent}$`));
  const retry = await f.run([...signupArgs, '--idempotency-key', sent]);
  assert.equal(retry.code, 0, retry.stdout);
  assert.equal(f.requests[1].headers['idempotency-key'], sent);
  assert.equal(retry.json.status, 'created');
});

test('signup server-side unknown outcomes (sandbox_outcome_unknown, 5xx) also carry the retry key', async t => {
  for (const [status, code] of [[409, 'sandbox_outcome_unknown'], [503, 'sandbox_state_unavailable'], [500, 'internal_error']]) {
    const f = await fixture(t, { 'POST /v2/auth/sandbox': () => [status, { success: false, error: { code, message: 'Retry the same request later' } }] });
    const r = await f.run(signupArgs);
    assert.equal(r.code, 1);
    assert.equal(r.json.error.code, code);
    assert.equal(r.json.error.idempotency_key, f.requests[0].headers['idempotency-key']);
    assert.match(r.json.error.retry_command, /--idempotency-key /);
  }
});

test('signup refuses without flags when not interactive, and never overwrites a non-sandbox profile', async t => {
  const f = await fixture(t, { 'POST /v2/auth/sandbox': created });
  const missing = await f.run(['signup', '--email', 'ana@example.com']);
  assert.equal(missing.code, 1);
  assert.equal(missing.json.error.code, 'missing_argument');
  assert.match(missing.json.error.message, /--name/);
  await f.profile({ sandbox: { apiKey: 'sk_live_real_key', environment: 'production', baseUrl: f.base } });
  const clash = await f.run(signupArgs);
  assert.equal(clash.code, 1);
  assert.equal(clash.json.error.code, 'profile_exists');
  assert.equal(f.requests.length, 0);
  assert.equal((await f.credentials()).profiles.sandbox.apiKey, 'sk_live_real_key');
});

test('a second sandbox never overwrites the first sandbox profile', async t => {
  const f = await fixture(t, { 'POST /v2/auth/sandbox': created });
  await f.profile({ sandbox: { apiKey: 'sk_test_first', environment: 'test', baseUrl: f.base, teamId: 'team_first', sandbox: { claimed: false } } });
  const r = await f.run(signupArgs);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.profile, 'sandbox-2');
  const creds = await f.credentials();
  assert.equal(creds.profiles.sandbox.apiKey, 'sk_test_first');
  assert.equal(creds.profiles['sandbox-2'].apiKey, KEY);
  assert.equal(creds.activeProfile, 'sandbox-2');
});

test('signup claim posts {team_id, code} without credentials and marks the profile claimed', async t => {
  const f = await fixture(t, {
    'POST /v2/auth/sandbox/claim': () => [200, { success: true, data: { claimed: true, team_id: 'team_sbx1', password_email: 'sent', next: 'Check your email to set your password, then go live from the app' } }],
  });
  await f.profile({ sandbox: { apiKey: KEY, environment: 'test', baseUrl: f.base, teamId: 'team_sbx1', sandbox: { claimed: false, claimExpiresAt: EXPIRES } } });
  const r = await f.run(['signup', 'claim', ' 123456 '], { baseUrl: false });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].path, '/v2/auth/sandbox/claim');
  assert.equal(f.requests[0].headers.authorization, undefined);
  assert.deepEqual(f.requests[0].body, { team_id: 'team_sbx1', code: '123456' });
  assert.equal(r.json.claimed, true);
  assert.match(r.json.next_steps[1], /app\.gigstack\.pro\/home/);
  const creds = await f.credentials();
  assert.equal(creds.profiles.sandbox.sandbox.claimed, true);
  assert.equal(creds.profiles.sandbox.apiKey, KEY);
});

test('signup claim validates the code locally and explains invalid_or_expired_code', async t => {
  const f = await fixture(t, {
    'POST /v2/auth/sandbox/claim': () => [400, { success: false, error: { code: 'invalid_or_expired_code', message: 'The code is not valid for this sandbox or has expired' } }],
  });
  const bad = await f.run(['signup', 'claim', '12ab', '--team-id', 'team_x']);
  assert.equal(bad.code, 1);
  assert.equal(bad.json.error.code, 'invalid_code_format');
  assert.equal(f.requests.length, 0);
  const none = await f.run(['signup', 'claim', '123456']);
  assert.equal(none.json.error.code, 'team_id_required');
  assert.equal(f.requests.length, 0);
  const wrong = await f.run(['signup', 'claim', '654321', '--team-id', 'team_x']);
  assert.equal(wrong.code, 1);
  assert.equal(wrong.json.error.code, 'invalid_or_expired_code');
  assert.match(wrong.json.error.message, /no es válido, ya se usó o expiró/);
  assert.deepEqual(f.requests[0].body, { team_id: 'team_x', code: '654321' });
});

const pricing = () => [200, { success: true, data: {
  country: 'MEX', currency: 'MXN', taxes_included: false,
  features: { taxpayer: { label: 'Contribuyente activo', monthly_price: 249 } },
  signup_credits: { credits: 15, value: 15, expires_in_days: 30 },
} }];
const stamped = (req, body) => [200, { message: 'Invoice created', data: {
  uuid: 'AAAA1111-2222-3333-4444-555566667777', series: 'I', folio_number: 1, status: 'valid', livemode: false,
  currency: 'MXN', subtotal: 100, taxes: 16, total: 116, global: body.global,
} }];
const demoRoutes = {
  'GET /v2/teams/team_sbx1': () => [200, { data: { id: 'team_sbx1', address: { zip: '42501' }, sat: { completed: true } } }],
  'POST /v2/invoices/income': stamped,
  'GET /v2/pricing': pricing,
};

function assertDemoBody(body) {
  assert.equal(body.automation_type, 'none');
  assert.deepEqual(body.client, {
    search: { on_key: 'tax_id', on_value: 'XAXX010101000', auto_create: true, safety_check: false },
    legal_name: 'PUBLICO EN GENERAL', tax_id: 'XAXX010101000', tax_system: '616', use: 'S01',
    address: { zip: '42501', country: 'MEX' },
  });
  assert.equal(body.items.length, 1);
  assert.deepEqual(body.items[0], {
    search: { on_key: 'sku', on_value: 'GIGSTACK-DEMO', auto_create: true, safety_check: false },
    sku: 'GIGSTACK-DEMO', description: 'Venta', quantity: 1, unit_price: 100,
    product_key: '01010101', unit_key: 'ACT', unit_name: 'Actividad',
    taxes: [{ type: 'IVA', rate: 0.16, factor: 'Tasa', withholding: false }],
  });
  assert.equal(body.global.periodicity, '04');
  assert.match(body.global.months, /^(0[1-9]|1[0-2])$/);
  assert.equal(typeof body.global.year, 'number');
  assert.equal(body.use, 'S01');
  assert.equal(body.payment_form, '01');
  assert.equal(body.payment_method, 'PUE');
  assert.equal(body.currency, 'MXN');
  assert.equal(body.send_email, false);
  assert.equal(body.livemode, undefined);
}

test('demo refuses a live credential before any request', async t => {
  const f = await fixture(t, demoRoutes);
  await f.profile({ prod: { apiKey: 'sk_live_real_key', environment: 'production', baseUrl: f.base, teamId: 'team_sbx1' } });
  for (const args of [['demo'], ['invoices', 'create', '--demo'], ['demo', '--profile', 'prod']]) {
    const r = await f.run(args);
    assert.equal(r.code, 1, args.join(' '));
    assert.equal(r.json.error.code, 'live_key_refused');
  }
  const envKey = await f.run(['demo'], { env: { GIGSTACK_API_KEY: 'sk_live_env_key' } });
  assert.equal(envKey.json.error.code, 'live_key_refused');
  assert.equal(f.requests.length, 0);
});

test('demo issues a test global invoice to PUBLICO EN GENERAL and steers to go-live with live pricing', async t => {
  const f = await fixture(t, demoRoutes);
  await f.profile({ sandbox: { apiKey: KEY, environment: 'test', baseUrl: f.base, teamId: 'team_sbx1', sandbox: { claimed: false } } });
  const r = await f.run(['demo'], { baseUrl: false });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const post = f.requests.find(q => q.method === 'POST');
  assert.equal(post.path, '/v2/invoices/income');
  assert.equal(post.headers.authorization, `Bearer ${KEY}`);
  assertDemoBody(post.body);
  assert.ok(f.requests.find(q => q.path === '/v2/pricing').headers.authorization === undefined);
  assert.equal(r.json.invoice.uuid, 'AAAA1111-2222-3333-4444-555566667777');
  assert.equal(r.json.invoice.total, 116);
  assert.equal(r.json.invoice.livemode, false);
  assert.equal(r.json.files.pdf, `${f.base}/invoices/AAAA1111-2222-3333-4444-555566667777/files?file_type=pdf`);
  assert.equal(r.json.files.xml, `${f.base}/invoices/AAAA1111-2222-3333-4444-555566667777/files?file_type=xml`);
  assert.equal(r.json.pricing.source, 'live');
  const msg = r.json.next_steps;
  assert.match(msg, /factura de prueba \(sin validez fiscal\)/);
  assert.match(msg, /https:\/\/app\.gigstack\.pro\/home/);
  assert.match(msg, /\$249 MXN \+ IVA al mes por RFC, más uso/);
  assert.match(msg, /15 créditos de bienvenida \(1 crédito = 1 MXN de uso\) al activar producción/);
  assert.match(msg, /https:\/\/gigstack\.pro\/precios/);
  assert.doesNotMatch(msg, /facturas? gratis|facturas de bienvenida/i);
});

test('invoices create --demo sends the same body and falls back to the pricing snapshot', async t => {
  const f = await fixture(t, { ...demoRoutes, 'GET /v2/pricing': () => [503, { error: 'down' }] });
  await f.profile({ sandbox: { apiKey: KEY, environment: 'test', baseUrl: f.base, teamId: 'team_sbx1' } });
  const r = await f.run(['invoices', 'create', '--demo'], { baseUrl: false, json: false });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assertDemoBody(f.requests.find(q => q.method === 'POST').body);
  assert.match(r.stdout, /AAAA1111-2222-3333-4444-555566667777/);
  assert.match(r.stdout, /\$116\.00 MXN/);
  assert.match(r.stdout, /desde \$199 MXN \+ IVA al mes por RFC, más uso; 11 créditos de bienvenida \(1 crédito = 1 MXN de uso\) al activar producción/);
  const mixed = await f.run(['invoices', 'create', '--demo', '--client', 'client_1']);
  assert.equal(mixed.code, 1);
  assert.match(mixed.json.error.message, /--demo no se combina/);
});

test('invoices download writes base64 files returned by the API', async t => {
  const uuid = 'AAAA1111-2222-3333-4444-555566667777';
  const f = await fixture(t, {
    [`GET /v2/invoices/${uuid}/files`]: () => [200, { data: [
      { content: Buffer.from('%PDF-1.4 demo').toString('base64'), filename: `${uuid}.pdf`, type: 'application/pdf' },
      { content: Buffer.from('<cfdi/>').toString('base64'), filename: `${uuid}.xml`, type: 'application/xml' },
    ] }],
  });
  await f.profile({ sandbox: { apiKey: KEY, environment: 'test', baseUrl: f.base } });
  const out = await mkdtemp(join(tmpdir(), 'gigstack-dl-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const r = await f.run(['invoices', 'download', uuid, '--out', out], { baseUrl: false });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual((await readdir(out)).sort(), [`${uuid}.pdf`, `${uuid}.xml`]);
  assert.equal(await readFile(join(out, `${uuid}.xml`), 'utf8'), '<cfdi/>');
});

test('signup claim --profile uses that profile team and API origin even when it is not active', async t => {
  const f = await fixture(t, {
    'POST /v2/auth/sandbox/claim': () => [200, { success: true, data: { claimed: true, team_id: 'team_two', password_email: 'failed' } }],
  });
  await f.profile({
    main: { apiKey: 'sk_live_real', environment: 'production' },
    two: { apiKey: KEY, environment: 'test', baseUrl: f.base, teamId: 'team_two', sandbox: { claimed: false } },
  }, 'main');
  const r = await f.run(['signup', 'claim', '111222', '--profile', 'two'], { baseUrl: false });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(f.requests[0].body, { team_id: 'team_two', code: '111222' });
  assert.match(r.json.next_steps[0], /olvidé mi contraseña/);
  const creds = await f.credentials();
  assert.equal(creds.activeProfile, 'main');
  assert.equal(creds.profiles.two.sandbox.claimed, true);
});
