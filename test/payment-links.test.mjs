import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const link = {
  id: "plink_saved",
  team_id: "t",
  livemode: false,
  status: "active",
  currency: "MXN",
  items: [
    {
      total: 100,
      quantity: 2,
      taxes: [{ type: "IVA", rate: "0.16", inclusive: true }],
    },
  ],
  amount: 20000,
  total: 200,
  url: "https://g-portal-staging.web.app/paymentLinks/plink_saved",
  short_url: null,
  owner: "p",
  created_at: 1,
  updated_at: 1,
  deleted_at: null,
  revision,
  effect_scope: "team_mode_payment_link",
};
link.items[0].amounts = {
  taxes: link.items[0].taxes,
  subtotal: 100,
  total: 100,
  includedTaxes: 0,
  excludedTaxes: 16,
  withholdedTaxes: 0,
};
const operation = {
  operation_id: id,
  team_id: "t",
  livemode: false,
  action: "create",
  payment_link_id: link.id,
  status: "completed",
  completed_at: 1,
  revision,
  effect_scope: "team_mode_payment_link",
};
test("full link configuration, selected scope, pagination and historical receipt are preserved", async (t) => {
  const f = await fixture(t, (req) =>
    req.method === "GET"
      ? req.url.includes("/operations/")
        ? { data: null, operation }
        : req.url.includes("plink_saved")
          ? { data: link }
          : { data: [], has_more: true, next_cursor: "next", livemode: false }
      : {
          data: link,
          operation: {
            ...operation,
            action:
              req.method === "POST"
                ? "create"
                : req.method === "PATCH"
                  ? "update"
                  : "delete",
          },
        },
  );
  for (const [args, input] of [
    [
      ["payment-links", "create", "--stdin", "--operation-id", id, "--yes"],
      {
        currency: "MXN",
        items: link.items,
        custom_method_types: [{ id: "bank" }],
      },
    ],
    [
      [
        "payment-links",
        "update",
        link.id,
        "--stdin",
        "--operation-id",
        id,
        "--expected-revision",
        revision,
        "--yes",
      ],
      { description: "updated" },
    ],
    [
      [
        "payment-links",
        "delete",
        link.id,
        "--operation-id",
        id,
        "--expected-revision",
        revision,
        "--yes",
      ],
    ],
    [["payment-links", "get", link.id]],
    [["payment-links", "list", "--limit", "1", "--cursor", "prior"]],
    [["payment-links", "operation", id]],
  ]) {
    const r = await f.run(args, input);
    assert.equal(r.code, 0, r.stdout + r.stderr);
  }
  assert.equal(f.requests.length, 6);
  assert.equal(f.requests[0].body.expected_livemode, false);
  assert.deepEqual(f.requests[0].body.items, link.items);
  assert.equal(f.requests[1].method, "PATCH");
  assert.equal(f.requests[2].method, "DELETE");
  for (const r of f.requests) assert.match(r.url, /team=t/);
});
test("malformed or wrong-scope receipt cannot become success; known business data retained, internals removed", async (t) => {
  let response = {
    data: link,
    operation: {
      ...operation,
      input: { PRIVATE: "secret" },
      actor_hash: "PRIVATE",
    },
  };
  const f = await fixture(t, () => response);
  let r = await f.run(["payment-links", "operation", id]);
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.stdout, /PRIVATE/);
  for (const change of [
    { status: "pending" },
    { livemode: true },
    { completed_at: { PRIVATE: "value" } },
    { payment_link_id: "other" },
  ]) {
    response = { data: link, operation: { ...operation, ...change } };
    r = await f.run(["payment-links", "operation", id]);
    assert.notEqual(r.code, 0);
    assert.doesNotMatch(r.stdout, /PRIVATE/);
  }
  response = { data: null, operation };
  r = await f.run(["payment-links", "create", "--stdin", "--yes"], {
    operation_id: id,
    currency: "MXN",
    items: link.items,
  });
  assert.notEqual(r.code, 0);
});
test("stable UUID, current revision, confirmation and mode are enforced before writes", async (t) => {
  const f = await fixture(t, () => ({ data: link, operation }));
  for (const input of [
    { currency: "MXN", items: link.items },
    {
      operation_id: id,
      currency: "MXN",
      items: link.items,
      expected_livemode: true,
    },
    { operation_id: id, currency: "MXN", items: link.items, owner: "foreign" },
    { operation_id: id, currency: "MXN", items: [{ total: -1 }] },
  ]) {
    const r = await f.run(
      ["payment-links", "create", "--stdin", "--yes"],
      input,
    );
    assert.notEqual(r.code, 0, r.stdout);
  }
  let r = await f.run(
    [
      "payment-links",
      "update",
      link.id,
      "--stdin",
      "--operation-id",
      id,
      "--expected-revision",
      revision,
      "--yes",
    ],
    {},
  );
  assert.notEqual(r.code, 0);
  r = await f.run(["payment-links", "create", "--stdin"], {
    operation_id: id,
    currency: "MXN",
    items: link.items,
  });
  assert.notEqual(r.code, 0);
  assert.equal(f.requests.length, 0);
});
test("actual lost transport sends one POST and directs readback instead of retry", async (t) => {
  const f = await fixture(t, (_r, res) => {
    res.socket.destroy();
    return null;
  });
  const r = await f.run(["payment-links", "create", "--stdin", "--yes"], {
    operation_id: id,
    currency: "MXN",
    items: link.items,
  });
  assert.notEqual(r.code, 0);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].method, "POST");
  assert.match(r.stdout, /unknown|incierto|desconocido|outcome/i);
});

test("saved counters and references retain unknown states and discard unrelated private fields", async (t) => {
  const historical_references = {
    invoices: ["invoice_a", "invoice_a"],
    receipts: null,
    unresolved_count: 1,
    authorization: "resolve_each_resource",
  };
  const f = await fixture(t, () => ({
    data: {
      ...link,
      views: 0,
      historical_references: {
        ...historical_references,
        secret: "never return",
      },
    },
  }));
  const result = await f.run(["payment-links", "get", link.id]);
  assert.equal(result.code, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.data.views, 0);
  assert.deepEqual(body.data.historical_references, historical_references);
  assert.equal(result.stdout.includes("never return"), false);
  assert.equal(f.requests.length, 1);
});

test("history command reads exact independently scoped document and strips private row fields", async (t) => {
  const data = {
    resource_type: "invoices",
    resource_id: "invoice_one",
    team_id: "t",
    livemode: false,
    storage_project_id: "gigstackprodev",
    file_status: { pdf: "unavailable", xml: "unavailable" },
    document: {
      id: "invoice_one",
      team: "t",
      livemode: false,
      total: 100,
      currency: "MXN",
      items: [],
      private_secret: "NEVER_RETURN",
      files: { pdf: null, xml: null },
    },
  };
  const { requests, run } = await fixture(t, () => ({ success: true, data }));
  const ok = await run([
    "payment-links",
    "history",
    "plink_saved",
    "invoices",
    "invoice_one",
  ]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(requests[0].method, "GET");
  assert.match(
    requests[0].url,
    /\/payments\/links\/plink_saved\/history\/invoices\/invoice_one/,
  );
  assert.equal(ok.stdout.includes("NEVER_RETURN"), false);
  data.team_id = "foreign";
  const denied = await run([
    "payment-links",
    "history",
    "plink_saved",
    "invoices",
    "invoice_one",
  ]);
  assert.notEqual(denied.code, 0);
  const before = requests.length;
  const invalid = await run([
    "payment-links",
    "history",
    "plink_saved",
    "invoices",
    "../invoice_one",
  ]);
  assert.notEqual(invalid.code, 0);
  assert.equal(requests.length, before);
});

test("historical reads retain all real emitted public invoice and receipt fields", async (t) => {
  const fixtures = JSON.parse(
    readFileSync(
      new URL("./history-response.fixture.json", import.meta.url),
      "utf8",
    ),
  );
  let data;
  const { run } = await fixture(t, () => ({ success: true, data }));
  for (const saved of fixtures) {
    data = {
      ...saved,
      team_id: "t",
      document: { ...saved.document, team: "t" },
    };
    const result = await run([
      "payment-links",
      "history",
      "plink_saved",
      data.resource_type,
      data.resource_id,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).data, data);
  }
});
test("historical file command writes verified existing bytes and never overwrites an existing artifact", async (t) => {
  const content = Buffer.from("%PDF existing").toString("base64");
  const data = {
    resource_type: "invoices",
    resource_id: "invoice_one",
    team_id: "t",
    livemode: false,
    storage_project_id: "gigstackprodev",
    available: true,
    file: {
      kind: "pdf",
      filename: "invoice_one.pdf",
      type: "application/pdf",
      content,
      size_bytes: 13,
    },
  };
  const { run, requests } = await fixture(t, () => ({ success: true, data }));
  const output = join(
    mkdtempSync(join(tmpdir(), "gigstack-history-file-")),
    "invoice.pdf",
  );
  const args = [
    "payment-links",
    "history-file",
    "plink_saved",
    "invoices",
    "invoice_one",
    "pdf",
    "--output",
    output,
  ];
  const result = await run(args);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(readFileSync(output, "utf8"), "%PDF existing");
  assert.equal(result.stdout.includes(content), false);
  assert.match(requests[0].url, /\/history\/invoices\/invoice_one\/files\/pdf/);
  assert.equal(requests[0].method, "GET");
  const repeat = await run(args);
  assert.notEqual(repeat.code, 0);
  assert.equal(readFileSync(output, "utf8"), "%PDF existing");
  data.file.filename = "foreign.pdf";
  const wrong = await run([...args.slice(0, -1), output + ".wrong"]);
  assert.notEqual(wrong.code, 0);
});
