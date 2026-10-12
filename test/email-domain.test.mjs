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


const uuid='11111111-1111-4111-8111-111111111111';
const scope={can_manage:true,billing_account_id:'b',provider_environment:'configured_sendgrid_account',testmode_isolates_provider:false};
test('email-domain mutations persist stable journals and retry via exact operation readback',async t=>{
 const f=await fixture(t,req=>({data:req.method==='GET'&&!req.url.includes('/operations/')?scope:{id:uuid,status:'completed',result:{domain:{configured:true,valid:false}}}}));const dir=await mkdtemp(join(tmpdir(),'domain-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const action of ['set','validate','remove']){const file=join(dir,action+'.json'),args=['email-domain',action,'team_b',...(action==='set'?['--domain','Example.test','--subdomain','Billing']:[]),'--operation-id',uuid,'--operation-file',file,'--yes','--json'];let r=await f.run(args);assert.equal(r.code,0,r.stderr);assert.equal(json(r).data.result.domain.valid,false);const write=f.requests.at(-1);assert.equal(write.method,action==='set'?'PUT':action==='remove'?'DELETE':'POST');assert.deepEqual(JSON.parse(write.body),{operation_id:uuid,...(action==='set'?{domain:'example.test',subdomain:'billing'}:{})});assert.equal((await stat(file)).mode&0o777,0o600);const count=f.requests.filter(req=>req.method!=='GET').length;r=await f.run(args);assert.equal(r.code,0);assert.equal(f.requests.at(-1).url,`/v2/teams/team_b/email-domain/operations/${uuid}`);assert.equal(f.requests.filter(req=>req.method!=='GET').length,count)}
});
test('domain recovery needs explicit acknowledgment, preserves unknown and never replays provider write',async t=>{
 const f=await fixture(t,()=>({data:{id:uuid,status:'outcome_unknown',resolution:{action:'released_for_new_operation'}}}));
 const args=['email-domain','operations','resolve','team_b',uuid,'--json'];assert.equal((await f.run([...args,'--yes'])).code,1);assert.equal((await f.run([...args,'--acknowledge-unconfirmed-effects'])).code,1);assert.equal(f.requests.length,0);
 const r=await f.run([...args,'--acknowledge-unconfirmed-effects','--yes']);assert.equal(r.code,1);assert.equal(json(r).data.status,'outcome_unknown');assert.deepEqual(JSON.parse(f.requests[0].body),{acknowledge_unconfirmed_effects:true});
 assert.equal((await f.run(['email-domain','operations','reconcile','team_b',uuid,'--json'])).code,1);assert.equal(f.requests.at(-1).url,`/v2/teams/team_b/email-domain/operations/${uuid}/reconcile`);assert.deepEqual(JSON.parse(f.requests.at(-1).body),{});
});
test('domain invalid names, absent confirmation and team mismatch create no journal or network calls',async t=>{
 const f=await fixture(t);const dir=await mkdtemp(join(tmpdir(),'domain-cli-invalid-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'operation.json');const common=['--operation-id',uuid,'--operation-file',file,'--json'];
 for(const args of [['email-domain','set','team_b','--domain','https://example.test','--subdomain','mail','--yes'],['email-domain','validate','team_b'],['email-domain','remove','team_b','--team','other','--yes']]){assert.equal((await f.run([...args,...common])).code,1)}assert.equal(f.requests.length,0);await assert.rejects(stat(file));
});
