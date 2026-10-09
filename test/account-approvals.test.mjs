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


const operation = '00000000-0000-4000-8000-000000000001';
const id = 'a'.repeat(64);
const approval = { id, operation_id: operation, action: 'api_keys.generate', team: { id:'team_b',legal_name:null,tax_id:null }, billing_account_id:'ba_fixture',payload:{},requested_modes:[true,false],effect_scope:'team_credentials',status:'pending',created_at:1,expires_at:600001,completed_at:null,review_url:`https://app.gigstack.pro/account/approvals/${id}`,can_cancel:true,disclosure_version:'credential-approval-v1',existing_key_ids:[],terms:null,membership_change:null,receipt:null,error:null };
test('prepare API creation, rotation and MCP token uses stable explicit IDs without issuing credentials', async t => {
 const f = await fixture(t, () => ({success:true,data:approval}));
 const cases = [
  [['api-keys','create'], 'api_keys.generate', {}],
  [['api-keys','rotate'], 'api_keys.rotate', {}],
  [['me','mcp-tokens','create','--data','{"name":"Fixture","team_id":"team_b","livemode":false}'], 'mcp_tokens.create', {name:'Fixture',livemode:false}],
 ];
 for (const [args,action,payload] of cases) {
  for(let attempt=0;attempt<2;attempt++) {
   const result=await f.run([...args,'--operation-id',operation,'--team','team_b','--json']);
   assert.equal(result.code,0,result.stdout+result.stderr); assert.deepEqual(json(result).data,approval);
   const req=f.requests.at(-1); assert.equal(req.method,'POST');assert.equal(new URL(req.url,f.base).pathname,'/v2/users/me/account-approvals');
   assert.deepEqual(JSON.parse(req.body),{operation_id:operation,action,team_id:'team_b',payload});
   assert.match(json(result).next_step,/preparar no emite/);
  }
 }
});
test('approval get/cancel retain metadata receipt and discard accidental secrets or browser challenges',async t=>{
 const data={...approval,status:'completed',completed_at:2,can_cancel:false,secrets:{live:'synthetic-secret'},apikey:'synthetic-secret',challenge:'synthetic-secret',receipt:{keys:[{key_id:'key_fixture',type:'api',livemode:true,apikey:'synthetic-secret'}],revoked_count:2,membership:null}};
 const f=await fixture(t,()=>({success:true,data}));
 for(const [args,method] of [[['account-approvals','get',id],'GET'],[['account-approvals','cancel',id,'--yes'],'DELETE']]) {
  const r=await f.run([...args,'--json']);assert.equal(r.code,0,r.stdout+r.stderr);assert.equal(json(r).data.status,'completed');
  assert.doesNotMatch(r.stdout+r.stderr,/synthetic-secret|challenge|apikey/);assert.equal(f.requests.at(-1).method,method);
  assert.equal(f.requests.at(-1).url,`/v2/users/me/account-approvals/${id}`);
 }
});
test('missing stable ID, old secret delivery/terms options and unsafe scope are rejected before request',async t=>{
 const f=await fixture(t);
 for(const args of [
 ['api-keys','create','--team','team_b'],
 ['api-keys','rotate','--operation-id','invalid','--team','team_b'],
 ['api-keys','create','--operation-id',operation,'--out','/tmp/do-not-create'],
 ['me','mcp-tokens','create','--operation-id',operation,'--accept-terms','--data','{}'],
 ['me','mcp-tokens','create','--operation-id',operation,'--data','{"name":"Fixture","team_id":"team_b","livemode":false,"terms_accepted":true}'],
 ['me','mcp-tokens','create','--operation-id',operation,'--team','other','--data','{"name":"Fixture","team_id":"team_b","livemode":false}'],
 ['account-approvals','cancel',id],['account-approvals','get','../execute']]) {
  const r=await f.run([...args,'--json']);assert.equal(r.code,1,r.stdout+r.stderr);
 }
 assert.equal(f.requests.length,0);
});
test('unconfirmed HTTP or malformed responses do not leak error secrets or retry',async t=>{
 for(const response of [{status:409,error:{message:'synthetic-secret',details:'synthetic-secret'}},{data:{apikey:'synthetic-secret'}},{data:{...approval,review_url:`https://user:synthetic-secret@app.gigstack.pro/account/approvals/${id}`}}]) {
  const f=await fixture(t,()=>response);
  const r=await f.run(['api-keys','create','--team','team_b','--operation-id',operation,'--json']);
  assert.equal(r.code,1);assert.equal(f.requests.length,1);assert.doesNotMatch(r.stdout+r.stderr,/synthetic-secret/);assert.match(r.stdout,RegExp(operation));
  assert.equal(json(r).error.code,'approval_not_confirmed');
 }
});
test('timeout retains operation ID and sends only one request',async t=>{
 const f=await fixture(t,()=>({timeoutAfterHeaders:true}));
 const r=await f.run(['api-keys','create','--team','team_b','--operation-id',operation,'--json'],{timeoutAfterHeaders:true});
 assert.equal(r.code,1);assert.equal(f.requests.length,1);assert.match(r.stdout,RegExp(operation));
 assert.equal(f.requests[0].method,'POST');assert.equal(new URL(f.requests[0].url,f.base).pathname,'/v2/users/me/account-approvals');assert.equal(JSON.parse(f.requests[0].body).operation_id,operation);
 assert.equal(json(r).error.code,'approval_not_confirmed');
});

const membershipCases = [
  [['teams','transfer-ownership','team_b','user_target'], 'team.ownership.transfer', {new_owner_id:'user_target'}],
  [['teams','members','add','team_b','user_target','--role','admin'], 'team.members.add_admin', {member_id:'user_target'}],
  [['teams','members','update','team_b','user_target','--data','{"role":"admin"}'], 'team.members.promote_admin', {member_id:'user_target'}],
];
function membershipApproval(action, payload) {
 return {...approval,action,payload,requested_modes:[],effect_scope:'team_membership',disclosure_version:'membership-approval-v1',membership_change:{target:{id:'user_target',email:'target@example.invalid',display_name:'Target'},previous_owner_id:'user_owner',previous_role:action==='team.members.add_admin'?null:'viewer',new_role:'admin',transfers_ownership:action==='team.ownership.transfer',billing_ownership_changes:false,hidden_member:false}};
}
test('membership commands prepare exact target-only approvals and propagate the positional team',async t=>{
 const f=await fixture(t, req=>{const body=JSON.parse(req.body);return {success:true,data:membershipApproval(body.action,body.payload)};});
 for(const [args,action,payload] of membershipCases) {
  for(let attempt=0;attempt<2;attempt++) {
   const r=await f.run([...args,'--operation-id',operation,'--json']);
   assert.equal(r.code,0,r.stdout+r.stderr);assert.deepEqual(json(r).data,membershipApproval(action,payload));
   const req=f.requests.at(-1);assert.equal(req.method,'POST');
   const url=new URL(req.url,f.base);assert.equal(url.pathname,'/v2/users/me/account-approvals');assert.equal(url.searchParams.get('team'),'team_b');
   assert.deepEqual(JSON.parse(req.body),{operation_id:operation,action,team_id:'team_b',payload});
   assert.match(json(r).next_step,/Preparar no cambia membresía/);assert.match(json(r).next_step,/ambos modos/);
  }
 }
 assert.equal(f.requests.length,6);
});
test('membership preparation refuses missing IDs, mixed permission changes and old direct execution flags without HTTP',async t=>{
 const f=await fixture(t);
 const cases=[
 ...membershipCases.map(([args])=>args),
 ['teams','transfer-ownership','team_b','user_target','--operation-id',operation,'--yes'],
 ['teams','members','add','team_b','../target','--role','admin','--operation-id',operation],
 ['teams','members','add','team_b','user_target','--role','viewer','--operation-id',operation],
 ['teams','members','update','team_b','user_target','--data','{"role":"admin","permissions":{}}','--operation-id',operation],
 ['teams','members','update','team_b','user_target','--data','{"role":"admin","ghost":true}','--operation-id',operation],
 ['teams','members','update','team_b','user_target','--data','{"role":"editor"}','--operation-id',operation],
 ['teams','transfer-ownership','team_b','user_target','--operation-id',operation,'--team','other'],
 ];
 for(const args of cases){const r=await f.run([...args,'--json']);assert.equal(r.code,1,r.stdout+r.stderr);}
 assert.equal(f.requests.length,0);
});
test('membership completed receipts retain frozen identity and allowlisted result, never extra secrets or authority',async t=>{
 for(const [,action,payload] of membershipCases) {
  const data=membershipApproval(action,payload);data.status='completed';data.completed_at=2;data.can_cancel=false;
  data.receipt={keys:[],revoked_count:0,membership:{action,member_id:'user_target',owner_id:action==='team.ownership.transfer'?'user_target':'user_owner',previous_owner_id:'user_owner',role:'admin',is_owner:action==='team.ownership.transfer',added:action==='team.members.add_admin'}};
  const expected=structuredClone(data);
  data.membership_change.target.apikey='synthetic-secret';data.receipt.membership.claims='synthetic-secret';data.secrets='synthetic-secret';data.challenge='synthetic-secret';
  const f=await fixture(t,()=>({success:true,data}));
  for(const args of [['account-approvals','get',id],['account-approvals','cancel',id,'--yes']]) {
   const r=await f.run([...args,'--team','team_b','--json']);assert.equal(r.code,0,r.stdout+r.stderr);assert.deepEqual(json(r).data,expected);assert.doesNotMatch(r.stdout+r.stderr,/synthetic-secret|claims|apikey|challenge/);
  }
 }
});
test('membership transport timeout preserves the stable ID and never retries the POST',async t=>{
 for(const [args,action,payload] of membershipCases) {
  const f=await fixture(t,()=>({timeoutAfterHeaders:true}));
  const r=await f.run([...args,'--operation-id',operation,'--json'],{timeoutAfterHeaders:true});
  assert.equal(r.code,1);assert.equal(json(r).error.code,'approval_not_confirmed');assert.match(r.stdout,RegExp(operation));
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].method,'POST');assert.deepEqual(JSON.parse(f.requests[0].body),{operation_id:operation,action,team_id:'team_b',payload});
 }
});
