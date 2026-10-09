import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { createServer } from "node:http";
const token = `fixture.${Buffer.from(JSON.stringify({ livemode: false })).toString("base64url")}.synthetic`;
const cli = new URL("../dist/cli.mjs", import.meta.url).pathname;
test("CLI reminder schema advertises strict full replacement and reviewed recovery without machine execute", () => {
  for (const action of ["configure", "recovery_prepare"]) {
    const run = spawnSync(
      process.execPath,
      [cli, "payment-reminders", "schema", action, "--json"],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    const schema = JSON.parse(run.stdout);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.reminders.maxItems, 100);
    assert.ok(schema.required.includes("expected_revision"));
  }
  const run = spawnSync(
    process.execPath,
    [cli, "payment-reminders", "--help"],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0);
  assert.match(run.stdout, /prepare-recovery/);
  assert.doesNotMatch(run.stdout, /execute-recovery|review-challenge/);
});
test("machine schema excludes browser challenge and execute fields", () => {
  const schema = JSON.parse(
    readFileSync(
      new URL(
        "../src/contracts/payment-reminder-request.schema.json",
        import.meta.url,
      ),
    ),
  );
  assert.deepEqual(Object.keys(schema), ["configure", "recovery_prepare"]);
  assert.deepEqual(
    Object.keys(schema.configure.properties).sort(),
    [
      "operation_id",
      "expected_livemode",
      "expected_revision",
      "reminders",
      "limitDaysToPay",
    ].sort(),
  );
  assert.ok(!JSON.stringify(schema).includes("review_challenge"));
});

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
test("actual CLI mutation preserves UUID/mode/scope and uncertain writes are not retried", async (t) => {
  const id = "11111111-1111-4111-8111-111111111111";
  const hash = "a".repeat(64);
  const { run, requests } = await fixture(t, () => ({
    success: false,
    error: {
      code: "payment_reminder_outcome_unconfirmed",
      message: "read saved UUID",
    },
  }));
  const body = { operation_id: id, expected_revision: hash, reminders: [] };
  const attempt = await run(
    ["payment-reminders", "replace", "t", "pay1", "--stdin", "--yes"],
    body,
  );
  assert.notEqual(attempt.code, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "PUT");
  assert.match(requests[0].url, /payments\/pay1\/reminders/);
  assert.equal(requests[0].body.operation_id, id);
  assert.equal(requests[0].body.expected_livemode, false);
  const forged = await run(
    ["payment-reminders", "replace", "t", "pay1", "--stdin", "--yes"],
    { ...body, expected_livemode: true },
  );
  assert.notEqual(forged.code, 0);
  assert.equal(requests.length, 1);
});
