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
test("named team baseline read preserves both languages without sending or expanding unsafe fields", async (t) => {
  const language = Object.fromEntries(
    [
      "invoices",
      "invoicesComplements",
      "invoicesEgress",
      "payments",
      "paymentsReminders",
      "paymentsRemindersAfter",
      "receipts",
      "receiptsReminders",
      "bankReview",
    ].map((k) => [
      k,
      {
        subject: "Próximo {{date}}",
        body: "<p>Texto íntegro {{recipient}}</p>",
        private: "PRIVATE",
      },
    ]),
  );
  const data = {
    team_id: "t",
    effect_scope: "team_shared",
    source: "editor_baseline",
    is_nonprofit: true,
    english_enabled: false,
    templates_by_language: { es: language, en: language },
  };
  const f = await fixture(t, () => ({ data: { ...data, private: "PRIVATE" } }));
  let r = await f.run(["teams", "email-templates", "t"]);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /Texto íntegro/);
  assert.doesNotMatch(r.stdout, /PRIVATE/);
  assert.equal(f.requests[0].method, "GET");
  assert.equal(f.requests[0].url, "/v2/teams/t/email-templates?team=t");
  data.team_id = "foreign";
  r = await f.run(["teams", "email-templates", "t"]);
  assert.notEqual(r.code, 0);
  const count = f.requests.length;
  r = await f.run(["teams", "email-templates", "other"]);
  assert.notEqual(r.code, 0);
  assert.equal(f.requests.length, count);
});
