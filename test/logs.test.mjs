import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  writeFile,
  readFile,
  stat,
  rm,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = new URL("../dist/cli.mjs", import.meta.url).pathname;
async function fixture(
  t,
  responder = () => ({ data: { id: "team_b", settings: {} } }),
) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
    });
    const result = responder(requests.at(-1));
    if (result.delay) await new Promise((r) => setTimeout(r, result.delay));
    res.writeHead(
      result.status ?? 200,
      result.headers ?? { "content-type": "application/json" },
    );
    res.end(result.raw ?? JSON.stringify(result));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/v2`;
  function run(args, opts = {}) {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        GIGSTACK_API_KEY: "synthetic-test-token",
        GIGSTACK_API_BASE_URL: base,
        GIGSTACK_TEAM: "",
        ...opts.env,
      };
      const child = spawn(process.execPath, [cli, ...args], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(opts.input ?? "");
    });
  }
  return { run, requests, base };
}
const json = (result) => {
  assert.ok(result.stdout.trim(), "machine response present");
  return JSON.parse(result.stdout);
};

test("log commands preserve bounded pagination and safe detail envelopes", async (t) => {
  const page = {
    success: true,
    data: [],
    has_more: true,
    next_cursor: "opaque",
    scanned_count: 1,
    livemode: false,
  };
  const f = await fixture(t, (r) =>
    r.url.includes("/log_1")
      ? {
          data: r.url.includes("api-logs")
            ? {
                id: "log_1",
                timestamp: 1,
                livemode: false,
                redaction: "metadata_and_body_shape",
                method: "GET",
                endpoint: "/v2/invoices",
                status_code: 200,
                request_shape: null,
                query_shape: null,
                response_shape: null,
              }
            : {
                id: "log_1",
                timestamp: 1,
                updated_at: null,
                webhook_id: null,
                event: null,
                livemode: false,
                status: "unknown",
                response_code: null,
                retry_requested: false,
                redaction: "metadata_and_body_shape",
                payload_shape: null,
                response_shape: null,
              },
        }
      : page,
  );
  for (const [name, route] of [
    ["api", "api-logs"],
    ["webhooks", "webhook-deliveries"],
  ]) {
    const filters =
      name === "api"
        ? ["--method", "POST", "--endpoint", "/v2/invoices", "--status", "5xx"]
        : ["--event", "invoice.created", "--status", "pending"];
    const r = await f.run([
      "logs",
      name,
      "list",
      "team_b",
      "--limit",
      "1",
      "--cursor",
      "old",
      "--from",
      "1",
      "--to",
      "9",
      ...filters,
      "--json",
    ]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(json(r), page);
    const request = new URL(f.requests.at(-1).url, f.base);
    assert.equal(request.pathname, `/v2/teams/team_b/${route}`);
    assert.equal(request.searchParams.get("cursor"), "old");
    assert.equal(request.searchParams.get("limit"), "1");
    assert.equal(request.searchParams.get("from"), "1");
    assert.equal(request.searchParams.get("to"), "9");
    assert.equal(
      (await f.run(["logs", name, "get", "team_b", "log_1", "--json"])).code,
      0,
    );
    assert.equal(f.requests.at(-1).url, `/v2/teams/team_b/${route}/log_1`);
  }
  assert.equal(
    f.requests.every((req) => req.method === "GET"),
    true,
  );
});
test("log malformed filters and mismatched team fail before network", async (t) => {
  const f = await fixture(t);
  for (const args of [
    ["api", "list", "team_b", "--limit", "0"],
    ["api", "list", "team_b", "--status", "pending"],
    ["api", "list", "team_b", "--from", "9", "--to", "1"],
    ["api", "list", "team_b", "--endpoint", "https://example.test"],
    ["webhooks", "list", "team_b", "--event", "not-an-event"],
    ["api", "get", "team_b", "log_1", "--team", "foreign"],
  ]) {
    const r = await f.run(["logs", ...args, "--json"]);
    assert.equal(r.code, 1);
    json(r);
  }
  assert.equal(f.requests.length, 0);
});

test("retrying, teams events and safe delivery metadata survive without raw payloads", async (t) => {
  const row = {
    id: "log",
    timestamp: 1,
    updated_at: null,
    webhook_id: "saved",
    event: "teams.sat.manifest.signed",
    livemode: false,
    status: "retrying",
    response_code: 503,
    retry_requested: false,
    redaction: "metadata_and_body_shape",
    resource_id: "resource",
    attempts: 2,
    latency_ms: 1.5,
    error_category: "http_response",
  };
  let value = row;
  const f = await fixture(t, () => ({
    success: true,
    data: [{ ...value, url: "PRIVATE", response: "PRIVATE" }],
    has_more: false,
    next_cursor: null,
    scanned_count: 1,
    livemode: false,
    secret: "PRIVATE",
  }));
  const args = [
    "logs",
    "webhooks",
    "list",
    "team_b",
    "--event",
    "teams.sat.manifest.signed",
    "--status",
    "retrying",
    "--json",
  ];
  let result = await f.run(args);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(json(result).data, [row]);
  assert.ok(!result.stdout.includes("PRIVATE"));
  for (const error_category of [
    "endpoint_unavailable",
    "credentials_unavailable",
  ]) {
    value = { ...row, response_code: null, latency_ms: 0, error_category };
    const safe = await f.run(args);
    assert.equal(safe.code, 0, safe.stderr);
    assert.deepEqual(json(safe).data, [value]);
  }
  for (const patch of [
    { resource_id: { secret: "PRIVATE" } },
    { attempts: -1 },
    { latency_ms: -1 },
    { error_category: "PRIVATE" },
    { event: "unknown.event" },
  ]) {
    value = { ...row, ...patch };
    result = await f.run(args);
    assert.equal(result.code, 1);
    assert.ok(!result.stdout.includes("PRIVATE"));
  }
  const prior = f.requests.length;
  assert.equal(
    (
      await f.run([
        "logs",
        "webhooks",
        "list",
        "team_b",
        "--event",
        "unknown.event",
        "--json",
      ])
    ).code,
    1,
  );
  assert.equal(f.requests.length, prior);
});
test("log detail projects shape vocabulary and legacy absent additions safely", async (t) => {
  const f = await fixture(t, () => ({
    data: {
      id: "log",
      timestamp: null,
      updated_at: null,
      webhook_id: null,
      event: null,
      livemode: false,
      status: "unknown",
      response_code: null,
      retry_requested: false,
      redaction: "metadata_and_body_shape",
      payload_shape: {
        email: "PRIVATE",
        token: "PRIVATE",
        PRIVATE_KEY: "PRIVATE",
      },
      response_shape: "PRIVATE",
      url: "PRIVATE",
    },
    secret: "PRIVATE",
  }));
  const result = await f.run([
    "logs",
    "webhooks",
    "get",
    "team_b",
    "log",
    "--json",
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(!result.stdout.includes("PRIVATE"));
  assert.equal(json(result).data.resource_id, undefined);
  assert.equal(json(result).data.payload_shape.email, "[REDACTED]");
});
