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
 const f = await fixture(t, req => {const body=JSON.parse(req.body);return {success:true,data:{...approval,action:body.action,payload:body.payload}};});
 const cases = [
  [['api-keys','create'], 'api_keys.generate', {}],
  [['api-keys','rotate'], 'api_keys.rotate', {}],
  [['me','mcp-tokens','create','--data','{"name":"Fixture","team_id":"team_b","livemode":false}'], 'mcp_tokens.create', {name:'Fixture',livemode:false}],
 ];
 for (const [args,action,payload] of cases) {
  for(let attempt=0;attempt<2;attempt++) {
   const result=await f.run([...args,'--operation-id',operation,'--team','team_b','--json']);
   assert.equal(result.code,0,result.stdout+result.stderr); assert.deepEqual(json(result).data,{...approval,action,payload});
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

function invitationApproval(billing=false,recovery=false) {
 const change={id:recovery?'inv_existing':'inv_new',type:billing?'billingAccount':'team',email:'new@example.test',role:'admin',team_id:billing?null:'team_b',billing_account_id:'ba_fixture',billing_account_name:'Fixture',inviter:{id:'owner_fixture',email:'owner@example.test',display_name:'Owner'},send_email:!recovery,expires_at:700001,existing_invitation:recovery,prior_delivery_status:recovery?'unknown':null};
 return {...approval,action:billing?'billing_account.invitations.create_admin':'team.invitations.create_admin',team:billing?null:approval.team,payload:{email:change.email,send_email:change.send_email,...(recovery?{existing_invitation_id:change.id}:{})},requested_modes:[],effect_scope:billing?'billing_account_membership':'team_membership',disclosure_version:'invitation-approval-v1',invitation_change:change};
}
const ownedInvite={id:'inv_new',email:'new@example.test',role:'admin',type:'billingAccount',team_id:null,billing_account_id:'ba_fixture',approval_required:false,status:'pending',created_at:1,expires_at:700001,created_by:'owner_fixture',delivery:{status:'sent',attempted_at:2}};
test('team and billing invitation preparation requires exact scope/send choice and preserves operation IDs',async t=>{
 for(const billing of [false,true]) for(const recovery of [false,true]) {
  const data=invitationApproval(billing,recovery),f=await fixture(t,()=>({success:true,data}));
  const args=['account-invitations',billing?'prepare-billing':'prepare-team',billing?'ba_fixture':'team_b','--email','NEW@example.test','--operation-id',operation,recovery?'--no-send-email':'--send-email',...(recovery?['--existing-invitation','inv_existing']:[]),'--json'];
  for(let attempt=0;attempt<2;attempt++){
   const r=await f.run(args);assert.equal(r.code,0,r.stdout+r.stderr);assert.deepEqual(json(r).data,data);assert.match(json(r).next_step,/Preparar no envía correo/);
   const req=f.requests.at(-1);assert.deepEqual(JSON.parse(req.body),{operation_id:operation,action:data.action,...(billing?{billing_account_id:'ba_fixture'}:{team_id:'team_b'}),payload:data.payload});
   const url=new URL(req.url,f.base);assert.equal(url.pathname,'/v2/users/me/account-approvals');assert.equal(url.searchParams.get('team'),billing?null:'team_b');
  }
 }
});
test('existing team create admin command prepares an approval and rejects direct/mixed input',async t=>{
 const f=await fixture(t,()=>({data:invitationApproval()}));
 const args=['teams','invitations','create','team_b','--role','admin','--email','new@example.test'];
 let r=await f.run([...args,'--operation-id',operation,'--send-email','--json']);assert.equal(r.code,0,r.stdout+r.stderr);assert.equal(new URL(f.requests[0].url,f.base).pathname,'/v2/users/me/account-approvals');
 for(const suffix of [[],['--operation-id',operation],['--send-email'],['--operation-id',operation,'--send-email','--existing-invitation','inv_existing'],['--operation-id',operation,'--send-email','--team','other']]) {
  r=await f.run([...args,...suffix,'--json']);assert.equal(r.code,1,r.stdout+r.stderr);
 }
 assert.equal(f.requests.length,1);
});
test('owned invitation metadata and exact explicit resend/revoke never expose tokens or unexpected secrets',async t=>{
 const f=await fixture(t,()=>({data:{...ownedInvite,token:'synthetic-secret',review_challenge:'synthetic-secret',delivery:{...ownedInvite.delivery,claim:'synthetic-secret'}}}));
 for(const [args,method,body] of [[['get','inv_new'],'GET',undefined],[['revoke','inv_new','--yes'],'DELETE',{}],[['resend','inv_new','--yes','--acknowledge-unconfirmed-delivery'],'POST',{acknowledge_unconfirmed_delivery:true}]]) {
  const r=await f.run(['account-invitations',...args,'--json']);assert.equal(r.code,0,r.stdout+r.stderr);assert.deepEqual(json(r).data,ownedInvite);assert.doesNotMatch(r.stdout+r.stderr,/synthetic-secret|review_challenge|claim/);
  const req=f.requests.at(-1);assert.equal(req.method,method);assert.equal(req.url,`/v2/users/me/account-invitations/inv_new${method==='POST'?'/resend':''}`);assert.deepEqual(req.body?JSON.parse(req.body):undefined,body);
 }
});
test('invitation mutations require confirmation; unknown status exits nonzero and transport failure never retries',async t=>{
 const f=await fixture(t,()=>({data:{...ownedInvite,delivery:{status:'unknown',attempted_at:2}}}));
 for(const cmd of ['revoke','resend']) {
  const r=await f.run(['account-invitations',cmd,'inv_new','--json']);assert.equal(r.code,1);assert.equal(f.requests.length,0);
 }
 const read=await f.run(['account-invitations','get','inv_new','--json']);assert.equal(read.code,1);assert.equal(json(read).data.delivery.status,'unknown');
 for(const response of [{status:409,error:{code:'delivery_outcome_unknown',message:'synthetic-secret'}},{timeoutAfterHeaders:true}]){
  const timed=await fixture(t,()=>response);const r=await timed.run(['account-invitations','resend','inv_new','--yes','--json'],{timeoutAfterHeaders:!!response.timeoutAfterHeaders});
  assert.equal(r.code,1);assert.equal(timed.requests.length,1);assert.doesNotMatch(r.stdout+r.stderr,/synthetic-secret/);assert.match(r.stdout,/No se reintentó automáticamente/);
 }
});
test('completed invitation receipts preserve binding and redact secrets; malformed scope is rejected',async t=>{
 const data=invitationApproval(true),c=data.invitation_change;
 data.status='completed';data.completed_at=2;data.receipt={keys:[],revoked_count:0,membership:null,invitation:{id:c.id,type:c.type,email:c.email,role:'admin',team_id:c.team_id,billing_account_id:c.billing_account_id,expires_at:c.expires_at,approval_id:id}};
 const f=await fixture(t,()=>({data:{...data,token:'synthetic-secret',receipt:{...data.receipt,invitation:{...data.receipt.invitation,token:'synthetic-secret'}}}}));
 const r=await f.run(['account-approvals','get',id,'--json']);assert.equal(r.code,0,r.stdout+r.stderr);assert.deepEqual(json(r).data,data);assert.doesNotMatch(r.stdout,/synthetic-secret/);assert.match(json(r).next_step,/no prueba entrega ni ingreso/);
 for(const bad of [{...data,team:approval.team},{...data,receipt:{...data.receipt,invitation:{...data.receipt.invitation,email:'other@example.test'}}}]){
  const badf=await fixture(t,()=>({data:bad}));const result=await badf.run(['account-approvals','get',id,'--json']);assert.equal(result.code,1);
 }
});

test('response identities must match exact prepared intent or requested read/revoke reference',async t=>{
 const data=invitationApproval();
 for(const response of [invitationApproval(true),{...data,operation_id:'00000000-0000-4000-8000-000000000002'},{...data,team:{...data.team,id:'other'},invitation_change:{...data.invitation_change,team_id:'other'}},{...data,payload:{...data.payload,email:'other@example.test'},invitation_change:{...data.invitation_change,email:'other@example.test'}}]) {
  const f=await fixture(t,()=>({data:response}));
  const r=await f.run(['account-invitations','prepare-team','team_b','--email','new@example.test','--send-email','--operation-id',operation,'--json']);
  assert.equal(r.code,1);assert.equal(f.requests.length,1);assert.doesNotMatch(r.stdout,/review_url/);
 }
 for(const cmd of ['get','cancel']){
  const f=await fixture(t,()=>({data}));const r=await f.run(['account-approvals',cmd,'b'.repeat(64),...(cmd==='cancel'?['--yes']:[]),'--json']);assert.equal(r.code,1);assert.equal(f.requests.length,1);
 }
 for(const cmd of ['get','revoke','resend']){
  const f=await fixture(t,()=>({data:ownedInvite}));const r=await f.run(['account-invitations',cmd,'different',...(cmd==='get'?[]:['--yes']),'--json']);assert.equal(r.code,1);assert.equal(f.requests.length,1);
 }
});

const managedPayload={email:'managed@example.test',first_name:'Managed',address:{country:'MEX',city:null}};
function managedApproval(status='pending'){
 const completed=status==='completed',activation=status==='activation_required';
 return {...approval,action:'managed_users.create_admin',payload:managedPayload,requested_modes:[],effect_scope:'managed_identity',disclosure_version:'managed-identity-v1',status,can_cancel:status==='pending',completed_at:completed?2:null,invitation_change:null,managed_identity_change:{user_id:'managed_user',email:managedPayload.email,profile:{first_name:'Managed',address:{city:null,country:'MEX'}},team_id:'team_b',billing_account_id:'ba_fixture',role:'admin',auto_join:true,credential_delivery:'none',initial_auth_state:'disabled',bootstrap_effects:['profile_initialization','membership_usage_initialization','support_identity_claims']},managed_identity_execution:status==='pending'?null:{phase:completed?'complete':activation?'activation_required':'creating',auth_state:completed?'enabled':activation?'disabled':'unknown',membership_granted:completed,started_at:1,updated_at:2,error_code:null},receipt:completed?{keys:[],revoked_count:0,membership:null,invitation:null,managed_identity:{user_id:'managed_user',team_id:'team_b',billing_account_id:'ba_fixture',role:'admin',auth_state:'enabled',membership_granted:true}}:null};
}
test('managed admin preparation preserves nested profile and uses only the stable personal approval endpoint',async t=>{
 const f=await fixture(t,()=>({data:managedApproval()}));
 const args=['users','create-admin','--operation-id',operation,'--team','team_b','--data',JSON.stringify(managedPayload),'--json'];
 for(let i=0;i<2;i++){const result=await f.run(args);assert.equal(result.code,0,result.stdout+result.stderr);assert.deepEqual(json(result).data.payload,managedPayload);assert.match(json(result).next_step,/disabled identity/);}
 assert.equal(f.requests.length,2);
 for(const req of f.requests){assert.equal(req.method,'POST');assert.equal(new URL(req.url,f.base).pathname,'/v2/users/me/account-approvals');assert.deepEqual(JSON.parse(req.body),{operation_id:operation,action:'managed_users.create_admin',team_id:'team_b',payload:managedPayload});}
 for(const payload of [{...managedPayload,password:'synthetic-secret'},{...managedPayload,role:'admin'},{...managedPayload,auto_join:false},{...managedPayload,address:{secret:'synthetic-secret'}}]){const r=await f.run(['users','create-admin','--operation-id',operation,'--team','team_b','--data',JSON.stringify(payload),'--json']);assert.equal(r.code,1);}
 const direct=await f.run(['users','create','--data',JSON.stringify({...managedPayload,role:'admin'}),'--json']);assert.equal(direct.code,1);assert.equal(f.requests.length,2);
});
test('managed reconcile projects every lifecycle stage, preserves unknown and never invokes browser terminals',async t=>{
 for(const status of ['pending','processing','unknown','activation_required','completed']){
  const data=managedApproval(status);data.secrets={token:'synthetic-secret'};data.review_challenge='synthetic-secret';data.managed_identity_change.private_record='synthetic-secret';if(data.receipt)data.receipt.managed_identity.token='synthetic-secret';
  const f=await fixture(t,()=>({data}));const r=await f.run(['account-approvals','reconcile',id,'--json']);assert.equal(r.code,status==='unknown'?1:0,r.stdout+r.stderr);const out=json(r);assert.equal(out.data.status,status);assert.equal(out.data.managed_identity_change.user_id,'managed_user');assert.doesNotMatch(r.stdout+r.stderr,/synthetic-secret|review_challenge|private_record/);assert.equal(f.requests.length,1);assert.equal(f.requests[0].method,'POST');assert.equal(f.requests[0].url,`/v2/users/me/account-approvals/${id}/reconcile`);assert.deepEqual(JSON.parse(f.requests[0].body),{});
  if(status==='activation_required')assert.match(out.next_step,/new review/);if(status==='unknown')assert.match(out.next_step,/Do not repeat/);
 }
});
test('managed responses refuse mismatched scope, invalid completion, and uncertain errors without retries or secret output',async t=>{
 for(const data of [{...managedApproval(),id:'b'.repeat(64)},{...managedApproval(),managed_identity_change:{...managedApproval().managed_identity_change,team_id:'foreign'}},{...managedApproval('completed'),managed_identity_execution:{...managedApproval('completed').managed_identity_execution,auth_state:'disabled'}}]){
  const f=await fixture(t,()=>({data}));const r=await f.run(['account-approvals','reconcile',id,'--json']);assert.equal(r.code,1);assert.equal(f.requests.length,1);
 }
 const f=await fixture(t,()=>({status:503,error:{message:'synthetic-secret'}}));const r=await f.run(['account-approvals','reconcile',id,'--json']);assert.equal(r.code,1);assert.equal(f.requests.length,1);assert.doesNotMatch(r.stdout+r.stderr,/synthetic-secret/);assert.match(r.stdout,RegExp(id));
 for(const action of ['execute','continue','review']){const r=await f.run(['account-approvals',action,id,'--json']);assert.equal(r.code,1);}assert.equal(f.requests.length,1);
});

test('invalidated managed creation preserves recovery reference without suggesting another identity',async t=>{
 const f=await fixture(t,()=>({data:{...managedApproval('invalidated'),error:{code:'scope_changed',message:'Changed',retryable:false}}}));
 const r=await f.run(['account-approvals','get',id,'--json']);assert.equal(r.code,1);assert.match(json(r).data.error.message,/no repitas/);assert.doesNotMatch(json(r).data.error.message,/nueva aprobación/);assert.equal(f.requests.length,1);
});
