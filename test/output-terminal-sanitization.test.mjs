import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const cli = new URL("../dist/cli.mjs", import.meta.url).pathname;
const token = `fixture.${Buffer.from(JSON.stringify({ livemode: false })).toString("base64url")}.synthetic`;

// Regression test for vuln-0002 (terminal escape injection): server-controlled
// fields printed in human mode must not carry ANSI/OSC escape sequences or
// C0/C1 control characters (OSC-52 clipboard write, CSI 2J screen clear, BEL,
// bare ESC). Benign printable/unicode text must survive untouched.
async function fixture(t, reply) {
  const server = createServer((req, res) => {
    const out = reply(req);
    const status = out && typeof out.status === "number" ? out.status : 200;
    const body = out && out.body !== undefined ? out.body : out;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  // Human mode: do NOT append --json (that path is already safe via JSON.stringify).
  const run = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args], {
        env: {
          ...process.env,
          // Force color OFF so the only possible ESC bytes in output are
          // server-injected sequences the sanitizer must strip — not legitimate
          // picocolors app color, which CI (CI/FORCE_COLOR env) would otherwise add
          // and make the zero-ESC assertions falsely trip.
          NO_COLOR: "1",
          FORCE_COLOR: "0",
          GIGSTACK_API_KEY: token,
          GIGSTACK_API_BASE_URL: `http://127.0.0.1:${server.address().port}/v2`,
          GIGSTACK_TEAM: "t",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end("");
    });
  return { run };
}

const OSC52 = "\u001b]52;c;aGVsbG8gd29ybGQ=\u0007"; // clipboard write "hello world"
const CLEAR = "\u001b[2J\u001b[H"; // screen clear + cursor home

test("human-mode table output strips OSC/CSI/control sequences from server fields", async (t) => {
  const malicious = `Acme ${OSC52}${CLEAR}Co`;
  const f = await fixture(t, () => ({
    data: [{
      id: "client_x",
      legal_name: malicious,
      name: malicious,
      tax_id: "X",
      email: "e@x.c",
      created_at: "2023-11-14",
    }],
    has_more: false,
    next: null,
  }));
  const res = await f.run(["clients", "list"]);
  assert.equal(res.code, 0, res.stderr);

  // No escape bytes, BEL, or recognizable OSC-52 payload survive to the terminal.
  assert.equal((res.stdout.match(/\u001b/g) || []).length, 0, "ESC byte leaked");
  assert.ok(!res.stdout.includes("\u0007"), "BEL leaked");
  assert.ok(!res.stdout.includes("]52;c;"), "OSC-52 payload leaked");
  assert.ok(!res.stdout.includes("[2J"), "screen-clear leaked");
  // The benign text that surrounded the sequences is preserved.
  assert.ok(res.stdout.includes("Acme ") && res.stdout.includes("Co"),
    `benign text lost: ${JSON.stringify(res.stdout)}`);
});

test("human-mode output preserves accented and emoji text", async (t) => {
  const benign = "Compañía Ñandú €—café ☕";
  const f = await fixture(t, () => ({
    data: [{
      id: "client_y",
      legal_name: benign,
      name: benign,
      tax_id: "X",
      email: "e@x.c",
      created_at: "2023-11-14",
    }],
    has_more: false,
    next: null,
  }));
  const res = await f.run(["clients", "list"]);
  assert.equal(res.code, 0, res.stderr);
  assert.ok(res.stdout.includes(benign), `unicode text altered: ${JSON.stringify(res.stdout)}`);
});

test("human-mode error output strips escapes from server error.message", async (t) => {
  const f = await fixture(t, () => ({
    status: 400,
    body: { error: { message: `Error al timbrar${OSC52}${CLEAR}` } },
  }));
  // receipts stamp surfaces the server error.message through error() on stderr.
  const res = await f.run(["receipts", "stamp", "receipt_123"]);
  assert.notEqual(res.code, 0);
  const streams = res.stdout + res.stderr;
  assert.equal((streams.match(/\u001b/g) || []).length, 0, "ESC byte leaked on error path");
  assert.ok(!streams.includes("\u0007"), "BEL leaked on error path");
  assert.ok(streams.includes("Error al timbrar"), "benign error text lost");
});
