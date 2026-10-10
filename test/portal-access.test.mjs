import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
const cli = new URL("../dist/cli.mjs", import.meta.url).pathname;
const operation = "47b6b682-c852-4f91-8407-c66e6794c141";
const token = `fixture.${Buffer.from(JSON.stringify({ livemode: false })).toString("base64url")}.synthetic`;
const data = (family) => ({
  operation_id: operation,
  family,
  team_id: "team_test",
  client_id: family === "customer" ? "client_one" : null,
  replaces_operation_id: null,
  livemode: false,
  status: "prepared",
  created_at: 1,
  preparation_expires_at: 2,
  expires_at: null,
  access_lifetime_seconds: family === "customer" ? 432000 : 3600,
  exchanged_session_lifetime_seconds: family === "customer" ? 259200 : null,
  scopes:
    family === "customer"
      ? ["customer:read", "customer:update", "files:download", "session:renew"]
      : ["invoices:read"],
  effects:
    family === "customer"
      ? [
          "customer_data_read",
          "customer_data_update",
          "invoice_receipt_payment_read",
          "file_download_or_render",
          "session_validation",
        ]
      : ["invoice_read", "invoice_file_download"],
  secret_available: false,
  browser_handoff: {
    kind: "private_browser_review",
    url: `https://app.gigstack.pro/account/portal-access/${family}/${operation}?team=team_test`,
    proof: "strip",
  },
  recovery: "read_current_operation",
  token: "never-output",
});
async function fixture(t) {
  const requests = [];
  let reply = data("customer");
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      method: req.method,
      url: req.url,
      body: body ? JSON.parse(body) : undefined,
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
    setReply(v) {
      reply = v;
    },
    run(args) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cli, ...args, "--json"], {
          env: {
            ...process.env,
            GIGSTACK_API_KEY: token,
            GIGSTACK_API_BASE_URL: `http://127.0.0.1:${server.address().port}/v2`,
            GIGSTACK_TEAM: "team_test",
          },
        });
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (b) => (stdout += b));
        child.stderr.on("data", (b) => (stderr += b));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      });
    },
  };
}
test("both families prepare/get/cancel preserve full safe scope with no machine execution", async (t) => {
  const f = await fixture(t);
  for (const family of ["customer", "invoices"])
    for (const action of ["prepare", "get", "cancel"]) {
      f.setReply(data(family));
      const args = [
        "portal-access",
        family,
        action,
        "team_test",
        ...(action === "prepare"
          ? [
              "--data",
              JSON.stringify({
                operation_id: operation,
                ...(family === "customer" ? { client_id: "client_one" } : {}),
              }),
            ]
          : [operation]),
      ];
      const result = await f.run(args);
      assert.equal(result.code, 0, result.stderr + result.stdout);
      const out = JSON.parse(result.stdout).data;
      assert.equal(out.family, family);
      assert.deepEqual(out.effects, data(family).effects);
      assert.equal(
        out.exchanged_session_lifetime_seconds,
        data(family).exchanged_session_lifetime_seconds,
      );
      assert.doesNotMatch(result.stdout, /never-output|strip/);
      const req = f.requests.at(-1);
      assert.equal(
        req.method,
        action === "prepare" ? "POST" : action === "get" ? "GET" : "DELETE",
      );
      assert.equal(
        new URL(req.url, "http://fixture").searchParams.get("livemode"),
        "false",
      );
    }
  assert.equal(f.requests.length, 6);
});
test("wrong identity refuses output; retired raw issuers and private terminal actions make no HTTP", async (t) => {
  const f = await fixture(t);
  f.setReply({
    ...data("customer"),
    operation_id: "57b6b682-c852-4f91-8407-c66e6794c141",
  });
  let result = await f.run([
    "portal-access",
    "customer",
    "get",
    "team_test",
    operation,
  ]);
  assert.notEqual(result.code, 0);
  assert.doesNotMatch(result.stdout, /never-output/);
  const count = f.requests.length;
  for (const args of [
    ["clients", "portal"],
    ["teams", "portal-token", "team_test"],
    ["portal-access", "customer", "execute", "team_test", operation],
  ]) {
    result = await f.run(args);
    assert.notEqual(result.code, 0);
  }
  assert.equal(f.requests.length, count);
});
