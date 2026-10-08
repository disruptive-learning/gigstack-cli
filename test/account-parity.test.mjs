import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
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
    [['teams','onboarding-url','team_b','--yes'],'GET','/v2/teams/team_b/onboarding-url',undefined],
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

test('users and webhook administration target documented methods, scoped by global team', async t => {
  const f = await fixture(t);
  const cases = [
    [['users','list'],'GET','/v2/users',undefined],
    [['users','get','user_a'],'GET','/v2/users/user_a',undefined],
    [['users','create','--data','{"email":"person@example.invalid","auto_join":false,"role":"viewer"}'],'POST','/v2/users',{email:'person@example.invalid',auto_join:false,role:'viewer'}],
    [['users','update','user_a','--data','{"first_name":"Fixture"}'],'PUT','/v2/users/user_a',{first_name:'Fixture'}],
    [['users','reset-password','user_a'],'POST','/v2/users/reset-password/user_a',{}],
    [['users','login-link','user_a','--yes'],'POST','/v2/users/login-link',{user_id:'user_a'}],
    [['users','delete','user_a','--yes'],'DELETE','/v2/users/user_a',undefined],
    [['webhooks','get','webhook_a'],'GET','/v2/webhooks/webhook_a',undefined],
    [['webhooks','update','webhook_a','--data','{"status":"inactive","description":null}'],'PUT','/v2/webhooks/webhook_a',{status:'inactive',description:null}],
  ];
  for (const [args,method,path,body] of cases) {
    const r=await f.run(['--team','team_b',...args,'--json']);assert.equal(r.code,0,r.stdout);json(r);
    const req=f.requests.at(-1);const url=new URL(req.url,f.base);assert.equal(req.method,method);assert.equal(url.pathname,path);assert.equal(url.searchParams.get('team'),'team_b');assert.deepEqual(req.body?JSON.parse(req.body):undefined,body);
  }
});

test('SAT register, download requests, sync, previews and jobs preserve distinct contracts', async t => {
  const f=await fixture(t);
  const cases=[
    [['register','--data','{"phone":"+520000000000","sync_start_date":"2026-01-01"}'],'POST','/register',{phone:'+520000000000',sync_start_date:'2026-01-01'}],
    [['request','--data','{"start_date":"2026-01-01","end_date":"2026-01-31","request_type":"metadata","rfc_type":"received"}','--yes'],'POST','/request',{start_date:'2026-01-01',end_date:'2026-01-31',request_type:'metadata',rfc_type:'received'}],
    [['request-status','req_a'],'GET','/status/req_a',undefined],
    [['package','pack_a'],'GET','/package/pack_a',undefined],
    [['fetch-xml','uuid_a','--yes'],'GET','/invoice/uuid_a',undefined],
    [['sync','debug'],'GET','/debug',undefined],
    [['sync','progress'],'GET','/progress',undefined],
    [['sync','enable','--yes'],'POST','/enable-sync',{}],
    [['sync','extend-to-maximum','--yes'],'PUT','/sync-period',{}],
    [['preview','--data','{"start_date":"2026-01-01","end_date":"2026-01-31","directions":["received"]}'],'POST','/preview',{start_date:'2026-01-01',end_date:'2026-01-31',directions:['received']}],
    [['import','--data','{"uuids":["uuid_a"],"confirm_cost_mxn":0.2}','--yes'],'POST','/import',{uuids:['uuid_a'],confirm_cost_mxn:0.2}],
    [['jobs','list'],'GET','/jobs',undefined],
    [['jobs','get','job_a'],'GET','/jobs/job_a',undefined],
    [['jobs','cancel','job_a','--yes'],'POST','/jobs/job_a/cancel',{}],
  ];
  for(const [args,method,path,body] of cases){
    const r=await f.run(['invoices','sat',...args,'--team','team_b','--json']);assert.equal(r.code,0,r.stdout);json(r);
    const req=f.requests.at(-1);const url=new URL(req.url,f.base);assert.equal(req.method,method);assert.equal(url.pathname,'/v2/invoices/download'+path);assert.equal(url.searchParams.get('team'),'team_b');assert.deepEqual(req.body?JSON.parse(req.body):undefined,body);
  }
});

test('sensitive account/fiscal operations require explicit confirmation and import cost',async t=>{
  const f=await fixture(t);
  for(const args of [
    ['users','login-link','user_a'],['users','delete','user_a'],['teams','onboarding-url','team_b'],
    ['invoices','sat','fetch-xml','uuid_a'],['invoices','sat','sync','enable'],['invoices','sat','jobs','cancel','job_a'],
    ['invoices','sat','import','--data','{"uuids":["uuid_a"]}','--yes'],
    ['invoices','sat','import','--data','{"uuids":["uuid_a"],"confirm_cost_mxn":0.2}'],
    ['users','create','--data','{"email":"person@example.invalid","role":"owner"}'],
  ]){const r=await f.run([...args,'--json']);assert.equal(r.code,1,r.stdout);assert.ok(json(r).error);}
  assert.equal(f.requests.length,0);
});

test('FIEL and PFX use secure file inputs and correct password field names',async t=>{
  const f=await fixture(t);const dir=await mkdtemp(join(tmpdir(),'gigstack-cli-fiel-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await Promise.all([writeFile(join(dir,'cert'),'fake-certificate'),writeFile(join(dir,'key'),'fake-private-key'),writeFile(join(dir,'password'),' secret with spaces \n'),writeFile(join(dir,'pfx'),'fake-pfx')]);
  let r=await f.run(['invoices','sat','credentials','fiel','--cert-file',join(dir,'cert'),'--key-file',join(dir,'key'),'--password-file',join(dir,'password'),'--phone','+520000000000','--json']);assert.equal(r.code,0,r.stdout);json(r);
  let req=f.requests.at(-1);assert.equal(req.url,'/v2/invoices/download/fiel');assert.match(req.body,/name="password"/);assert.ok(!req.body.includes('name="keyPass"'));assert.match(req.body,/ secret with spaces /);assert.ok(!r.stdout.includes('fake-private-key'));
  r=await f.run(['invoices','sat','credentials','pfx','--pfx-file',join(dir,'pfx'),'--password-file',join(dir,'password'),'--json']);assert.equal(r.code,0,r.stdout);json(r);
  req=f.requests.at(-1);assert.equal(req.url,'/v2/invoices/download/pfx');assert.deepEqual(JSON.parse(req.body),{pfx:Buffer.from('fake-pfx').toString('base64'),pfx_password:' secret with spaces '});assert.ok(!r.stdout.includes('secret with spaces'));
});

test('cost mismatch exposes a bounded estimate for reconfirmation without retry',async t=>{
  const f=await fixture(t,()=>({status:409,success:false,error:'cost_mismatch',message:'Costo cambió',data:{estimated_cost_mxn:0.4,importable:2,private_debug:'never expose this'}}));
  const r=await f.run(['invoices','sat','import','--data','{"uuids":["a","b"],"confirm_cost_mxn":0.2}','--yes','--json']);assert.equal(r.code,1);const out=json(r);assert.equal(out.error.code,'cost_mismatch');assert.deepEqual(out.error.details,{estimated_cost_mxn:0.4,importable:2});assert.ok(!r.stdout.includes('private_debug'));assert.equal(f.requests.length,1);
});

test('billed GET timeout has unknown outcome and semantic failures return nonzero',async t=>{
  const f=await fixture(t,req=>req.url.includes('/invoice/')?{delay:150,data:{}}:{success:false,error:'operation_failed',message:'Failed'});
  let r=await f.run(['invoices','sat','fetch-xml','uuid_a','--yes','--json'],{env:{GIGSTACK_API_TIMEOUT_MS:'70'}});assert.equal(r.code,1);assert.equal(json(r).error.outcome,'unknown');
  r=await f.run(['users','get','user_a','--json']);assert.equal(r.code,1);assert.equal(json(r).error.code,'operation_failed');
});

test('automation commands map every customer route and preserve team, mode selectors and optimistic locks', async t => {
  const f = await fixture(t, () => ({ success: true, data: { id: 'fixture', results: [] }, has_more: true, next: 'cursor' }));
  const graph = { nodes: [{ id: 'n1', type: 'trigger.payment_succeeded', position: { x: 0, y: 0 }, data: { config: { enabled: false } } }], edges: [], viewport: null };
  const body = { name: 'Fixture flow', graph, replacesDefaults: false };
  const groupEdit = { expectedLastUpdated: 1720000000000, journeys: [] };
  const cases = [
    [['journeys','list','--status','draft','--trigger-type','trigger.payment_succeeded','--next','cursor'], 'GET','/v2/journeys',undefined],
    [['journeys','catalog'], 'GET','/v2/journeys/catalog',undefined],
    [['journeys','get','j1'], 'GET','/v2/journeys/j1',undefined],
    [['journeys','runs','j1'], 'GET','/v2/journeys/j1/runs',undefined],
    [['journeys','create','--stdin'], 'POST','/v2/journeys',body],
    [['journeys','update','j1','--stdin'], 'PUT','/v2/journeys/j1',body],
    [['journeys','delete','j1','--yes'], 'DELETE','/v2/journeys/j1',undefined],
    [['journeys','publish','j1','--yes'], 'POST','/v2/journeys/j1/publish',{}],
    [['journeys','pause','j1','--yes'], 'POST','/v2/journeys/j1/pause',{}],
    [['journeys','clone','j1','--stdin'], 'POST','/v2/journeys/j1/clone',{ targetLivemode: true, name: 'Copy' }],
    [['journeys','test','j1','--stdin'], 'POST','/v2/journeys/j1/test',{ source_collection: 'payments', source_snapshot: { amount: 0 } }],
    [['journey-groups','list','--created-from','ai'], 'GET','/v2/journey-groups',undefined],
    [['journey-groups','get','g1'], 'GET','/v2/journey-groups/g1',undefined],
    [['journey-groups','create','--stdin'], 'POST','/v2/journey-groups',{ name: 'Group', journeys: [{ name: 'Flow', graph }] }],
    [['journey-groups','update','g1','--stdin','--yes'], 'PUT','/v2/journey-groups/g1',groupEdit],
    [['journey-groups','revert','g1','--stdin','--yes'], 'POST','/v2/journey-groups/g1/revert',{ expectedLastUpdated: 1720000000000 }],
    [['journey-groups','clone','g1'], 'POST','/v2/journey-groups/g1/clone',{}],
    [['journey-groups','publish','g1','--yes'], 'POST','/v2/journey-groups/g1/publish',{}],
    [['journey-groups','pause','g1','--yes'], 'POST','/v2/journey-groups/g1/pause',{}],
    [['sheets','status'], 'GET','/v2/sheets',undefined],
    [['sheets','fields','payment'], 'GET','/v2/sheets/fields',undefined],
    [['sheets','headers'], 'GET','/v2/sheets/headers',undefined],
    [['sheets','rows','--status','error,review'], 'GET','/v2/sheets/rows',undefined],
    [['sheets','connect','--stdin','--yes'], 'POST','/v2/sheets/connect',{ url: 'https://docs.google.com/spreadsheets/d/fixture/edit', copy_from_other: true }],
    [['sheets','mapping','--stdin'], 'PUT','/v2/sheets/mapping',{ target: 'payment', fields: { currency: { value: 'MXN' } }, poll_interval_minutes: 2 }],
    [['sheets','preview'], 'POST','/v2/sheets/preview',{}],
    ...['enable','pause','sync'].map(action => [['sheets',action,'--yes'],'POST',`/v2/sheets/${action}`,{}]),
    [['sheets','disconnect','--yes'], 'DELETE','/v2/sheets',{}],
  ];
  for (const [args,method,path,payload] of cases) {
    const r = await f.run([...args,'--team','team_fixture','--json'], { input: payload === undefined ? '' : JSON.stringify(payload) });
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.stderr}`);
    assert.equal(json(r).success, true);
    const req = f.requests.at(-1), url = new URL(req.url,f.base);
    assert.equal(req.method, method); assert.equal(url.pathname,path); assert.equal(url.searchParams.get('team'),'team_fixture');
    if (payload !== undefined) assert.deepEqual(JSON.parse(req.body), payload);
    if (args[0] === 'journeys' && args[1] === 'list') {
      assert.equal(url.searchParams.get('triggerType'),'trigger.payment_succeeded');
      assert.equal(url.searchParams.get('next'),'cursor'); assert.equal(json(r).next,'cursor');
    }
  }
  assert.equal(f.requests.length, 30);
});

test('automation activation, group replacement and deletion require explicit noninteractive confirmation', async t => {
  const f = await fixture(t);
  for (const args of [ ['journeys','publish','j1'], ['journeys','delete','j1'], ['journey-groups','update','g1','--data','{"journeys":[],"expectedLastUpdated":1}'], ['journey-groups','revert','g1','--data','{"expectedLastUpdated":1}'], ['sheets','connect','--data','{"url":"https://example.test"}'], ['sheets','enable'], ['sheets','sync'], ['sheets','disconnect'] ]) {
    const r = await f.run([...args,'--json']); assert.equal(r.code,1); assert.ok(json(r).error);
  }
  assert.equal(f.requests.length,0);
});

test('partial group failures exit nonzero with every per-flow result; stale revisions never retry', async t => {
  const results = [{ journeyId: 'j1', status: 'published' }, { journeyId: 'j2', status: 'failed', errors: ['Invalid graph'] }];
  const f = await fixture(t, req => req.url.includes('/publish') ? { success: true, data: { results } } : { status: 409, success: false, error: { code: 'group_changed', message: 'Reload before editing' } });
  const partial = await f.run(['journey-groups','publish','g1','--yes','--json']);
  assert.equal(partial.code,1); assert.equal(json(partial).error.code,'partial_failure'); assert.deepEqual(json(partial).data.results,results);
  const stale = await f.run(['journey-groups','revert','g1','--data','{"expectedLastUpdated":1}','--yes','--json']);
  assert.equal(stale.code,1); assert.equal(json(stale).error.code,'group_changed'); assert.equal(f.requests.length,2);
});

test('self commands preserve profile nulls, recipient IDs, preferences and cursor envelopes', async t => {
  const f = await fixture(t, () => ({ success: true, data: [], has_more: true, next_cursor: 'next_fixture' }));
  const cases = [
    [['me','get'],'GET','/v2/users/me',undefined],
    [['me','update','--stdin'],'PATCH','/v2/users/me',{ first_name: null, company_role: 'Owner' }],
    [['me','preferences','get','team_b'],'GET','/v2/users/me/preferences/team_b',undefined],
    [['me','preferences','update','team_b','--stdin'],'PATCH','/v2/users/me/preferences/team_b',{ testmode: false, search_collection: null }],
    [['me','active-context','--stdin'],'POST','/v2/users/me/active-context',{ team_id: 'team_b' }],
    [['me','notifications','list','--cursor','old_cursor'],'GET','/v2/users/me/notifications',undefined],
    [['me','notifications','unread-count'],'GET','/v2/users/me/notifications/unread-count',undefined],
    [['me','notifications','read','recipient_1'],'POST','/v2/users/me/notifications/recipient_1/read',{}],
    [['me','notifications','dismiss','recipient_1'],'DELETE','/v2/users/me/notifications/recipient_1',undefined],
    [['me','notifications','read-all','--yes'],'POST','/v2/users/me/notifications/read-all',{}],
    [['me','mcp-tokens','list'],'GET','/v2/users/me/mcp-tokens',undefined],
    [['me','mcp-tokens','revoke','mcp_1','--yes'],'DELETE','/v2/users/me/mcp-tokens/mcp_1',undefined],
  ];
  for (const [args,method,path,body] of cases) {
    const r = await f.run([...args,'--json'], { input: body ? JSON.stringify(body) : '' });
    assert.equal(r.code,0,r.stderr); assert.equal(json(r).next_cursor,'next_fixture');
    assert.equal(f.requests.at(-1).method,method); assert.equal(new URL(f.requests.at(-1).url,f.base).pathname,path);
    if (body) assert.deepEqual(JSON.parse(f.requests.at(-1).body),body);
  }
});

test('API and MCP credential issuance saves secrets once to new private files without stdout disclosure', async t => {
  const f = await fixture(t, req => req.url.includes('/users/me/mcp-tokens') ? { success:true, data: { token: { keyid:'mcp_fixture' }, apikey:'synthetic-mcp-secret', mcp_url:'https://fixture.test/mcp?token=synthetic-mcp-secret' } } : { success:true, data: { live:{ key:{keyid:'live_fixture'},apikey:'synthetic-live-secret' },test:{key:{keyid:'test_fixture'},apikey:'synthetic-test-secret'},revoked_count:2 } });
  const dir = await mkdtemp(join(tmpdir(),'gigstack-secrets-')); t.after(() => rm(dir,{recursive:true,force:true}));
  for (const action of ['create','rotate']) {
    const target = join(dir,`${action}.json`);
    const r = await f.run(['api-keys',action,'--out',target,'--yes','--json']);
    assert.equal(r.code,0,r.stderr); assert.equal(json(r).data.credentials_file,target);
    assert.doesNotMatch(r.stdout + r.stderr,/synthetic-(live|test)-secret/);
    assert.equal((await stat(target)).mode & 0o777,0o600);
    assert.equal(JSON.parse(await readFile(target,'utf8')).data.live.apikey,'synthetic-live-secret');
    const count = f.requests.length;
    const duplicate = await f.run(['api-keys',action,'--out',target,'--yes','--json']);
    assert.equal(duplicate.code,1); assert.equal(f.requests.length,count);
  }
  const path = join(dir,'mcp.json');
  const args = ['me','mcp-tokens','create','--data','{"name":"Fixture","team_id":"team_b","livemode":false}','--out',path,'--yes','--json'];
  const before = f.requests.length;
  const missingConsent = await f.run(args); assert.equal(missingConsent.code,1); assert.equal(f.requests.length,before);
  const accepted = await f.run([...args,'--accept-terms']); assert.equal(accepted.code,0,accepted.stderr);
  assert.equal(JSON.parse(f.requests.at(-1).body).terms_accepted,true);
  assert.doesNotMatch(accepted.stdout + accepted.stderr,/synthetic-mcp-secret|mcp_url/);
  assert.equal(JSON.parse(await readFile(path,'utf8')).data.apikey,'synthetic-mcp-secret');
});

test('credential revocation is explicit and webhook cursors are not lost', async t => {
  const f = await fixture(t, () => ({ success:true,data:[],has_more:true,next_cursor:'webhook_next' }));
  for (const args of [['api-keys','revoke','sk_test_fixture'],['api-keys','emergency-revoke'],['me','mcp-tokens','revoke','mcp_fixture']]) {
    const refused = await f.run([...args,'--json']); assert.equal(refused.code,1);
  }
  assert.equal(f.requests.length,0);
  for (const [args,path,method] of [ [['api-keys','list','--cursor','opaque','--include-revoked'],'/v2/api-keys','GET'],[['api-keys','revoke','sk_test_fixture','--yes'],'/v2/api-keys/sk_test_fixture','DELETE'],[['api-keys','emergency-revoke','--yes'],'/v2/api-keys/emergency-revoke','POST'],[['webhooks','list','--cursor','opaque','--status','active'],'/v2/webhooks','GET'] ]) {
    const r=await f.run([...args,'--team','team_b','--json']); assert.equal(r.code,0,r.stderr); assert.equal(json(r).next_cursor,'webhook_next');
    const req=f.requests.at(-1),url=new URL(req.url,f.base); assert.equal(url.pathname,path);assert.equal(req.method,method);assert.equal(url.searchParams.get('team'),'team_b');
    if(method==='GET') assert.equal(url.searchParams.get('cursor'),'opaque');
  }
});
