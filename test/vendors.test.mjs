import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
const cli = new URL("../dist/cli.mjs", import.meta.url).pathname;
const id = "11111111-1111-4111-8111-111111111111";
const token = `fixture.${Buffer.from(JSON.stringify({ livemode: false })).toString("base64url")}.synthetic`;
async function fixture(t, reply) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    requests.push({
      method: req.method,
      url: req.url,
      body: text ? JSON.parse(text) : undefined,
    });
    const response = reply(requests.at(-1), res);
    if (response === null) return;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(response));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  const run = (args, input, env = {}, interactive = false) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        interactive
          ? [
              "--input-type=module",
              "-e",
              "Object.defineProperty(process.stdin,'isTTY',{value:true}); process.execArgv=[]; await import(process.argv[1]);",
              cli,
              ...args,
            ]
          : [cli, ...args, "--json"],
        {
          env: {
            ...process.env,
            GIGSTACK_API_KEY: token,
            GIGSTACK_API_BASE_URL: `http://127.0.0.1:${server.address().port}/v2`,
            GIGSTACK_TEAM: "t",
            ...env,
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(
        interactive ? "s\n" : input === undefined ? "" : JSON.stringify(input),
      );
    });
  return { requests, run };
}

test("vendor CLI creates with saved UUID and projects safe status/handoff",async t=>{
 const f=await fixture(t,req=>({data:req.method==='POST'?{vendor_id:'vendor',master_team_id:'t',owner_id:'owner',operation:{operation_id:id,vendor_id:'vendor',status:'completed',replayed:false},browser_handoff:'https://staging.invalid/account/vendor-onboarding/vendor?team=t',onboarding_url:'SECRET',ciphertext:'SECRET'}:{operation_id:id,status:'not_found',permanent_noncompletion:false,onboarding_url:'SECRET'}}));
 const result=await f.run(['vendors','create','t','--stdin'],{operation_id:id,alias:'Vendor'});assert.equal(result.code,0,result.stderr);assert.ok(!result.stdout.includes('SECRET'));assert.equal(f.requests[0].method,'POST');assert.ok(f.requests[0].url.startsWith('/v2/teams/t/vendors'));assert.equal(f.requests[0].body.operation_id,id);
 const read=await f.run(['vendors','operation','t',id]);assert.equal(read.code,0,read.stderr);assert.equal(JSON.parse(read.stdout).data.status,'not_found');assert.equal(JSON.parse(read.stdout).data.permanent_noncompletion,false);
 const wrong=await f.run(['vendors','create','other','--stdin'],{operation_id:id,alias:'Vendor'});assert.notEqual(wrong.code,0);assert.equal(f.requests.length,2);
 const invalid=await f.run(['vendors','create','t','--stdin'],{operation_id:'invalid',alias:'Vendor'});assert.notEqual(invalid.code,0);assert.equal(f.requests.length,2);
});
test('vendor CLI refuses secret-bearing browser handoff without stdout disclosure',async t=>{const f=await fixture(t,()=>({data:{vendor_id:'vendor',browser_handoff:'https://staging.invalid/account/vendor-onboarding/vendor?team=t&c=SECRET'}}));const result=await f.run(['vendors','capability','t','vendor']);assert.notEqual(result.code,0);assert.ok(!result.stdout.includes('SECRET'));assert.ok(!result.stderr.includes('SECRET'))});
