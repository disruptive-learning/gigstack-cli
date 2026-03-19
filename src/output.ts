import pc from "picocolors";

let jsonMode = false;

export function setJsonMode(enabled: boolean) {
  jsonMode = enabled;
}

export function isJsonMode() {
  return jsonMode;
}

export function printJson(data: any) {
  console.log(JSON.stringify(data, null, 2));
}

export function printTable(rows: Record<string, any>[], columns?: string[]) {
  if (jsonMode) return printJson(rows);
  if (rows.length === 0) {
    console.log(pc.dim("Sin resultados"));
    return;
  }

  const cols = columns || Object.keys(rows[0]);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length))
  );

  const header = cols.map((c, i) => pc.bold(c.padEnd(widths[i]))).join("  ");
  const separator = widths.map((w) => "─".repeat(w)).join("──");

  console.log(header);
  console.log(pc.dim(separator));
  for (const row of rows) {
    console.log(cols.map((c, i) => String(row[c] ?? "").padEnd(widths[i])).join("  "));
  }
}

export function printKeyValue(data: Record<string, any>) {
  if (jsonMode) return printJson(data);
  const maxKey = Math.max(...Object.keys(data).map((k) => k.length));
  for (const [k, v] of Object.entries(data)) {
    console.log(`${pc.bold(k.padEnd(maxKey))}  ${v}`);
  }
}

export function success(msg: string) {
  console.log(pc.green(`✓ ${msg}`));
}

export function error(msg: string) {
  console.error(pc.red(`✗ ${msg}`));
}

export function warn(msg: string) {
  console.log(pc.yellow(`! ${msg}`));
}

export function formatMoney(amount: number, currency = "MXN") {
  return `$${(amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${currency.toUpperCase()}`;
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
