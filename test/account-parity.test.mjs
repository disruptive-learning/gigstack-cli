import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.mjs', import.meta.url).pathname;
async function fixture(t, responder = () => ({ data: { id: 'team_b', settings: {} } })) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    const result = responder(requests.at(-1));
    if (result.delay) await new Promise(r => setTimeout(r, result.delay));
    res.writeHead(result.status ?? 200, result.headers ?? { 'content-type': 'application/json' });
    res.end(result.raw ?? JSON.stringify(result));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/v2`;
  function run(args, opts = {}) {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, GIGSTACK_API_KEY: 'synthetic-test-token', GIGSTACK_API_BASE_URL: base, GIGSTACK_TEAM: '', ...opts.env };
      const child = spawn(process.execPath, [cli, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
      child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
      child.stdin.end(opts.input ?? '');
    });
  }
  return { run, requests, base };
}
const json = result => { assert.ok(result.stdout.trim(), 'machine response present'); return JSON.parse(result.stdout); };

test('global --team reaches old commands regardless of position and whoami never selects another team', async t => {
  const f = await fixture(t);
  for (const args of [ ['--team','team_b','clients','get','client_1','--json'], ['clients','get','client_1','--team','team_b','--json'], ['whoami','--team','team_b','--json'] ]) {
    const r = await f.run(args); assert.equal(r.code, 0, r.stderr); json(r);
    assert.equal(new URL(f.requests.at(-1).url, f.base).searchParams.get('team'), 'team_b');
  }
  assert.equal(f.requests.at(-1).url, '/v2/teams/team_b?team=team_b');
});

test('explicit team failure is not retried against a fallback team; JSON errors exit nonzero', async t => {
  const f = await fixture(t, () => ({ status: 403, error: { message: 'Forbidden' } }));
  const r = await f.run(['whoami','--team','team_b','--json']);
  assert.equal(r.code, 1); assert.equal(json(r).error.status, 403); assert.equal(f.requests.length, 1);
});

test('settings preserve false/zero/null/empty arrays/strings and omitted fields; read uses settings route', async t => {
  const f = await fixture(t);
  const body = { default_description: '', taxes: [], emails: null, refunds: { automatic_refunds: false }, eom_ppd_threshold_days: 0 };
  const r = await f.run(['teams','settings','update','team_b','--stdin','--json'], { input: JSON.stringify(body) });
  assert.equal(r.code, 0, r.stderr); json(r);
  assert.equal(f.requests[0].method, 'PUT'); assert.equal(f.requests[0].url, '/v2/teams/team_b/settings');
  assert.deepEqual(JSON.parse(f.requests[0].body), body);
  assert.equal((await f.run(['teams','settings','get','team_b','--json'])).code, 0);
  assert.equal(f.requests[1].url, '/v2/teams/team_b/settings');
});

test('team/body conflicts, malformed input, unsafe IDs and missing confirmation send no requests', async t => {
  const f = await fixture(t);
  const cases = [
    ['teams','get','other','--team','team_b','--json'],
    ['teams','update','team_b','--team','team_b','--data','{"team":"other"}','--json'],
    ['teams','update','team_b','--data','[]','--json'],
    ['teams','update','team_b','--data','secret-bad-json','--json'],
    ['teams','get','../other','--json'],
    ['teams','delete','team_b','--json'],
    ['teams','members','remove','team_b','u1','--json'],
    ['teams','transfer-ownership','team_b','u1','--json'],
  ];
  for (const args of cases) { const r = await f.run(args); assert.equal(r.code, 1); assert.ok(json(r).error); assert.ok(!r.stdout.includes('secret-bad-json')); }
  assert.equal(f.requests.length, 0);
});

test('membership and invitations use explicit operations and preserve role/permission payload', async t => {
  const f = await fixture(t);
  const operations = [
    [['teams','members','list','team_b'], 'GET', '/v2/teams/team_b/members', undefined],
    [['teams','members','update','team_b','u1','--data','{"role":"blocked","permissions":{"invoices":"none"}}'], 'PATCH', '/v2/teams/team_b/members/u1', { role:'blocked', permissions:{invoices:'none'} }],
    [['teams','members','remove','team_b','u1','--yes'], 'DELETE', '/v2/teams/team_b/members/u1', undefined],
    [['teams','transfer-ownership','team_b','u1','--yes'], 'POST', '/v2/teams/team_b/transfer-ownership', {new_owner_id:'u1'}],
    [['teams','invitations','create','team_b','--email','person@example.invalid','--role','editor','--no-send-email'], 'POST', '/v2/teams/team_b/invitations', {email:'person@example.invalid',role:'editor',send_email:false}],
    [['teams','invitations','resend','team_b','i1'], 'POST', '/v2/teams/team_b/invitations/i1/resend', {}],
    [['teams','invitations','revoke','team_b','i1','--yes'], 'DELETE', '/v2/teams/team_b/invitations/i1', undefined],
    [['teams','invitations','accept','--stdin'], 'POST', '/v2/teams/invitations/accept', {token:'synthetic-invite-token'}],
  ];
  for (const [args, method, path, body] of operations) {
    const r = await f.run([...args,'--json'], {input:JSON.stringify(body)}); assert.equal(r.code, 0, r.stdout); json(r);
    const req = f.requests.at(-1); assert.equal(req.method, method); assert.equal(req.url, path); assert.deepEqual(req.body ? JSON.parse(req.body) : undefined, body);
    assert.ok(!r.stdout.includes('synthetic-invite-token'));
  }
});

test('old mutation success emits a single JSON value; old catch sets exit status', async t => {
  const f = await fixture(t, req => req.method === 'DELETE' ? { message:'deleted' } : { status:400, error:'invalid request' });
  const r = await f.run(['webhooks','delete','w1','--team','team_b','--json']);
  assert.equal(r.code, 0); assert.equal(json(r).success, true);
  const bad = await f.run(['clients','get','bad','--json']); assert.equal(bad.code,1); assert.equal(json(bad).error.message,'invalid request');
});

test('URL validation refuses credential-bearing/external HTTP URLs before requests; redirects do not forward credentials', async t => {
  const f = await fixture(t, () => ({ status:302, headers:{location:'http://127.0.0.1:1/leak'}, raw:'' }));
  for (const base of ['http://example.invalid/v2','https://secret:password@example.invalid/v2','https://example.invalid/v2?x=1']) {
    const r = await f.run(['teams','list','--json','--base-url',base]); assert.equal(r.code,1); assert.ok(json(r).error);
  }
  assert.equal(f.requests.length,0);
  const r = await f.run(['teams','list','--json']); assert.equal(r.code,1); json(r); assert.equal(f.requests.length,1);
});

test('non-JSON responses and command syntax failures remain structured', async t => {
  const f = await fixture(t, () => ({status:502,raw:'<html>upstream unavailable</html>'}));
  const r = await f.run(['teams','list','--json']); assert.equal(r.code,1); assert.equal(json(r).error.status,502);
  const bad = await f.run(['teams','get','--json']); assert.equal(bad.code,1); assert.ok(json(bad).error);
});

test('timeout reports unknown write outcome and never retries mutation', async t => {
  const f = await fixture(t, () => ({delay:150,data:{id:'team_b'}}));
  const r = await f.run(['teams','update','team_b','--data','{"brand":{"alias":"x"}}','--json'], {env:{GIGSTACK_API_TIMEOUT_MS:'70'}});
  assert.equal(r.code,1); assert.equal(json(r).error.outcome,'unknown'); assert.equal(f.requests.length,1);
});

test('CSD upload uses real multipart field names and does not print secret bytes', async t => {
  const f = await fixture(t); const dir = await mkdtemp(join(tmpdir(),'gigstack-cli-cert-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  await Promise.all([writeFile(join(dir,'cert'),'synthetic-cert'),writeFile(join(dir,'key'),'synthetic-key'),writeFile(join(dir,'password'),'synthetic-password\n')]);
  const r = await f.run(['teams','sat-connection','team_b','--cert-file',join(dir,'cert'),'--key-file',join(dir,'key'),'--password-file',join(dir,'password'),'--json']);
  assert.equal(r.code,0,r.stdout); json(r); const req=f.requests[0]; assert.match(req.headers['content-type'],/^multipart\/form-data; boundary=/); assert.match(req.body,/name="keyPass"/); assert.match(req.body,/synthetic-password/); assert.ok(!r.stdout.includes('synthetic-password'));
});

test('team lifecycle, series, onboarding and token commands preserve API methods and bodies', async t => {
  const f = await fixture(t);
  const cases = [
    [['teams','create','--data','{"brand":{"alias":"fixture"}}'], 'POST','/v2/teams',{brand:{alias:'fixture'}}],
    [['teams','update','team_b','--data','{"support_email":"support@example.invalid"}'],'PUT','/v2/teams/team_b',{support_email:'support@example.invalid'}],
    [['teams','series','list','team_b'],'GET','/v2/teams/team_b/series',undefined],
    [['teams','series','create','team_b','--data','{"series":"A","live":0,"test":0}'],'POST','/v2/teams/team_b/series',{series:'A',live:0,test:0}],
    [['teams','series','update','team_b','A','--data','{"live":5}'],'PUT','/v2/teams/team_b/series/A',{live:5}],
    [['teams','onboarding-url','team_b'],'GET','/v2/teams/team_b/onboarding-url',undefined],
    [['teams','portal-token','team_b','--expires-in','30m'],'POST','/v2/teams/team_b/portal-access-token',{expiresIn:'30m'}],
    [['teams','delete','team_b','--yes'],'DELETE','/v2/teams/team_b',undefined],
  ];
  for (const [args, method, path, body] of cases) {
    const r = await f.run([...args,'--json']); assert.equal(r.code,0,r.stdout); json(r);
    const req=f.requests.at(-1); assert.equal(req.method,method); assert.equal(req.url,path); assert.deepEqual(req.body ? JSON.parse(req.body) : undefined,body);
  }
});

test('schema discovery is offline and exposes nested nullable settings', async t => {
  const f = await fixture(t);
  const r=await f.run(['teams','settings','schema','--json']); assert.equal(r.code,0); const schema=json(r);
  assert.equal(schema.additionalProperties,false); assert.ok(schema.properties.emails); assert.ok(schema.properties.refunds);
  assert.equal(f.requests.length,0);
});

test('login persists staging URL per profile and whoami omits credential material', async t => {
  const f=await fixture(t); const dir=await mkdtemp(join(tmpdir(),'gigstack-cli-profile-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  let r=await f.run(['login','--profile','staging','--json'],{env:{GIGSTACK_CONFIG_DIR:dir}}); assert.equal(r.code,0,r.stdout); json(r);
  r=await f.run(['whoami','--json'],{env:{GIGSTACK_CONFIG_DIR:dir,GIGSTACK_API_KEY:'',GIGSTACK_API_BASE_URL:''}});
  // An empty URL is an invalid explicit setting; omitting it below uses the saved URL.
  assert.equal(r.code,1);
  const invoke=await new Promise((resolve,reject)=>{
    const env={...process.env,GIGSTACK_CONFIG_DIR:dir}; delete env.GIGSTACK_API_KEY; delete env.GIGSTACK_API_BASE_URL; delete env.GIGSTACK_TEAM;
    const child=spawn(process.execPath,[cli,'whoami','--json'],{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
  });
  assert.equal(invoke.code,0,invoke.stdout); assert.equal(json(invoke).profile,'staging'); assert.ok(!invoke.stdout.includes('synthetic-test-token'));
  assert.equal(f.requests.length,2);
});
