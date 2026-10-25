import pc from "picocolors";

let jsonMode = false;
let jsonPrinted = false;
let pendingSuccess: string | undefined;
const humanLog = console.log.bind(console);

export function setJsonMode(enabled: boolean) {
  jsonMode = enabled;
  jsonPrinted = false;
  pendingSuccess = undefined;
  // Legacy command diagnostics must never contaminate machine-readable stdout.
  console.log = enabled ? console.error.bind(console) : humanLog;
}

export function isJsonMode() {
  return jsonMode;
}

// ─── Terminal output sanitization ───────────────────────────
//
// API-controlled strings (client names, service descriptions, server error
// messages, payment URLs) are rendered to the terminal in human mode. Without
// sanitization a malicious value can carry ANSI/OSC escape sequences — an
// OSC 52 clipboard write, a CSI 2J screen clear, or arbitrary control
// characters — that the terminal emulator interprets, enabling clipboard
// hijack and output spoofing. This helper strips those sequences while leaving
// normal printable/unicode text (accents, emoji, currency symbols) intact.
// --json output is unaffected because JSON.stringify escapes these bytes.
//
// Alternatives, in order:
//   1. OSC / DCS / PM / APC / SOS strings: ESC ] P X ^ _ … up to a BEL, an ST
//      (ESC \\), or end of string.
//   2. CSI sequences: ESC [ params intermediates final.
//   3. Any residual bare ESC byte and the C0/C1 control range (includes DEL).
// eslint-disable-next-line no-control-regex
const TERMINAL_ESCAPE_RE =
  /\u001b[\]PX^_][\s\S]*?(?:\u0007|\u001b\\|$)|\u001b\[[0-?]*[ -/]*[@-~]|[\u0000-\u001f\u007f-\u009f]/g;

export function sanitizeTerminal(value: unknown): string {
  return String(value ?? "").replace(TERMINAL_ESCAPE_RE, "");
}

export function printJson(data: any) {
  jsonPrinted = true;
  pendingSuccess = undefined;
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

/** Print a list response as a paginated JSON envelope. Use in every command that
 *  fetches a list when isJsonMode() is true. The bare-array shape from earlier
 *  versions was lossy — callers had no way to paginate from --json output. */
export function printListJson(res: any, items?: any[]) {
  return printJson({
    data: items ?? res?.data ?? [],
    has_more: res?.has_more ?? false,
    next: res?.next ?? null,
    total: res?.total_results ?? res?.total ?? null,
  });
}

export function printTable(rows: Record<string, any>[], columns?: string[]) {
  if (jsonMode) return printJson(rows);
  if (rows.length === 0) {
    console.log(pc.dim("Sin resultados"));
    return;
  }

  const cols = columns || Object.keys(rows[0]);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => sanitizeTerminal(r[c] ?? "").length))
  );

  const header = cols.map((c, i) => pc.bold(c.padEnd(widths[i]))).join("  ");
  const separator = widths.map((w) => "─".repeat(w)).join("──");

  console.log(header);
  console.log(pc.dim(separator));
  for (const row of rows) {
    console.log(cols.map((c, i) => sanitizeTerminal(row[c] ?? "").padEnd(widths[i])).join("  "));
  }
}

export function printKeyValue(data: Record<string, any>) {
  if (jsonMode) return printJson(data);
  const maxKey = Math.max(...Object.keys(data).map((k) => k.length));
  for (const [k, v] of Object.entries(data)) {
    console.log(`${pc.bold(k.padEnd(maxKey))}  ${sanitizeTerminal(v)}`);
  }
}

export function success(msg: string) {
  if (jsonMode) { pendingSuccess = msg; return; }
  console.log(pc.green(`✓ ${sanitizeTerminal(msg)}`));
}

export function error(value: unknown) {
  process.exitCode = 1;
  pendingSuccess = undefined;
  const e = value as any;
  const message = typeof value === "string" ? value : e?.message ?? "Error desconocido";
  const cost = e?.body?.data;
  const details = cost && typeof cost.estimated_cost_mxn === "number" ? { estimated_cost_mxn: cost.estimated_cost_mxn, ...(typeof cost.importable === "number" ? { importable: cost.importable } : {}) } : undefined;
  if (jsonMode) printJson({ error: { message, ...(details ? { details } : {}), ...(e?.status ? { status: e.status } : {}), ...(e?.code ? { code: e.code } : {}), ...(e?.outcome ? { outcome: e.outcome } : {}) } });
  else console.error(pc.red(`✗ ${sanitizeTerminal(message)}`));
}

export function finishOutput() {
  if (jsonMode && !jsonPrinted && pendingSuccess) printJson({ success: true, message: pendingSuccess });
}

export function warn(msg: string) {
  console.log(pc.yellow(`! ${sanitizeTerminal(msg)}`));
}

export function formatMoney(amount: number, currency = "MXN") {
  return `$${(amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency.toUpperCase()}`;
}

// ─── Spinner ────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function spinner(message: string) {
  if (jsonMode) return { stop() {} };

  let i = 0;
  const stream = process.stderr;
  const interval = setInterval(() => {
    stream.write(`\r${pc.cyan(SPINNER_FRAMES[i++ % SPINNER_FRAMES.length])} ${pc.dim(message)}`);
  }, 80);

  return {
    stop(finalMessage?: string) {
      clearInterval(interval);
      stream.write("\r" + " ".repeat(message.length + 4) + "\r");
      if (finalMessage) stream.write(finalMessage + "\n");
    },
  };
}

/** Run an async fn with a spinner that auto-stops on success or error. */
export async function spin<T>(message: string, fn: () => Promise<T>): Promise<T> {
  const s = spinner(message);
  try {
    const result = await fn();
    s.stop();
    return result;
  } catch (e) {
    s.stop();
    throw e;
  }
}

export function formatDate(val: any): string {
  if (!val) return "—";
  if (typeof val === "string") return val.slice(0, 10);
  if (typeof val === "number") {
    const ms = val > 1e12 ? val : val * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (val._seconds) return new Date(val._seconds * 1000).toISOString().slice(0, 10);
  if (val.seconds) return new Date(val.seconds * 1000).toISOString().slice(0, 10);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val);
}
