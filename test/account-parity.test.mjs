import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, stat, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../dist/cli.mjs', import.meta.url).pathname;
async function fixture(t, responder = () => ({ data: { id: 'team_b', settings: {} } })) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    const result = responder(requests.at(-1));
    if (result.timeoutAfterHeaders) {
      res.writeHead(200, { 'content-type': 'application/json', 'x-gigstack-test-timeout': 'after-headers' });
      res.flushHeaders();
      return; // The subprocess timeout abort closes this deliberately stalled response.
    }
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
      const child = spawn(process.execPath, [...(opts.timeoutAfterHeaders ? ['--import', new URL('./fixtures/timeout-after-headers.mjs', import.meta.url).href] : []), cli, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
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
  const f = await fixture(t, req => req.method === 'DELETE' ? { data:{deleted:true} } : { status:400, error:'invalid request' });
  const r = await f.run(['webhooks','delete','w1','--team','team_b','--expected-revision','a'.repeat(64),'--yes','--json']);
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

test('team lifecycle, series and onboarding preserve API methods; raw portal issuance is retired', async t => {
  const f = await fixture(t);
  const cases = [
    [['teams','create','--data','{"brand":{"alias":"fixture"}}'], 'POST','/v2/teams',{brand:{alias:'fixture'}}],
    [['teams','update','team_b','--data','{"support_email":"support@example.invalid"}'],'PUT','/v2/teams/team_b',{support_email:'support@example.invalid'}],
    [['teams','series','list','team_b'],'GET','/v2/teams/team_b/series',undefined],
    [['teams','series','create','team_b','--data','{"series":"A","live":0,"test":0}'],'POST','/v2/teams/team_b/series',{series:'A',live:0,test:0}],
    [['teams','series','update','team_b','A','--data','{"live":5}'],'PUT','/v2/teams/team_b/series/A',{live:5}],
    [['teams','onboarding-url','team_b','--yes'],'GET','/v2/teams/team_b/onboarding-url',undefined],
    [['teams','delete','team_b','--yes'],'DELETE','/v2/teams/team_b',undefined],
  ];
  for (const [args, method, path, body] of cases) {
    const r = await f.run([...args,'--json']); assert.equal(r.code,0,r.stdout); json(r);
    const req=f.requests.at(-1); assert.equal(req.method,method); assert.equal(req.url,path); assert.deepEqual(req.body ? JSON.parse(req.body) : undefined,body);
  }
  const requestCount = f.requests.length;
  const retired = await f.run(['teams','portal-token','team_b','--json']);
  assert.notEqual(retired.code, 0); assert.match(retired.stdout, /portal-access invoices prepare/);
  assert.equal(f.requests.length, requestCount);

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
    [['users','delete','user_a','--yes'],'DELETE','/v2/users/user_a',undefined],
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

test('fiscal handoff routes preserve shared scope and uncertain state without secret arguments', async t => {
  const response = { data: { id: 'session_1', status: 'outcome_unknown', can_submit: false, effect_scope: 'team_shared', provider_environment: 'production', credential_livemode: false, upload_url: 'https://example.invalid/account/fiscal-upload/session_1?team=team_b', recovery_available_at: 123 } };
  const f = await fixture(t, () => response);
  const cases = [
    [['teams','fiscal','status','team_b'], 'GET', '/v2/teams/team_b/fiscal-status'],
    [['teams','fiscal','sessions','create','team_b','--purpose','manifest','--yes'], 'POST', '/v2/teams/team_b/fiscal-upload-sessions'],
    [['teams','fiscal','sessions','get','team_b','session_1'], 'GET', '/v2/teams/team_b/fiscal-upload-sessions/session_1'],
    [['teams','fiscal','sessions','cancel','team_b','session_1','--yes'], 'DELETE', '/v2/teams/team_b/fiscal-upload-sessions/session_1'],
    [['teams','fiscal','sessions','reconcile','team_b','session_1','--yes'], 'POST', '/v2/teams/team_b/fiscal-upload-sessions/session_1/reconcile'],
  ];
  for (const [args,method,path] of cases) {
    const r = await f.run([...args,'--json']); assert.equal(r.code,0,r.stderr); assert.deepEqual(json(r),response);
    assert.equal(f.requests.at(-1).method,method); assert.equal(f.requests.at(-1).url,path);
  }
  assert.deepEqual(JSON.parse(f.requests[1].body),{purpose:'manifest'});
  assert.deepEqual(JSON.parse(f.requests[4].body),{});
});

test('fiscal invalid purpose, context conflict, missing confirmation and browser-only actions never call API', async t => {
  const f = await fixture(t);
  const cases = [
    ['teams','fiscal','status','team_b','--team','other'],
    ['teams','fiscal','sessions','create','team_b','--purpose','csd'],
    ['teams','fiscal','sessions','create','team_b','--purpose','unknown','--yes'],
    ['teams','fiscal','sessions','create','team_b','--purpose','csd','--yes','--password','secret'],
    ['teams','fiscal','sessions','cancel','team_b','session_1'],
    ['teams','fiscal','sessions','reconcile','team_b','session_1'],
    ['teams','fiscal','sessions','submit','team_b','session_1','--yes'],
    ['teams','fiscal','sessions','resolve','team_b','session_1','--yes'],
  ];
  for (const args of cases) { const r=await f.run([...args,'--json']); assert.equal(r.code,1); assert.ok(json(r).error); }
  assert.equal(f.requests.length,0);
});

test('integration catalog and provider reads use finite canonical IDs and preserve backend availability', async t => {
  const response={data:{team_id:'team_b',provider:'stripe',available:false,reason:'region_unsupported',effect_scope:'team_shared'}};
  const f=await fixture(t,()=>response);
  const list=await f.run(['integrations','catalog','team_b','--json']);assert.equal(list.code,0);assert.deepEqual(json(list),response);
  assert.equal(f.requests[0].url,'/v2/teams/team_b/integrations/catalog');
  const get=await f.run(['integrations','get','team_b','woocommerce','--team','team_b','--json']);assert.equal(get.code,0);
  assert.equal(f.requests[1].url,'/v2/teams/team_b/integrations/woocommerce?team=team_b');
  assert.equal((await f.run(['integrations','get','team_b','woocomerce','--json'])).code,1);
  assert.equal(f.requests.length,2);
});

test('all thirteen integration settings commands send exact patch, retaining false/null and leading zero codes', async t => {
  const f=await fixture(t);
  const commands={
    stripe:{automatic_invoicing:false,automatic_refunds:true,convert_payments_to_currency:null,default_payment_method:'01'},
    adyen:{ppd_flow:false,convert_payments_to_currency:'MXN'}, paypal:{service_description:'',payment_form:null},
    conekta:{automatic_invoicing:false},openpay:{automatic_invoicing:true},clip:{automatic_invoicing:false},
    clockpms:{automatic_invoicing:false},pagoralia:{automatic_invoicing:true},dlocal:{automatic_invoicing:false},
    woocommerce:{automatic_invoicing:false},mercadopago:{automatic_invoicing:true},
    shopify:{automatic_invoicing:false,default_payment_form:'04'},bank:{voucher_required:false,country:'MEX',account_number:null,clabe:'012345678901234567'},
  };
  for(const [provider,body] of Object.entries(commands)){
    const r=await f.run(['integrations',provider,'settings','team_b','--stdin','--yes','--json'],{input:JSON.stringify(body)});
    assert.equal(r.code,0,r.stderr);json(r);
    assert.equal(f.requests.at(-1).url,`/v2/teams/team_b/integrations/${provider}/settings`);
    assert.equal(f.requests.at(-1).method,'PATCH');assert.deepEqual(JSON.parse(f.requests.at(-1).body),body);
  }
  assert.equal(f.requests.length,13);
});

test('integration settings schemas reject secrets, status fabrication, type coercion and unconfirmed writes offline', async t=>{
  const f=await fixture(t);
  for(const body of [{api_key:'secret'},{completed:true},{automatic_invoicing:'false'},{convert_payments_to_currency:'mxn'},{default_payment_method:4}]){
    const r=await f.run(['integrations','stripe','settings','team_b','--data',JSON.stringify(body),'--yes','--json']);assert.equal(r.code,1);assert.ok(json(r).error);
  }
  assert.equal((await f.run(['integrations','stripe','settings','team_b','--data','{"automatic_invoicing":true}','--json'])).code,1);
  assert.equal((await f.run(['integrations','bank','settings','team_b','--data','{"country":null}','--yes','--json'])).code,1);
  const schema=await f.run(['integrations','stripe','schema','--json']);assert.equal(schema.code,0);
  assert.equal(json(schema).additionalProperties,false);assert.deepEqual(json(schema).properties.convert_payments_to_currency.type,['string','null']);
  assert.equal(f.requests.length,0);
});

test('fourteen provider operations map methods/paths and retain queue/cursor/effect metadata', async t=>{
  const response={data:{provider:'netsuite',operation:'syncs',livemode:false,effect_scope:'team_shared_live_lookup',data:{enqueued:true,nextBefore:'123_sync1',truncated:true}}};
  const f=await fixture(t,()=>response);
  const rule={match:'Services',matchType:'contains',itemId:'00123',scope:'domestic'};
  const cases=[
    [['zettle','status','team_b'],'GET','/zettle/status'],
    [['zettle','settings','team_b','--data','{"automaticInvoicing":false,"cardPaymentForm":"28"}','--yes'],'PATCH','/zettle/connection-settings'],
    [['zettle','sync','team_b','--yes'],'POST','/zettle/sync'],
    [['zettle','disconnect','team_b','--yes'],'DELETE','/zettle/connection'],
    [['netsuite','status','team_b'],'GET','/netsuite/status'],
    [['netsuite','ping','team_b','--yes'],'POST','/netsuite/ping'],
    [['netsuite','disconnect','team_b','--yes'],'DELETE','/netsuite/connection'],
    [['netsuite','invoices','sync','team_b','invoice_1','--yes'],'POST','/netsuite/invoices/invoice_1/sync'],
    [['netsuite','invoices','resync','team_b','invoice_1','--yes'],'POST','/netsuite/invoices/invoice_1/resync'],
    [['netsuite','invoices','status','team_b','invoice_1'],'GET','/netsuite/invoices/invoice_1/sync'],
    [['netsuite','syncs','team_b','--before','123_sync1'],'GET','/netsuite/syncs?before=123_sync1'],
    [['netsuite','items','get','team_b'],'GET','/netsuite/items'],
    [['netsuite','items','preview','team_b','--data',JSON.stringify({rule,days:30}),'--yes'],'POST','/netsuite/items/preview'],
    [['netsuite','items','save-rule','team_b','--data',JSON.stringify({rule,previewToken:'version_1',confirmChanges:false}),'--yes'],'POST','/netsuite/items/rules'],
  ];
  for(const [args,method,path]of cases){const r=await f.run(['integrations',...args,'--json']);assert.equal(r.code,0,r.stderr);assert.deepEqual(json(r),response);assert.equal(f.requests.at(-1).method,method);assert.equal(f.requests.at(-1).url,'/v2/teams/team_b/integrations'+path);}
  assert.deepEqual(JSON.parse(f.requests[1].body),{automaticInvoicing:false,cardPaymentForm:'28'});
  assert.equal(JSON.parse(f.requests[13].body).confirmChanges,false,'--yes must not infer line-move consent');
  assert.equal(JSON.parse(f.requests[13].body).rule.itemId,'00123');
});

test('provider partial cleanup exits nonzero with truthful readback; disabled connection does not imply erased credentials',async t=>{
  const response={data:{provider:'zettle',operation:'disconnect',livemode:true,effect_scope:'connection_mode',data:{completed:false,remote_removed:false,partial_cleanup:true}}};
  const f=await fixture(t,()=>response);
  const r=await f.run(['integrations','zettle','disconnect','team_b','--yes','--json']);assert.equal(r.code,1);assert.equal(json(r).error.code,'partial_cleanup');assert.deepEqual(json(r).data,response.data);assert.equal(f.requests.length,1);
  const g=await fixture(t,()=>({data:{provider:'netsuite',operation:'disconnect',data:{ok:true,credentials_retained:true}}}));
  const success=await g.run(['integrations','netsuite','disconnect','team_b','--yes','--json']);assert.equal(success.code,0);assert.equal(json(success).data.data.credentials_retained,true);
});

test('provider preview is required and unknown fields, malformed rules, mode overrides and missing confirmations never reach API',async t=>{
  const f=await fixture(t);
  const rule={match:'A',matchType:'exact',itemId:'123'};
  const cases=[
    ['zettle','sync','team_b'],['netsuite','disconnect','team_b'],
    ['zettle','settings','team_b','--data','{"automaticInvoicing":true,"cardPaymentForm":"99"}','--yes'],
    ['netsuite','items','preview','team_b','--data',JSON.stringify({rule,days:181}),'--yes'],
    ['netsuite','items','preview','team_b','--data',JSON.stringify({rule,livemode:true}),'--yes'],
    ['netsuite','items','save-rule','team_b','--data',JSON.stringify({rule}),'--yes'],
    ['netsuite','items','save-rule','team_b','--data',JSON.stringify({rule,previewToken:'x',confirmChanges:'true'}),'--yes'],
    ['netsuite','syncs','team_b','--before','arbitrary-token'],
    ['netsuite','invoices','sync','team_b','../other','--yes'],
  ];
  for(const args of cases){const r=await f.run(['integrations',...args,'--json']);assert.equal(r.code,1);assert.ok(json(r).error);}
  assert.equal(f.requests.length,0);
});

const billingUuid = '12345678-1234-4123-8123-123456789012';
const billingScope = {team_id:'team_b',billing_account_id:'ba_1',provider_environment:'sandbox',can_manage:true,effect_scope:'billing_account_shared'};
const billingOperation = {id:billingUuid,...billingScope,action:'checkout',status:'handoff_ready',result:{kind:'checkout',url:'https://example.invalid/private-handoff'},error:null};

test('billing read routes retain nested pagination and operation uncertainty returns nonzero',async t=>{
  const f=await fixture(t,req=>req.url.includes('/operations/')?{data:{...billingOperation,status:'outcome_unknown',result:{kind:'fiscal',fiscal:{stripe_synced:false}}}}:{data:{...billingScope,data:[],has_more:true,cursor:'opaque_cursor'}});
  const cases=[
    [['billing','summary','team_b'],'GET','/summary'],[['billing','plans','team_b'],'GET','/plans'],
    [['billing','history','team_b','--limit','10','--cursor','opaque_cursor'],'GET','/history?limit=10&cursor=opaque_cursor'],
    [['billing','fiscal','get','team_b'],'GET','/fiscal'],
    [['billing','operations','get','team_b',billingUuid],'GET',`/operations/${billingUuid}`],
    [['billing','operations','reconcile','team_b',billingUuid],'POST',`/operations/${billingUuid}/reconcile`],
  ];
  for(const [args,method,path]of cases){const r=await f.run([...args,'--json']);assert.equal(r.code,path.includes('/operations/')?1:0,r.stderr);assert.equal(f.requests.at(-1).method,method);assert.equal(f.requests.at(-1).url,'/v2/teams/team_b/billing'+path);const data=json(r).data;if(path.includes('/operations/'))assert.equal(data.result.fiscal.stripe_synced,false);else{assert.equal(data.has_more,true);assert.equal(data.cursor,'opaque_cursor');}}
});

test('billing writes persist private journals before request, omit PII/URLs and retain caller operation UUID',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'gigstack-billing-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const f=await fixture(t,req=>({data:req.url.endsWith('/summary')?billingScope:billingOperation}));
  const cases=[
    ['checkout',{plan_id:'pro',billing_cycle:'monthly',intro:false}],
    ['upgrade',{plan_id:'business',billing_cycle:'annual',quantity:2}],
    ['portal',{intent:'cancel_subscription'}],
    ['fiscal',{fiscal:{legal_name:'PRIVATE-FISCAL-NAME',rfc:'AAA010101AAA',tax_system:'601',use:'G03',email:null,address:{zip:'01234',street:null}}}],
  ];
  for(const[action,body]of cases){
    const journal=join(dir,`${action}.json`),args=action==='fiscal'?['billing','fiscal','update','team_b']:['billing',action,'team_b'];
    const r=await f.run([...args,'--operation-id',billingUuid,'--operation-file',journal,'--data',JSON.stringify(body),'--yes','--json']);assert.equal(r.code,0,r.stderr);
    assert.equal(json(r).operation_reference.id,billingUuid);assert.equal(json(r).data.status,'handoff_ready');
    const saved=await readFile(journal,'utf8');assert.ok(!saved.includes('PRIVATE-FISCAL-NAME'));assert.ok(!saved.includes('private-handoff'));assert.ok(!saved.includes('synthetic-test-token'));
    assert.equal((await stat(journal)).mode&0o777,0o600);assert.equal(JSON.parse(saved).billing_account_id,'ba_1');assert.equal(JSON.parse(saved).provider_environment,'sandbox');
    assert.deepEqual(JSON.parse(f.requests.at(-1).body),{...body,operation_id:billingUuid});assert.equal(f.requests.at(-1).method,action==='fiscal'?'PATCH':'POST');
  }
});

test('identical billing journal reads operation before retry; mismatched scope/body never writes',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'gigstack-billing-retry-'));t.after(()=>rm(dir,{recursive:true,force:true}));const journal=join(dir,'operation.json');let providerEnvironment='sandbox';
  const f=await fixture(t,req=>({data:req.url.endsWith('/summary')?{...billingScope,provider_environment:providerEnvironment}:billingOperation}));
  const args=['billing','checkout','team_b','--operation-id',billingUuid,'--operation-file',journal,'--data','{"plan_id":"pro","billing_cycle":"monthly"}','--yes','--json'];
  assert.equal((await f.run(args)).code,0);assert.equal((await f.run(args)).code,0);
  assert.deepEqual(f.requests.map(r=>r.method),['GET','POST','GET','GET']);assert.ok(f.requests.at(-1).url.endsWith(`/operations/${billingUuid}`));
  const changed=[...args];changed[changed.indexOf('--data')+1]='{"plan_id":"business","billing_cycle":"monthly"}';assert.equal((await f.run(changed)).code,1);
  providerEnvironment='production';assert.equal((await f.run(args)).code,1);
  assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
});

test('billing transport uncertainty keeps journal and operation reference, never generates a new ID',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'gigstack-billing-timeout-'));t.after(()=>rm(dir,{recursive:true,force:true}));const journal=join(dir,'operation.json');
  const f=await fixture(t,req=>req.url.endsWith('/summary')?{data:billingScope}:{timeoutAfterHeaders:true});
  const args=['billing','portal','team_b','--operation-id',billingUuid,'--operation-file',journal,'--data','{"intent":"manage"}','--yes','--json'];
  const r=await f.run(args,{timeoutAfterHeaders:true});assert.equal(r.code,1);assert.equal(json(r).operation_reference.id,billingUuid);assert.equal(json(r).error.outcome,'unknown');
  assert.equal(JSON.parse(await readFile(journal,'utf8')).operation_id,billingUuid);assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
  assert.equal(json(r).error.code,'request_timeout');assert.deepEqual(f.requests.map(r=>r.method),['GET','POST']);
  assert.equal(f.requests[1].url,'/v2/teams/team_b/billing/portal');assert.equal(JSON.parse(f.requests[1].body).operation_id,billingUuid);
});

test('billing invalid inputs, missing confirmation and browser-only resolve make no network request or journal',async t=>{
  const f=await fixture(t);const dir=await mkdtemp(join(tmpdir(),'gigstack-billing-invalid-'));t.after(()=>rm(dir,{recursive:true,force:true}));const journal=join(dir,'never-created.json');
  const common=['--operation-id',billingUuid,'--operation-file',journal,'--json'];
  const cases=[
    ['billing','upgrade','team_b','--data','{"plan_id":"pro","billing_cycle":"monthly"}',...common],
    ['billing','checkout','team_b','--data','{"plan_id":"pro","billing_cycle":"monthly","intro":true,"trial_id":"trial1"}','--yes',...common],
    ['billing','portal','team_b','--data','{"intent":"manage","return_url":"https://evil.invalid"}','--yes',...common],
    ['billing','portal','team_b','--team','other','--data','{"intent":"manage"}','--yes',...common],
    ['billing','operations','resolve','team_b',billingUuid,'--json'],
  ];
  for(const args of cases){const r=await f.run(args);assert.equal(r.code,1);assert.ok(json(r).error);}
  assert.equal(f.requests.length,0);await assert.rejects(stat(journal));
});

test('billing journal failure prevents provider write and still returns recovery UUID metadata',async t=>{
  const f=await fixture(t,()=>({data:billingScope}));const dir=await mkdtemp(join(tmpdir(),'gigstack-journal-fail-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const r=await f.run(['billing','portal','team_b','--operation-id',billingUuid,'--operation-file',join(dir,'missing','journal.json'),'--data','{"intent":"manage"}','--yes','--json']);
  assert.equal(r.code,1);assert.equal(json(r).operation_reference.id,billingUuid);assert.deepEqual(f.requests.map(r=>r.method),['GET']);
});

test('billing retry only resends original UUID/body after a verified 404 readback',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'gigstack-billing-notfound-'));t.after(()=>rm(dir,{recursive:true,force:true}));const journal=join(dir,'operation.json');let writes=0;
  const f=await fixture(t,req=>req.url.endsWith('/summary')?{data:billingScope}:req.method==='GET'?{status:404,error:{code:'not_found',message:'Operation not found'}}:++writes===1?{status:503,error:{code:'unavailable',message:'Unavailable'}}:{data:{...billingOperation,status:'completed'}});
  const args=['billing','portal','team_b','--operation-id',billingUuid,'--operation-file',journal,'--data','{"intent":"manage"}','--yes','--json'];
  assert.equal((await f.run(args)).code,1);assert.equal((await f.run(args)).code,0);
  assert.deepEqual(f.requests.map(r=>r.method),['GET','POST','GET','GET','POST']);assert.equal(f.requests[1].body,f.requests[4].body);
  await chmod(journal,0o644);assert.equal((await f.run(args)).code,1);assert.equal(f.requests.filter(r=>r.method==='POST').length,2);
});

test('document CRUD/link/analyze preserve exact camelCase bodies and empty-page cursors',async t=>{
  const response={data:{data:[],has_more:true,next_cursor:'opaque_page'}};const f=await fixture(t,()=>response);
  const create={documentType:'contract',name:'Fixture',fileUrl:'https://storage.googleapis.com/fixture/teams/team_b/test/support-documents/file.pdf',storagePath:'teams/team_b/test/support-documents/file.pdf',fileName:'file.pdf',tags:[],metadata:{source:'fixture'}};
  const cases=[
    [['documents','list','--limit','5','--cursor','opaque_page','--document-type','contract','--entity-type','client','--entity-id','client_1'],'GET','/v2/documents?limit=5&cursor=opaque_page&document_type=contract&entity_type=client&entity_id=client_1'],
    [['documents','get','doc_1'],'GET','/v2/documents/doc_1'],
    [['documents','create','--data',JSON.stringify(create),'--yes'],'POST','/v2/documents'],
    [['documents','update','doc_1','--data','{"description":null,"validFrom":0,"tags":[]}','--yes'],'PATCH','/v2/documents/doc_1'],
    [['documents','link','doc_1','--entity-type','client','--entity-id','client_1','--yes'],'POST','/v2/documents/doc_1/link'],
    [['documents','unlink','doc_1','--entity-type','payment','--entity-id','payment_1','--yes'],'DELETE','/v2/documents/doc_1/link'],
    [['documents','analyze','doc_1','--yes'],'POST','/v2/documents/doc_1/analyze'],
    [['documents','delete','doc_1','--yes'],'DELETE','/v2/documents/doc_1'],
    [['invoices','payment-get','complement_1'],'GET','/v2/invoices/payment/complement_1'],
  ];
  for(const[args,method,path]of cases){const r=await f.run([...args,'--json']);assert.equal(r.code,0,r.stderr);assert.deepEqual(json(r),response);assert.equal(f.requests.at(-1).method,method);assert.equal(f.requests.at(-1).url,path);}
  assert.deepEqual(JSON.parse(f.requests[2].body),create);assert.deepEqual(JSON.parse(f.requests[3].body),{description:null,validFrom:0,tags:[]});
  assert.deepEqual(JSON.parse(f.requests[5].body),{entityType:'payment',entityId:'payment_1'});
});

test('standalone and three resource uploads send local multipart files with correct MIME, fields and selected team',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'gigstack-documents-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'fixture.pdf');await writeFile(file,'%PDF-synthetic-fixture');const f=await fixture(t);
  const cases=[['documents','upload'],...['clients','payments','invoices'].map(resource=>[resource,'support-documents','upload','resource_1'])];
  for(const args of cases){const r=await f.run([...args,'--file',file,'--document-type','contract','--name','Contrato revisado','--description','Fixture','--team','team_b','--yes','--json']);assert.equal(r.code,0,r.stderr);json(r);const req=f.requests.at(-1);assert.equal(req.method,'POST');assert.match(req.headers['content-type'],/^multipart\/form-data; boundary=/);assert.match(req.body,/name="file"; filename="fixture.pdf"/);assert.match(req.body,/Content-Type: application\/pdf/);assert.match(req.body,/name="documentType"\r\n\r\ncontract/);assert.match(req.body,/name="name"\r\n\r\nContrato revisado/);assert.ok(!req.body.includes('analyzeWithAI'));assert.equal(new URL(req.url,f.base).searchParams.get('team'),'team_b');}
  for(const resource of ['clients','payments','invoices']){const r=await f.run([resource,'support-documents','list','resource_1','--json']);assert.equal(r.code,0);assert.equal(f.requests.at(-1).url,`/v2/${resource}/resource_1/support-documents`);}
  assert.equal(f.requests.length,7);
});

test('document unsafe identifiers, inert AI flags, unconfirmed uploads and oversized files are rejected locally',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'gigstack-documents-invalid-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'fixture.pdf');await writeFile(file,'%PDF-fixture');const large=join(dir,'large.pdf');await writeFile(large,Buffer.alloc(10*1024*1024+1));const f=await fixture(t);
  const cases=[
    ['documents','get','../other'],['documents','list','--limit','101'],['documents','list','--entity-type','users'],
    ['documents','upload','--file',file,'--document-type','contract'],
    ['documents','upload','--file',large,'--document-type','contract','--yes'],
    ['documents','upload','--file',file,'--document-type','subscription_info','--yes'],
    ['documents','create','--data','{"analyzeWithAI":true}','--yes'],
    ['documents','update','doc_1','--data','{"livemode":true}','--yes'],
    ['documents','analyze','doc_1'],['payments','support-documents','upload','../other','--file',file,'--document-type','contract','--yes'],
  ];
  for(const args of cases){const r=await f.run([...args,'--json']);assert.equal(r.code,1);assert.ok(json(r).error);}assert.equal(f.requests.length,0);
});


test('checkout cancellation binds original checkout in its private journal and reads new intent before retry',async t=>{
  const original='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
  const dir=await mkdtemp(join(tmpdir(),'gigstack-cancel-checkout-'));t.after(()=>rm(dir,{recursive:true,force:true}));const journal=join(dir,'cancel.json');
  const result={id:billingUuid,action:'checkout.cancel',status:'completed',result:{kind:'checkout_cancellation',checkout_operation_id:original,session_id:'synthetic_session',status:'expired'}};
  const f=await fixture(t,req=>({data:req.url.endsWith('/summary')?billingScope:result}));
  const args=['billing','operations','cancel-checkout','team_b',original,'--operation-id',billingUuid,'--operation-file',journal,'--yes','--json'];
  let r=await f.run(args);assert.equal(r.code,0,r.stderr);assert.deepEqual(json(r).data,result);assert.equal(json(r).operation_reference.id,billingUuid);
  assert.equal(f.requests.at(-1).url,`/v2/teams/team_b/billing/operations/${original}/cancel`);assert.deepEqual(JSON.parse(f.requests.at(-1).body),{operation_id:billingUuid});
  const saved=JSON.parse(await readFile(journal,'utf8'));assert.ok(saved.path.includes(original));assert.equal(saved.operation_id,billingUuid);assert.equal((await stat(journal)).mode&0o777,0o600);
  r=await f.run(args);assert.equal(r.code,0);assert.equal(f.requests.at(-1).url,`/v2/teams/team_b/billing/operations/${billingUuid}`);assert.equal(f.requests.filter(q=>q.method==='POST').length,1);
  const changed=[...args];changed[4]=other;assert.equal((await f.run(changed)).code,1);assert.equal(f.requests.filter(q=>q.method==='POST').length,1);
});

test('checkout cancellation rejects reused UUID or absent confirmation locally, keeps uncertainty nonzero',async t=>{
  const original='22222222-2222-4222-8222-222222222222';const dir=await mkdtemp(join(tmpdir(),'gigstack-cancel-unknown-'));t.after(()=>rm(dir,{recursive:true,force:true}));const journal=join(dir,'cancel.json');
  const f=await fixture(t,req=>({data:req.url.endsWith('/summary')?billingScope:{id:billingUuid,action:'checkout.cancel',status:'outcome_unknown',result:null}}));
  const args=['billing','operations','cancel-checkout','team_b',original,'--operation-id',billingUuid,'--operation-file',journal,'--json'];
  assert.equal((await f.run(args)).code,1);const same=[...args];same[6]=original;assert.equal((await f.run([...same,'--yes'])).code,1);assert.equal(f.requests.length,0);await assert.rejects(stat(journal));
  const r=await f.run([...args,'--yes']);assert.equal(r.code,1);assert.equal(json(r).data.status,'outcome_unknown');assert.equal(json(r).operation_reference.id,billingUuid);assert.equal(f.requests.filter(q=>q.method==='POST').length,1);
});

test('user removal preserves the explicit identity-retained receipt', async t => {
  const data={id:'user_a',deleted:false,account_deleted:false,removed_from_teams:['team_b'],account_deletion:{status:'not_attempted',requirement:'authoritative_scope_and_approval'}};
  const f=await fixture(t,()=>({success:true,data}));
  const r=await f.run(['users','delete','user_a','--team','team_b','--yes','--json']);
  assert.equal(r.code,0,r.stderr);assert.deepEqual(json(r).data,data);assert.equal(f.requests.length,1);
  const help=await f.run(['users','delete','--help']);
  assert.match(help.stdout,/conserva/);assert.match(help.stdout,/no elimina la identidad/);
});
