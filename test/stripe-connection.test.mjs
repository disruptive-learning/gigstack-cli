import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
const cli = new URL("../dist/cli.mjs", import.meta.url).pathname,
  op = "12345678-1234-4123-8123-123456789abc",
  token = `fixture.${Buffer.from(JSON.stringify({ livemode: false })).toString("base64url")}.synthetic`;
const receipt = {
  operation_id: op,
  team_id: "team_test",
  billing_account_id: "account",
  livemode: false,
  expected_generation: 0,
  generation: null,
  status: "pending",
  method: "manual_key",
  provider_revocation: "not_performed",
  provider_webhook_removal: "not_performed",
  browser_handoff_url: `https://app.gigstack.pro/account/stripe-connection/${op}?team=team_test&livemode=false`,
  secret_key: "SYNTHETIC_SECRET",
  access_token: "SYNTHETIC_SECRET",
};
async function fixture(t) {
  const requests = [];
  let reply = receipt;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push({
      method: req.method,
      url: req.url,
      bearer: req.headers.authorization,
      body: raw ? JSON.parse(raw) : undefined,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: reply }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  return {
    requests,
    setReply: (v) => (reply = v),
    run: (args) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [cli, "stripe-connection", ...args, "--json"],
          {
            env: {
              ...process.env,
              GIGSTACK_API_KEY: token,
              GIGSTACK_API_BASE_URL: `http://127.0.0.1:${server.address().port}/v2`,
              GIGSTACK_TEAM: "team_test",
            },
          },
        );
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (b) => (stdout += b));
        child.stderr.on("data", (b) => (stderr += b));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      }),
  };
}
test("actual CLI saves caller UUID, explicit credential mode, JSON transport and safe output; readback is GET only", async (t) => {
  const f = await fixture(t);
  const prepare = await f.run([
    "prepare",
    "team_test",
    "--data",
    JSON.stringify({
      operation_id: op,
      method: "manual_key",
      expected_generation: 0,
    }),
  ]);
  assert.equal(prepare.code, 0, prepare.stderr + prepare.stdout);
  assert.equal(prepare.stdout.includes("SYNTHETIC_SECRET"), false);
  assert.deepEqual(f.requests[0].body, {
    operation_id: op,
    method: "manual_key",
    expected_generation: 0,
    livemode: false,
  });
  assert.equal(f.requests[0].bearer, `Bearer ${token}`);
  assert.match(
    f.requests[0].url,
    /\/v2\/teams\/team_test\/integrations\/stripe\/connection-sessions/,
  );
  const read = await f.run(["operation", "team_test", op]);
  assert.equal(read.code, 0, read.stderr + read.stdout);
  assert.equal(f.requests[1].method, "GET");
  assert.equal(f.requests[1].body, undefined);
  assert.match(f.requests[1].url, /livemode=false/);
});
test("actual CLI rejects private secret input, mismatched mode and response scope before safe stdout", async (t) => {
  const f = await fixture(t);
  for (const input of [
    {
      operation_id: op,
      method: "manual_key",
      expected_generation: 0,
      secret_key: "NEVER_SEND",
    },
    {
      operation_id: op,
      method: "manual_key",
      expected_generation: 0,
      livemode: true,
    },
  ]) {
    const out = await f.run([
      "prepare",
      "team_test",
      "--data",
      JSON.stringify(input),
    ]);
    assert.notEqual(out.code, 0);
  }
  assert.equal(f.requests.length, 0);
  f.setReply({ ...receipt, team_id: "other" });
  const out = await f.run(["operation", "team_test", op]);
  assert.notEqual(out.code, 0);
  assert.equal(out.stdout.includes("SYNTHETIC_SECRET"), false);
});
test("actual CLI cancel and local disconnect send finite bodies and never claim provider revocation", async (t) => {
  const f = await fixture(t);
  f.setReply({ ...receipt, status: "cancelled" });
  const cancelled = await f.run(["cancel", "team_test", op]);
  assert.equal(cancelled.code, 0, cancelled.stderr + cancelled.stdout);
  assert.deepEqual(f.requests[0].body, { livemode: false });
  f.setReply({
    ...receipt,
    status: "completed",
    generation: 1,
    local_credentials_removed: true,
  });
  const disconnected = await f.run([
    "disconnect",
    "team_test",
    "--yes",
    "--data",
    JSON.stringify({ operation_id: op, expected_generation: 0 }),
  ]);
  assert.equal(disconnected.code, 0, disconnected.stderr + disconnected.stdout);
  assert.deepEqual(f.requests[1].body, {
    operation_id: op,
    expected_generation: 0,
    livemode: false,
  });
  assert.equal(
    JSON.parse(disconnected.stdout).data.provider_revocation,
    "not_performed",
  );
});
