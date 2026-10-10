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
            GIGSTACK_TEAM: "",
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
const receipt = (action = "test") => ({
  operation_id: id,
  action,
  team_id: "t",
  livemode: false,
  endpoint_id: "saved",
  delivery_id: `manual-${"a".repeat(64)}`,
  log_id: `manual-${"a".repeat(64)}`,
  submission: "submitted",
  delivery: "pending",
  attempts: 0,
  duplicate_delivery_possible: true,
  payload_semantics:
    action === "retry" ? "stored_event_snapshot" : "current_resource",
  v2_state: "current_at_delivery",
});
test("four manual commands capture exact team/mode/path, persisted UUID and safe receipt", async (t) => {
  let response = receipt();
  const f = await fixture(t, () => ({
    data: { ...response, headers: { Authorization: "PRIVATE" } },
  }));
  for (const action of ["test", "resend-current", "retry", "operation"]) {
    response = receipt(
      action === "operation" ? "test" : action.replace("-", "_"),
    );
    const input = {
      operation_id: id,
      confirmed: true,
      ...(["test", "resend-current"].includes(action)
        ? { event: "payment.created", resource_id: "payment" }
        : {}),
      ...(["retry", "resend-current"].includes(action)
        ? { acknowledge_duplicate_delivery: true }
        : {}),
      ...(action === "resend-current" ? { log_id: "original" } : {}),
    };
    const args = [
      "webhooks",
      action,
      "t",
      action === "operation" ? id : action === "retry" ? "original" : "saved",
      ...(action === "operation" ? [] : ["--stdin", "--yes"]),
    ];
    const result = await f.run(
      args,
      action === "operation" ? undefined : input,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.includes("PRIVATE"), false);
    assert.deepEqual(JSON.parse(result.stdout).data, response);
    const request = f.requests.at(-1);
    assert.equal(request.method, action === "operation" ? "GET" : "POST");
    assert.equal(
      request.url,
      action === "operation"
        ? `/v2/teams/t/webhook-operations/${id}?expected_livemode=false&team=t`
        : action === "retry"
          ? "/v2/teams/t/webhook-deliveries/original/retry?team=t"
          : `/v2/webhooks/saved/${action}?team=t`,
    );
    assert.deepEqual(
      request.body,
      action === "operation"
        ? undefined
        : { ...input, expected_livemode: false },
    );
  }
});
test("manual failure and malformed result cannot masquerade as success or expose provider data", async (t) => {
  let patch;
  const f = await fixture(t, () => ({ data: { ...receipt(), ...patch } }));
  for (patch of [
    { submission: "unknown" },
    { submission: "prevented", delivery: "failed" },
    { submission: "invented" },
    { team_id: "foreign" },
    { livemode: true },
    { log_id: "foreign" },
    { delivery_id: "generic" },
    { attempts: { secret: "PRIVATE" } },
    { submission: "prevented", delivery: "pending" },
  ]) {
    const before = f.requests.length;
    const result = await f.run(
      ["webhooks", "test", "t", "saved", "--yes", "--stdin"],
      {
        operation_id: id,
        confirmed: true,
        event: "payment.created",
        resource_id: "payment",
      },
    );
    assert.equal(result.code, 1);
    assert.equal(result.stdout.includes("PRIVATE"), false);
    assert.equal(f.requests.length, before + 1);
  }
});
test("manual selectors and confirmations reject missing UUID, duplicate ack and raw mode/payload injection before HTTP", async (t) => {
  const f = await fixture(t, () => ({ data: receipt() }));
  const input = {
    operation_id: id,
    confirmed: true,
    event: "payment.created",
    resource_id: "payment",
  };
  for (const patch of [
    { operation_id: undefined },
    { confirmed: false },
    { event: "sat.invoice.synced" },
    { expected_livemode: false },
    { endpoint_id: "override" },
    { security: { headers: { Authorization: "PRIVATE" } } },
  ]) {
    assert.equal(
      (
        await f.run(["webhooks", "test", "t", "saved", "--yes", "--stdin"], {
          ...input,
          ...patch,
        })
      ).code,
      1,
    );
  }
  assert.equal(
    (
      await f.run(["webhooks", "retry", "t", "original", "--yes", "--stdin"], {
        operation_id: id,
        confirmed: true,
      })
    ).code,
    1,
  );
  assert.equal(f.requests.length, 0);
});
test("transport loss after one real POST reports unknown and never retries", async (t) => {
  const f = await fixture(t, (_req, res) => {
    res.destroy();
    return null;
  });
  const result = await f.run(
    ["webhooks", "test", "t", "saved", "--yes", "--stdin"],
    {
      operation_id: id,
      confirmed: true,
      event: "payment.created",
      resource_id: "payment",
    },
  );
  assert.equal(result.code, 1);
  assert.equal(f.requests.length, 1);
  assert.match(result.stdout + result.stderr, /unknown|incierto|confirm|red/i);
});
test("interactive confirmation states selected team, mode, action, target and persisted UUID", async (t) => {
  const f = await fixture(t, () => ({ data: receipt() }));
  const result = await f.run(
    [
      "webhooks",
      "test",
      "t",
      "saved",
      "--data",
      JSON.stringify({
        operation_id: id,
        confirmed: true,
        event: "payment.created",
        resource_id: "payment",
      }),
    ],
    undefined,
    {},
    true,
  );
  assert.equal(result.code, 0, result.stderr);
  for (const value of [
    "equipo t",
    "modo test",
    "destino/log saved",
    id,
    "efectos reales",
  ])
    assert.ok((result.stdout + result.stderr).includes(value), value);
});
