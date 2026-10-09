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
const revision = "a".repeat(64);
const webhook = {
  id: "saved",
  url: "https://receiver.invalid",
  events: [],
  status: "inactive",
  description: null,
  owner: "person",
  created_at: 1,
  version: "v2",
  type: null,
  revision,
  effect_scope: "shared_team_webhooks",
  security: {
    header_names: ["Authorization"],
    configured: true,
    status: "configured",
  },
  signing: { enabled: false, configured: false, status: "disabled" },
};
const operation = {
  operation_id: id,
  team_id: "t",
  webhook_id: "saved",
  action: "create",
  status: "completed",
  created_at: 1,
  effect_scope: "shared_team_webhooks",
  secret_attempts: 0,
  error: null,
  credential_delivery: "not_replayed",
};
const create = [
  "webhooks",
  "create",
  "--url",
  webhook.url,
  "--events",
  "",
  "--status",
  "inactive",
  "--operation-id",
  id,
  "--yes",
];
test("configuration CRUD sends exact scoped bodies and projects safe metadata", async (t) => {
  const f = await fixture(t, (req) =>
    req.method === "DELETE"
      ? { data: { deleted: true, secret: "PRIVATE" } }
      : req.method === "GET"
        ? { data: { ...webhook, secret: "PRIVATE" } }
        : {
            data: { ...webhook, secret: "PRIVATE" },
            operation: {
              ...operation,
              action: req.method === "PUT" ? "update" : "create",
            },
            signing_secret: "PRIVATE",
          },
  );
  const runs = [
    await f.run(create),
    await f.run(["webhooks", "get", "saved"]),
    await f.run(["webhooks", "update", "saved", "--stdin", "--yes"], {
      operation_id: id,
      expected_revision: revision,
      events: ["teams.created"],
      version: "v2",
      type: "gigstack_connect",
    }),
    await f.run([
      "webhooks",
      "delete",
      "saved",
      "--expected-revision",
      revision,
      "--yes",
    ]),
  ];
  for (const result of runs) {
    assert.equal(result.code, 0, result.stderr);
    assert.ok(!result.stdout.includes("PRIVATE"));
  }
  assert.deepEqual(
    f.requests.map((r) => ({ method: r.method, path: r.url })),
    [
      { method: "POST", path: "/v2/webhooks?team=t" },
      { method: "GET", path: "/v2/webhooks/saved?team=t" },
      { method: "PUT", path: "/v2/webhooks/saved?team=t" },
      { method: "DELETE", path: "/v2/webhooks/saved?team=t" },
    ],
  );
  assert.deepEqual(f.requests[0].body, {
    url: webhook.url,
    status: "inactive",
    events: [],
    operation_id: id,
  });
  assert.deepEqual(f.requests[2].body, {
    operation_id: id,
    expected_revision: revision,
    events: ["teams.created"],
    version: "v2",
    type: "gigstack_connect",
  });
  assert.deepEqual(f.requests[3].body, { expected_revision: revision });
});
test("empty continuing pages and historical completed receipt with absent endpoint remain truthful", async (t) => {
  const f = await fixture(t, (r) =>
    r.url.includes("configuration-operations")
      ? { data: null, operation }
      : { data: [], has_more: true, next_cursor: "next" },
  );
  let result = await f.run(["webhooks", "list", "--cursor", "previous"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).next_cursor, "next");
  result = await f.run(["webhooks", "configuration-operation", id]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data, null);
  assert.equal(JSON.parse(result.stdout).operation.status, "completed");
});
test("unknown conflict receipt retains safe operation, never retries, and malformed output fails closed", async (t) => {
  let reply = {
    data: null,
    operation: {
      ...operation,
      status: "outcome_unknown",
      error: "webhook_secret_write_unconfirmed",
    },
    secret: "PRIVATE",
  };
  const f = await fixture(t, (r, res) => {
    res.writeHead(r.method === "GET" ? 200 : 409, {
      "content-type": "application/json",
    });
    res.end(JSON.stringify(reply));
    return null;
  });
  let result = await f.run(create);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).operation.status, "outcome_unknown");
  assert.ok(!result.stdout.includes("PRIVATE"));
  assert.equal(f.requests.length, 1);
  for (const patch of [
    { status: "invented" },
    { team_id: "other" },
    { error: { secret: "PRIVATE" } },
    { secret_attempts: { secret: "PRIVATE" } },
    { webhook_id: { secret: "PRIVATE" } },
  ]) {
    reply = { data: null, operation: { ...operation, ...patch } };
    result = await f.run(["webhooks", "configuration-operation", id]);
    assert.equal(result.code, 1);
    assert.ok(!result.stdout.includes("PRIVATE"));
    assert.ok(!result.stderr.includes("PRIVATE"));
  }
});
test("transport loss observes one real POST; no retry or new operation", async (t) => {
  const f = await fixture(t, (_r, res) => {
    res.destroy();
    return null;
  });
  const result = await f.run(create);
  assert.equal(result.code, 1);
  assert.match(result.stdout + result.stderr, /configuration-operation/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].body.operation_id, id);
});
test("invalid secret args, missing stable keys and unconfirmed mutations never send", async (t) => {
  const f = await fixture(t, () => ({ data: webhook, operation }));
  for (const body of [
    { url: webhook.url, events: [] },
    {
      url: webhook.url,
      events: [],
      status: "inactive",
      operation_id: id,
      security: { headers: { Authorization: "PRIVATE" } },
    },
    { url: webhook.url, events: [], status: "active", operation_id: id },
    {
      url: webhook.url,
      events: [],
      status: "inactive",
      operation_id: id,
      signing: { enabled: true },
    },
  ]) {
    const r = await f.run(["webhooks", "create", "--stdin", "--yes"], body);
    assert.equal(r.code, 1);
  }
  assert.equal((await f.run(create.filter((v) => v !== "--yes"))).code, 1);
  assert.equal(
    (
      await f.run(["webhooks", "update", "saved", "--stdin", "--yes"], {
        description: "x",
        operation_id: id,
      })
    ).code,
    1,
  );
  assert.equal(f.requests.length, 0);
});
test("handoff requires current access and explicit trusted environment origin, contains no secrets", async (t) => {
  let access = {
    can_manage: true,
    can_configure: true,
    team_id: "t",
    webhook_id: "saved",
    actor_id: "person",
    revision,
  };
  const f = await fixture(t, () => ({
    data: webhook,
    configuration_access: access,
    secret: "PRIVATE",
  }));
  const args = ["webhooks", "configure", "saved", "--intent", "signing"];
  for (const origin of [
    "",
    "https://evil.invalid",
    "https://app.gigstack.pro",
    "http://localhost/path",
    "http://user@localhost",
  ])
    assert.equal(
      (await f.run(args, undefined, { GIGSTACK_APP_ORIGIN: origin })).code,
      1,
    );
  const r = await f.run(args, undefined, {
    GIGSTACK_APP_ORIGIN: "http://localhost:5173",
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(
    JSON.parse(r.stdout).data.review_url,
    "http://localhost:5173/account/webhooks/saved?team=t&intent=signing",
  );
  assert.ok(!r.stdout.includes("PRIVATE"));
  assert.ok(f.requests.every((v) => v.method === "GET"));
  access = { ...access, can_configure: false };
  assert.equal(
    (
      await f.run(args, undefined, {
        GIGSTACK_APP_ORIGIN: "http://localhost:5173",
      })
    ).code,
    1,
  );
});
test("known stale revision and plan rejection preserve safe recovery instructions", async (t) => {
  let code = "webhook_revision_conflict";
  const f = await fixture(t, (_r, res) => {
    res.writeHead(409, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code, message: "PRIVATE" } }));
    return null;
  });
  let r = await f.run([
    "webhooks",
    "delete",
    "saved",
    "--expected-revision",
    revision,
    "--yes",
  ]);
  assert.equal(r.code, 1);
  assert.match(r.stdout + r.stderr, /webhook_revision_conflict/);
  assert.ok(!(r.stdout + r.stderr).includes("PRIVATE"));
  code = "webhook_plan_required";
  r = await f.run(create);
  assert.equal(r.code, 1);
  assert.match(r.stdout + r.stderr, /webhook_plan_required/);
  assert.ok(!(r.stdout + r.stderr).includes("PRIVATE"));
  assert.equal(f.requests.length, 2);
});
test("agent schema keeps all 26 events and removes private header/signing entry", async (t) => {
  const f = await fixture(t, () => ({}));
  const r = await f.run(["webhooks", "schema", "create"]);
  assert.equal(r.code, 0);
  const schema = JSON.parse(r.stdout);
  assert.equal(schema.properties.events.items.enum.length, 26);
  assert.equal(schema.properties.security, undefined);
  assert.equal(schema.properties.signing, undefined);
  assert.ok(schema.required.includes("operation_id"));
  assert.equal(f.requests.length, 0);
});
