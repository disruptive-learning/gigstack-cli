import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
const row = {
  id: "inv1",
  email: "recipient@example.test",
  emailOwner: null,
  rol: "viewer",
  status: "pending",
  accepted: false,
  type: "team",
  expiring: 2100000000000,
  timestamp: null,
  teamId: "target",
  teamName: "Team",
  billingId: "account",
  billingName: null,
  approval_required: false,
  team: {
    id: "target",
    alias: null,
    logo: null,
    primaryColor: null,
    billingAccount: "account",
    members: 1,
  },
  token: "PRIVATE",
  approvalId: "PRIVATE",
};
async function fixture(t, value) {
  let request;
  const server = createServer((req, res) => {
    request = req.url;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  return {
    request: () => request,
    run: () =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            new URL("../dist/cli.mjs", import.meta.url).pathname,
            "teams",
            "invitations",
            "inbox",
            "--limit",
            "1",
            "--cursor",
            "previous",
            "--json",
          ],
          {
            env: {
              ...process.env,
              GIGSTACK_API_KEY: "fixture.synthetic.key",
              GIGSTACK_API_BASE_URL: `http://127.0.0.1:${server.address().port}/v2`,
              GIGSTACK_TEAM: "source",
              GIGSTACK_ALLOW_INSECURE_HTTP: "1",
            },
          },
        );
        let out = "",
          err = "";
        child.stdout.on("data", (c) => (out += c));
        child.stderr.on("data", (c) => (err += c));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, out, err }));
      }),
  };
}
test("actual named CLI inbox prints complete safe metadata/page without selected-team override", async (t) => {
  const f = await fixture(t, {
    success: true,
    data: [row],
    has_more: true,
    next_cursor: "cursor",
  });
  const r = await f.run();
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out).data[0].team, row.team);
  assert.equal(JSON.parse(r.out).next_cursor, "cursor");
  assert.doesNotMatch(r.out, /PRIVATE|approvalId|"token"/);
  assert.match(f.request(), /invitations\/inbox/);
  assert.match(f.request(), /cursor=previous/);
  assert.doesNotMatch(f.request(), /team=/);
});
test("mismatched scope refuses output and capabilities do not leak", async (t) => {
  const f = await fixture(t, {
    success: true,
    data: [{ ...row, team: { ...row.team, id: "foreign" } }],
    has_more: false,
    next_cursor: null,
  });
  const r = await f.run();
  assert.notEqual(r.code, 0);
  assert.doesNotMatch(r.out, /PRIVATE|target|foreign/);
  assert.doesNotMatch(r.err, /PRIVATE/);
});
