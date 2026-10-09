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


const operation='00000000-0000-4000-8000-000000000001',id='a'.repeat(64);
const payload={name:'Sync',livemode:false,billing_account_id:'ba_fixture',team_ids:['team_a','team_b'],action_ids:['createClients','listClients'],expires_at:1900000000000,manager_user_ids:[]};
const metadata={id:'key_one',name:'Sync',scope_version:2,scope_kind:'scoped',billing_account_id:'ba_fixture',team:null,livemode:false,team_ids:payload.team_ids,action_ids:payload.action_ids,expires_at:payload.expires_at,manager_user_ids:[],status:'active',created_at:1,revoked_at:null,revoke_at:null,replacement_key_id:null,last_used_at:null,can_manage:true,can_rotate:true,can_revoke:true};
const approval={id,operation_id:operation,action:'api_keys.create_scoped',team:null,billing_account_id:'ba_fixture',payload,requested_modes:[false],effect_scope:'scoped_api_key',status:'pending',created_at:1,expires_at:600001,completed_at:null,review_url:`https://app.gigstack.pro/account/approvals/${id}`,can_cancel:true,disclosure_version:'scoped-api-key-v2',existing_key_ids:[],terms:null,membership_change:null,receipt:null,error:null,scoped_key_change:{...payload,action:'create',previous_key_id:null,overlap_seconds:0,previous_revoke_at:null,unrelated_keys_affected:false,secret_disclosure:'once'}};
test('create prepares exact billing/single-mode/scope once and generic readback handles scoped metadata',async t=>{
 const f=await fixture(t,()=>({success:true,data:{...approval,secrets:{scoped_api_key:'synthetic-secret'}}}));
 const r=await f.run(['scoped-api-keys','prepare-create','--operation-id',operation,'--data',JSON.stringify(payload),'--json']);assert.equal(r.code,0,r.stdout+r.stderr);assert.deepEqual(JSON.parse(f.requests[0].body),{operation_id:operation,action:'api_keys.create_scoped',billing_account_id:'ba_fixture',payload});assert.equal(new URL(f.requests[0].url,f.base).pathname,'/v2/users/me/account-approvals');assert.doesNotMatch(r.stdout+r.stderr,/synthetic-secret/);assert.deepEqual(json(r).data.scoped_key_change,approval.scoped_key_change);
 const read=await f.run(['account-approvals','get',id,'--json']);assert.equal(read.code,0,read.stdout+read.stderr);assert.doesNotMatch(read.stdout,/synthetic-secret/);
});
test('rotation prepares only exact key and explicit overlap without widening',async t=>{
 const rotate={key_id:'key_one',overlap_seconds:60};const a={...approval,action:'api_keys.rotate_scoped',payload:rotate,existing_key_ids:['key_one'],scoped_key_change:{...approval.scoped_key_change,action:'rotate',previous_key_id:'key_one',overlap_seconds:60}};
 const f=await fixture(t,()=>({success:true,data:a}));const r=await f.run(['scoped-api-keys','prepare-rotate','--billing-account','ba_fixture','--operation-id',operation,'--data',JSON.stringify(rotate),'--json']);assert.equal(r.code,0,r.stdout+r.stderr);assert.deepEqual(JSON.parse(f.requests[0].body),{operation_id:operation,action:'api_keys.rotate_scoped',billing_account_id:'ba_fixture',payload:rotate});
});
test('safe key reads reject foreign/secret metadata and revoke records one exact stable receipt',async t=>{
 const f=await fixture(t,req=>({success:true,data:req.method==='DELETE'?{key_id:'key_one',revoked:true,operation_id:operation}:metadata}));const r=await f.run(['scoped-api-keys','get','key_one','--billing-account','ba_fixture','--json']);assert.equal(r.code,0,r.stdout+r.stderr);assert.deepEqual(json(r).data,metadata);
 const revoked=await f.run(['scoped-api-keys','revoke','key_one','--billing-account','ba_fixture','--operation-id',operation,'--yes','--json']);assert.equal(revoked.code,0,revoked.stdout+revoked.stderr);assert.deepEqual(JSON.parse(f.requests.at(-1).body),{operation_id:operation});
 for(const data of [{...metadata,id:'other'},{...metadata,billing_account_id:'foreign'},{...metadata,secret:'synthetic-secret'}]){const bad=await fixture(t,()=>({data}));const out=await bad.run(['scoped-api-keys','get','key_one','--billing-account','ba_fixture','--json']);assert.equal(out.code,1);assert.doesNotMatch(out.stdout+out.stderr,/synthetic-secret/);}
});
test('unknown revoke never retries or prints unsafe errors and preserves operation/key reference',async t=>{const f=await fixture(t,()=>({status:500,error:{message:'synthetic-secret'}}));const r=await f.run(['scoped-api-keys','revoke','key_one','--billing-account','ba_fixture','--operation-id',operation,'--yes','--json']);assert.equal(r.code,1);assert.equal(f.requests.length,1);assert.match(r.stdout,RegExp(operation));assert.match(r.stdout,/key_one/);assert.doesNotMatch(r.stdout+r.stderr,/synthetic-secret/);});
test('completed scoped approval readback preserves only exact safe receipt and rejects wider effects',async t=>{const completed={...approval,status:'completed',completed_at:2,can_cancel:false,receipt:{keys:[{key_id:'key_one',type:'api',livemode:false}],revoked_count:0,membership:null,scoped_api_key:{key_id:'key_one',previous_key_id:null,overlap_seconds:0,previous_revoke_at:null,metadata}}};const f=await fixture(t,()=>({success:true,data:{...completed,secrets:{secret:'synthetic-secret'}}}));const good=await f.run(['account-approvals','get',id,'--json']);assert.equal(good.code,0,good.stdout+good.stderr);assert.deepEqual(json(good).data.receipt.scoped_api_key,completed.receipt.scoped_api_key);assert.doesNotMatch(good.stdout,/synthetic-secret/);for(const receipt of [{...completed.receipt,revoked_count:5},{...completed.receipt,scoped_api_key:{...completed.receipt.scoped_api_key,metadata:{...metadata,action_ids:['deleteClientsById']}}}]){const bad=await fixture(t,()=>({data:{...completed,receipt}}));const r=await bad.run(['account-approvals','get',id,'--json']);assert.equal(r.code,1);}});

test('source-equivalent normalization sorts scope sets before prepare/echo comparison',async t=>{const unsorted={...payload,team_ids:['team_b','team_a'],action_ids:['listClients','createClients']};const f=await fixture(t,()=>({data:approval}));const r=await f.run(['scoped-api-keys','prepare-create','--operation-id',operation,'--data',JSON.stringify(unsorted),'--json']);assert.equal(r.code,0,r.stdout+r.stderr);assert.deepEqual(JSON.parse(f.requests[0].body).payload,payload);});
