import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const cli = new URL("../dist/cli.mjs", import.meta.url).pathname;
const token = `fixture.${Buffer.from(JSON.stringify({ livemode: false })).toString("base64url")}.synthetic`;

// Regression test for vuln-0001 (CSV formula injection): attacker-controlled
// client fields must not reach an exported CSV cell in a form a spreadsheet
// executes as a formula, and fields with CSV metacharacters must be quoted per
// RFC-4180. Benign values must pass through byte-identical.
async function fixture(t, clients) {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: clients, has_more: false, next: null }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  // Human/CSV mode: do NOT append --json.
  const run = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args], {
        env: {
          ...process.env,
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

const baseClient = (over) => ({
  id: "client_x",
  legal_name: "Acme S.A.",
  tax_id: "XAXX010101000",
  email: "a@b.c",
  tax_system: "601",
  use: "G03",
  address: { zip: "01000" },
  is_valid: true,
  created_at: "2023-11-14",
  ...over,
});

test("export CSV neutralizes formula-leading client fields", async (t) => {
  const f = await fixture(t, [
    baseClient({ id: "c_eq", legal_name: '=HYPERLINK("http://evil/x";"Click")' }),
    baseClient({ id: "c_plus", legal_name: "+1+1" }),
    baseClient({ id: "c_minus", legal_name: "-2+3" }),
    baseClient({ id: "c_at", legal_name: "@SUM(A1)" }),
    baseClient({ id: "c_tab", legal_name: "\t=cmd" }),
  ]);
  const res = await f.run(["export", "clients", "--format", "csv"]);
  assert.equal(res.code, 0, res.stderr);
  const lines = res.stdout.trim().split("\n");

  // Every attacker-influenced value now begins with a text-marker apostrophe,
  // so the spreadsheet renders it as inert text instead of a formula.
  assert.ok(res.stdout.includes(`"'=HYPERLINK(""http://evil/x"";""Click"")"`),
    `= cell not neutralized: ${res.stdout}`);
  assert.ok(lines.some((l) => l.includes("c_plus,'+1+1,")), "+ cell not neutralized");
  assert.ok(lines.some((l) => l.includes("c_minus,'-2+3,")), "- cell not neutralized");
  assert.ok(lines.some((l) => l.includes("c_at,'@SUM(A1),")), "@ cell not neutralized");
  // A tab-leading value is a formula marker too: prefixed, and quoting not required.
  assert.ok(lines.some((l) => l.includes("c_tab,'\t=cmd,")), "tab cell not neutralized");

  // No bare formula-leading cell survives (a cell value starting with = right
  // after a comma would mean the guard failed).
  assert.ok(!/,=HYPERLINK/.test(res.stdout), "raw formula cell leaked");
});

test("export CSV quotes CR/comma/quote fields and leaves benign values intact", async (t) => {
  const f = await fixture(t, [
    baseClient({ id: "c_cr", legal_name: "Benign\r=SUM(1+1)injected" }),
    baseClient({ id: "c_comma", legal_name: "Doe, John" }),
    baseClient({ id: "c_plain", legal_name: "Acme S.A." }),
  ]);
  const res = await f.run(["export", "clients", "--format", "csv"]);
  assert.equal(res.code, 0, res.stderr);

  // CR-only field is now quoted (previously emitted raw into the middle of a row).
  assert.ok(res.stdout.includes('"Benign\r=SUM(1+1)injected"'), "CR field not quoted");
  // Comma field quoted per RFC-4180.
  assert.ok(res.stdout.includes('"Doe, John"'), "comma field not quoted");
  // Benign value with no metacharacters is byte-identical: no quoting, no apostrophe.
  assert.ok(/(^|\n)client_x,Acme S\.A\.,/.test(res.stdout.replace(/\r/g, "")) ||
    res.stdout.includes("c_plain,Acme S.A.,"), `benign value altered: ${res.stdout}`);
  assert.ok(!res.stdout.includes("'Acme"), "benign value wrongly prefixed");
});
