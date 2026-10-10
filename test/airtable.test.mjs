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
const receipt = {
  id,
  team_id: "t",
  created_at: 1,
  updated_at: 2,
  processed_count: 0,
  remote_deleted_count: 0,
  error_code: null,
  webhook_id: null,
  recovery_operation_id: null,
  cleanup_operation_id: null,
  provider_environment: "production",
  oauth_credentials_retained: true,
  action: "disconnect",
  livemode: false,
  effect_scope: "shared_connection",
  status: "processing",
  snapshot_complete: false,
  target_count: 100,
  local_disabled_count: 100,
  unknown_count: 0,
  continuation_required: true,
  partial_cleanup: false,
  recovery_session_id: null,
  targets: { data: [], has_more: true, next_cursor: "targets2" },
};
const local = {
  data: [],
  has_more: true,
  next_cursor: "next",
  scope: "mode",
  livemode: false,
  provider_environment: "production",
  can_manage: true,
  can_recover_registration: true,
  blocking_operation_id: id,
  connection: {
    connected: false,
    restricted: true,
    recovery_session_id: null,
    identity_verification: null,
    effect_scope: "shared_connection",
    oauth_credentials_retained: true,
  },
};
test("nine named Airtable actions preserve exact requests, mode, stable IDs and partial/empty pagination", async (t) => {
  const f = await fixture(t, (req) => ({
    success: true,
    data: {
      ...(req.url.includes("/operations") || req.method !== "GET"
        ? receipt
        : req.url.includes("/webhooks?")
          ? local
          : {
              data: [],
              has_more: true,
              next_cursor: "next",
              provider_environment: "production",
              effect_scope: "shared_connection",
            }),
      credentials: "DO_NOT_RETURN",
      notificationUrl: "DO_NOT_RETURN",
    },
  }));
  const cases = [
    [
      ["bases", "t", "--cursor", "next"],
      "GET",
      "/bases?cursor=next&team=t",
      undefined,
    ],
    [["tables", "t", "base"], "GET", "/bases/base/tables?team=t", undefined],
    [
      [
        "webhooks",
        "list",
        "t",
        "--scope",
        "shared",
        "--limit",
        "1",
        "--cursor",
        "next",
      ],
      "GET",
      "/webhooks?scope=shared&cursor=next&limit=1&team=t",
      undefined,
    ],
    [
      ["webhooks", "remote", "t", "base"],
      "GET",
      "/bases/base/webhooks/remote?team=t",
      undefined,
    ],
    [
      ["webhooks", "register", "t", "--stdin", "--yes"],
      "POST",
      "/webhooks?team=t",
      {
        operation_id: id,
        confirmed: true,
        base_id: "base",
        table_id: "table",
        field_map: { amount: "Amount" },
      },
    ],
    [
      ["webhooks", "unregister", "t", "hook", "--stdin", "--yes"],
      "DELETE",
      "/webhooks/hook?team=t",
      { operation_id: id, confirmed: true },
    ],
    [
      ["disconnect", "t", "--stdin", "--yes"],
      "POST",
      "/disconnect?team=t",
      {
        operation_id: id,
        confirmed: true,
        acknowledge_shared_connection: true,
      },
    ],
    [
      ["operations", "get", "t", id, "--limit", "1", "--cursor", "targets2"],
      "GET",
      `/operations/${id}?limit=1&cursor=targets2&team=t`,
      undefined,
    ],
    [
      ["operations", "reconcile", "t", id],
      "POST",
      `/operations/${id}/reconcile?team=t`,
      {},
    ],
  ];
  for (const [args, method, path, input] of cases) {
    const result = await f.run(["integrations", "airtable", ...args], input);
    assert.equal(result.code, 0, result.stderr + result.stdout);
    const request = f.requests.at(-1);
    assert.equal(request.method, method);
    assert.equal(request.url, "/v2/teams/t/integrations/airtable" + path);
    assert.deepEqual(
      request.body,
      input === undefined
        ? undefined
        : args[0] === "operations"
          ? {}
          : { ...input, expected_livemode: false },
    );
    assert.ok(!result.stdout.includes("DO_NOT_RETURN"));
    const data = JSON.parse(result.stdout).data;
    assert.equal(data.has_more ?? data.targets.has_more, true);
  }
});
test("uncertain actual transport sends one POST, emits unknown and does not replay", async (t) => {
  const f = await fixture(t, (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.flushHeaders();
    return null;
  });
  const r = await f.run(
    ["integrations", "airtable", "disconnect", "t", "--stdin", "--yes"],
    { operation_id: id, confirmed: true, acknowledge_shared_connection: true },
    { GIGSTACK_API_TIMEOUT_MS: "1000" },
  );
  assert.equal(r.code, 1);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].method, "POST");
  assert.match(r.stdout, /unknown/);
  assert.match(r.stdout, /incomplete_response/);
});
test("unknown remote outcome is nonzero and preserves receipt without retries or secret fields", async (t) => {
  const f = await fixture(t, () => ({
    data: {
      ...receipt,
      status: "outcome_unknown",
      unknown_count: 1,
      partial_cleanup: true,
      token: "DO_NOT_RETURN",
    },
  }));
  const r = await f.run([
    "integrations",
    "airtable",
    "operations",
    "reconcile",
    "t",
    id,
  ]);
  assert.equal(r.code, 1);
  assert.equal(f.requests.length, 1);
  const data = JSON.parse(r.stdout).data;
  assert.equal(data.unknown_count, 1);
  assert.equal(data.targets.next_cursor, "targets2");
  assert.ok(!r.stdout.includes("DO_NOT_RETURN"));
});
test("missing stable UUID, mode override, secrets and absent explicit confirmation fail before HTTP", async (t) => {
  const f = await fixture(t, () => {
    throw Error("No network expected");
  });
  for (const [args, input] of [
    [
      ["disconnect", "t", "--stdin", "--yes"],
      { confirmed: true, acknowledge_shared_connection: true },
    ],
    [
      ["disconnect", "t", "--stdin", "--yes"],
      { operation_id: id, confirmed: true },
    ],
    [
      ["disconnect", "t", "--stdin", "--yes"],
      {
        operation_id: id,
        confirmed: true,
        acknowledge_shared_connection: true,
        expected_livemode: true,
      },
    ],
    [
      ["disconnect", "t", "--stdin", "--yes"],
      {
        operation_id: id,
        confirmed: true,
        acknowledge_shared_connection: true,
        access_token: "SECRET",
      },
    ],
    [
      ["webhooks", "unregister", "t", "hook", "--stdin", "--yes"],
      { operation_id: id, confirmed: true, webhook_id: "other" },
    ],
    [
      ["disconnect", "t", "--stdin"],
      {
        operation_id: id,
        confirmed: true,
        acknowledge_shared_connection: true,
      },
    ],
    [
      ["disconnect", "t", "--stdin", "--yes", "--expected-mode", "live"],
      {
        operation_id: id,
        confirmed: true,
        acknowledge_shared_connection: true,
      },
    ],
  ]) {
    const r = await f.run(["integrations", "airtable", ...args], input);
    assert.equal(r.code, 1, r.stdout);
  }
  assert.equal(f.requests.length, 0);
});
test("recovery setup has paired explicit acknowledgment, mode assertion and metadata-only limited readback", async (t) => {
  const f = await fixture(t, () => ({
    data: {
      id: "session",
      status: "completed",
      result: { connected: false, credentials_may_be_stored: true },
      recovery: {
        operation_id: id,
        identity_verification: "same",
        imports_disabled: true,
        secret: "DO_NOT_RETURN",
      },
      credentials: "DO_NOT_RETURN",
      recovery_binding: { secret: "DO_NOT_RETURN" },
    },
  }));
  const r = await f.run([
    "integrations",
    "setup",
    "create",
    "t",
    "--provider",
    "airtable",
    "--recovery-operation-id",
    id,
    "--acknowledge-unconfirmed-effects",
    "--yes",
  ]);
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(f.requests[0].body, {
    provider: "airtable",
    expected_livemode: false,
    recovery_operation_id: id,
    acknowledge_unconfirmed_effects: true,
  });
  assert.equal(JSON.parse(r.stdout).data.result.connected, false);
  assert.ok(!r.stdout.includes("DO_NOT_RETURN"));
  const denied = await f.run([
    "integrations",
    "setup",
    "create",
    "t",
    "--provider",
    "airtable",
    "--recovery-operation-id",
    id,
    "--yes",
  ]);
  assert.equal(denied.code, 1);
  assert.equal(f.requests.length, 1);
});

test("malformed operation states, numeric counters, IDs and paging fail closed without leaking nested objects", async (t) => {
  let data = { ...receipt };
  const f = await fixture(t, () => ({ data, timestamp: 1234 }));
  for (const patch of [
    { status: "anything" },
    { status: undefined },
    { id: { secret: "DO_NOT_RETURN" } },
    { target_count: { secret: "DO_NOT_RETURN" } },
    { error_code: { secret: "DO_NOT_RETURN" } },
    { targets: { data: [], has_more: "yes", next_cursor: null } },
  ]) {
    data = { ...receipt, ...patch };
    const r = await f.run([
      "integrations",
      "airtable",
      "operations",
      "get",
      "t",
      id,
    ]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /invalid_airtable_response/);
    assert.ok(!r.stdout.includes("DO_NOT_RETURN"));
    assert.ok(!r.stdout.includes('"success": true'));
  }
  data = { ...receipt };
  const valid = await f.run([
    "integrations",
    "airtable",
    "operations",
    "get",
    "t",
    id,
  ]);
  assert.equal(valid.code, 0, valid.stdout);
  assert.equal(JSON.parse(valid.stdout).timestamp, 1234);
});
test("CLI schema excludes mode and route identifiers derived outside JSON", async (t) => {
  const f = await fixture(t, () => {
    throw Error("No HTTP expected");
  });
  const r = await f.run(["integrations", "airtable", "schema", "unregister"]);
  assert.equal(r.code, 0, r.stdout);
  const schema = JSON.parse(r.stdout);
  assert.equal(schema.properties.expected_livemode, undefined);
  assert.equal(schema.properties.webhook_id, undefined);
  assert.match(schema.description, /--expected-mode/);
  assert.equal(f.requests.length, 0);
});

test("actual interactive mutation prompt names selected team, credential mode, UUID and shared scope", async (t) => {
  const f = await fixture(t, () => ({ data: receipt, timestamp: 1234 }));
  const r = await f.run(
    [
      "integrations",
      "airtable",
      "disconnect",
      "t",
      "--data",
      JSON.stringify({
        operation_id: id,
        confirmed: true,
        acknowledge_shared_connection: true,
      }),
    ],
    undefined,
    {},
    true,
  );
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /equipo t/);
  assert.match(r.stderr, /modo test/);
  assert.ok(r.stderr.includes(id));
  assert.match(r.stderr, /compartido/);
  assert.equal(f.requests.length, 1);
});
