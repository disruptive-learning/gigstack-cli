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


test('branding and portal commands preserve explicit clears, target and full response',async t=>{
 const f=await fixture(t);const cases=[
  [['branding','get','team_b'],'GET','/brand'],[['branding','portal','get','team_b'],'GET','/customer-portal'],
  [['branding','update','team_b','--data','{"voice":null,"alias":""}','--yes'],'PATCH','/brand'],
  [['branding','portal','set','team_b','--data','{"slug":"Next","expected_slug":"previous","confirm_existing_links_change":true}','--yes'],'PUT','/customer-portal'],
  [['branding','analyze-voice','team_b','--url','https://example.test','--yes'],'POST','/brand/analyze-voice'],
  [['branding','remove-logo','team_b','--yes'],'DELETE','/brand/logo'],
 ];for(const [args,method,path]of cases){const r=await f.run([...args,'--json']);assert.equal(r.code,0,r.stderr);json(r);assert.equal(f.requests.at(-1).method,method);assert.equal(f.requests.at(-1).url,'/v2/teams/team_b'+path)}
 assert.deepEqual(JSON.parse(f.requests[2].body),{voice:null,alias:''});assert.deepEqual(JSON.parse(f.requests[4].body),{url:'https://example.test'});
});
test('branding rejects missing confirmation, wrong team, unsafe slugs and credential URLs without requests',async t=>{
 const f=await fixture(t);const cases=[['branding','get','../other'],['branding','get','team_b','--team','other'],['branding','portal','set','team_b','--data','{"slug":"bad-name"}','--yes'],['branding','update','team_b','--data','{"voice":"text"}'],['branding','update','team_b','--data','{"owner":"other"}','--yes'],['branding','analyze-voice','team_b','--url','https://user:password@example.test','--yes'],['branding','remove-logo','team_b']];for(const args of cases){const r=await f.run([...args,'--json']);assert.equal(r.code,1);json(r)}assert.equal(f.requests.length,0);
});
test('logo upload sends local multipart PNG and preserves cleanup status',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'gigstack-logo-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'logo.png');await writeFile(file,'synthetic-image');const f=await fixture(t,()=>({data:{brand:{logo:'synthetic-url'},storage_cleanup:'retained'}}));
 const r=await f.run(['branding','upload-logo','team_b','--file',file,'--yes','--json']);assert.equal(r.code,0,r.stderr);assert.equal(json(r).data.storage_cleanup,'retained');assert.match(f.requests[0].body,/name="file"; filename="logo.png"/);assert.match(f.requests[0].body,/Content-Type: image\/png/);
});
