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
      const env = { ...process.env, GIGSTACK_API_KEY: `fixture.${Buffer.from(JSON.stringify({livemode:false})).toString('base64url')}.synthetic`, GIGSTACK_API_BASE_URL: base, GIGSTACK_TEAM: '', ...opts.env };
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


test('provider setup maps four named actions and preserves browser handoff and scope', async t => {
 const state={id:'session_1',provider:'airtable',status:'pending',effect_scope:'team_shared_credentials',completion_url:'https://app.example.test/account/integrations/connect/session_1?team=team_b',disclosures:['Shared connection'],result:null};
 const f=await fixture(t,()=>({data:state}));
 for(const provider of ['airtable','mercadolibre','netsuite','zettle']) {
  const r=await f.run(['integrations','setup','create','team_b','--provider',provider,'--yes','--json']);assert.equal(r.code,0,r.stderr);assert.deepEqual(json(r).data,state);assert.equal(f.requests.at(-1).url,'/v2/teams/team_b/integration-connection-sessions?team=team_b');assert.deepEqual(JSON.parse(f.requests.at(-1).body),{provider,...(provider==='airtable'?{expected_livemode:false}:{})});
 }
 for(const [action,method,suffix] of [['get','GET',''],['cancel','DELETE',''],['reconcile','POST','/reconcile']]) {
  const r=await f.run(['integrations','setup',action,'team_b','session_1',...(action==='cancel'?['--yes']:[]),'--json']);assert.equal(r.code,0,r.stderr);assert.equal(json(r).data.status,'pending');const req=f.requests.at(-1);assert.equal(req.method,method);assert.equal(req.url,`/v2/teams/team_b/integration-connection-sessions/session_1${suffix}?team=team_b`);if(method!=='GET')assert.deepEqual(JSON.parse(req.body),{});
 }
});
test('setup rejects unsupported providers, credential arguments, mismatched teams and absent confirmation before network', async t=>{
 const f=await fixture(t);
 for(const args of [
 ['create','team_b','--provider','stripe','--yes'],
 ['create','team_b','--provider','airtable','--yes','--api-key','secret'],
 ['create','team_b','--provider','airtable'],
 ['get','team_b','session_1','--team','other'],
 ['cancel','team_b','session_1'],
 ['submit','team_b','session_1'],
 ['resolve','team_b','session_1']
 ]){const r=await f.run(['integrations','setup',...args,'--json']);assert.equal(r.code,1);json(r)}
 assert.equal(f.requests.length,0);
});
test('setup unknown and failure return nonzero without replay or losing exact session state', async t=>{
 let status='outcome_unknown';const f=await fixture(t,()=>({data:{id:'s',status,result:{connected:false,credentials_may_be_stored:true},error:{code:'provider_result_unknown',message:'Unknown'}}}));
 for(const action of ['get','reconcile']){const r=await f.run(['integrations','setup',action,'team_b','s','--json']);assert.equal(r.code,1);assert.equal(json(r).data.status,status);assert.equal(json(r).data.result.credentials_may_be_stored,true)}
 status='failed';assert.equal((await f.run(['integrations','setup','get','team_b','s','--json'])).code,1);
 assert.equal(f.requests.length,3);assert.equal(f.requests.filter(req=>req.method==='POST'&&!new URL(req.url,'http://fixture').pathname.endsWith('/reconcile')).length,0);
});
