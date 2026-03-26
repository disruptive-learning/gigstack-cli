import { Command } from "commander";
import { api } from "../api.js";
import { spinner, error, formatDate } from "../output.js";
import { buildListQuery } from "../list-opts.js";

// ─── Column definitions ────────────────────────────────────

interface ColumnDef {
  key: string;
  extract: (item: any) => string;
}

const INVOICE_COLUMNS: ColumnDef[] = [
  { key: "uuid", extract: (i) => i.uuid || "" },
  { key: "status", extract: (i) => i.status || "" },
  { key: "payment_method", extract: (i) => i.payment_method || "" },
  { key: "payment_form", extract: (i) => i.payment_form || "" },
  { key: "client_name", extract: (i) => i.client?.legal_name || i.client?.name || "" },
  { key: "client_rfc", extract: (i) => i.client?.tax_id || "" },
  { key: "client_email", extract: (i) => i.client?.email || "" },
  { key: "subtotal", extract: (i) => String(i.subtotal ?? "") },
  { key: "total", extract: (i) => String(i.total ?? "") },
  { key: "currency", extract: (i) => i.currency || "" },
  { key: "series", extract: (i) => i.series || "" },
  { key: "folio_number", extract: (i) => String(i.folio_number ?? "") },
  { key: "last_balance", extract: (i) => String(i.last_balance ?? "") },
  { key: "created_at", extract: (i) => formatDate(i.created_at) },
];

const PAYMENT_COLUMNS: ColumnDef[] = [
  { key: "id", extract: (p) => p.id || "" },
  { key: "status", extract: (p) => p.status || "" },
  { key: "client_name", extract: (p) => p.client?.legal_name || p.client?.name || "" },
  { key: "client_rfc", extract: (p) => p.client?.tax_id || "" },
  { key: "client_email", extract: (p) => p.client?.email || "" },
  { key: "total", extract: (p) => String(p.total ?? "") },
  { key: "currency", extract: (p) => p.currency || "" },
  { key: "payment_form", extract: (p) => p.payment_form || "" },
  { key: "short_url", extract: (p) => p.short_url || "" },
  { key: "created_at", extract: (p) => formatDate(p.created_at) },
];

const RECEIPT_COLUMNS: ColumnDef[] = [
  { key: "id", extract: (r) => r.id || "" },
  { key: "status", extract: (r) => r.status || "" },
  { key: "client_name", extract: (r) => r.client?.legal_name || r.client?.name || "" },
  { key: "client_rfc", extract: (r) => r.client?.tax_id || "" },
  { key: "total", extract: (r) => String(r.total ?? "") },
  { key: "currency", extract: (r) => r.currency || "" },
  { key: "validUntil", extract: (r) => formatDate(r.validUntil) },
  { key: "created_at", extract: (r) => formatDate(r.created_at) },
];

const CLIENT_COLUMNS: ColumnDef[] = [
  { key: "id", extract: (c) => c.id || "" },
  { key: "legal_name", extract: (c) => c.legal_name || c.name || "" },
  { key: "tax_id", extract: (c) => c.tax_id || "" },
  { key: "email", extract: (c) => c.email || "" },
  { key: "tax_system", extract: (c) => c.tax_system || "" },
  { key: "use", extract: (c) => c.use || "" },
  { key: "zip", extract: (c) => c.address?.zip || "" },
  { key: "is_valid", extract: (c) => c.is_valid === undefined ? "" : String(c.is_valid) },
  { key: "created_at", extract: (c) => formatDate(c.created_at) },
];

// ─── CSV helpers ───────────────────────────────────────────

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsvRow(columns: ColumnDef[], item: any): string {
  return columns.map((col) => csvEscape(col.extract(item))).join(",");
}

function csvHeader(columns: ColumnDef[]): string {
  return columns.map((col) => csvEscape(col.key)).join(",");
}

// ─── Pagination fetcher ────────────────────────────────────

async function fetchAllPages(
  endpoint: string,
  baseQuery: Record<string, string>,
  team?: string,
): Promise<any[]> {
  const all: any[] = [];
  let nextToken: string | undefined;
  let page = 0;

  // Always fetch max per page
  baseQuery.limit = "100";

  let s = spinner("Exportando datos…");

  try {
    do {
      const query = { ...baseQuery };
      if (nextToken) query.next = nextToken;

      const res = await api("GET", endpoint, { query, team });
      const items = (res.data || []).filter((r: any) => r != null);
      all.push(...items);
      page++;

      nextToken = res.has_more && res.next ? res.next : undefined;

      // Restart spinner with updated count
      s.stop();
      if (nextToken) {
        s = spinner(`Exportando datos… (${all.length} registros, página ${page + 1})`);
      }
    } while (nextToken);
  } finally {
    s.stop();
  }

  // Final count on stderr
  process.stderr.write(`Exportados ${all.length} registros\n`);

  return all;
}

// ─── Command registration ──────────────────────────────────

interface ExportSubcommand {
  name: string;
  description: string;
  endpoint: string;
  columns: ColumnDef[];
  extraOpts?: (cmd: Command) => Command;
  applyFilters?: (opts: any, query: Record<string, string>) => void;
}

const SUBCOMMANDS: ExportSubcommand[] = [
  {
    name: "invoices",
    description: "Exportar facturas de ingreso",
    endpoint: "/invoices/income",
    columns: INVOICE_COLUMNS,
    extraOpts: (cmd) =>
      cmd
        .option("--status <status>", "Filtrar por status (valid, cancelled)")
        .option("--client <id>", "Filtrar por cliente")
        .option("--series <series>", "Filtrar por serie"),
    applyFilters: (opts, query) => {
      if (opts.status) query.status = opts.status;
      if (opts.client) query.client_id = opts.client;
      if (opts.series) query.series = opts.series;
    },
  },
  {
    name: "payments",
    description: "Exportar pagos",
    endpoint: "/payments",
    columns: PAYMENT_COLUMNS,
    extraOpts: (cmd) =>
      cmd
        .option("--status <status>", "Filtrar: pending, succeeded, failed, cancelled, refunded")
        .option("--client <id>", "Filtrar por cliente")
        .option("--currency <code>", "Filtrar por moneda (MXN, USD)")
        .option("--email <email>", "Filtrar por email del cliente")
        .option("--rfc <rfc>", "Filtrar por RFC del cliente"),
    applyFilters: (opts, query) => {
      if (opts.status) query.status = opts.status;
      if (opts.client) query.client_id = opts.client;
      if (opts.currency) query.currency = opts.currency;
      if (opts.email) query.email = opts.email;
      if (opts.rfc) query.tax_id = opts.rfc;
    },
  },
  {
    name: "receipts",
    description: "Exportar recibos de venta",
    endpoint: "/receipts",
    columns: RECEIPT_COLUMNS,
    extraOpts: (cmd) =>
      cmd
        .option("--status <status>", "Filtrar: pending, open, invoiced, completed, expired, cancelled")
        .option("--client <id>", "Filtrar por cliente"),
    applyFilters: (opts, query) => {
      if (opts.status) query.status = opts.status;
      if (opts.client) query.client_id = opts.client;
    },
  },
  {
    name: "clients",
    description: "Exportar clientes",
    endpoint: "/clients",
    columns: CLIENT_COLUMNS,
  },
];

export function registerExportCommand(program: Command) {
  const exportCmd = program
    .command("export")
    .description("Exportar datos a CSV o JSON (stdout)");

  for (const sub of SUBCOMMANDS) {
    let cmd = exportCmd
      .command(sub.name)
      .description(sub.description)
      .option("--from <date>", "Fecha inicio (YYYY-MM-DD, YYYY-MM, 30d, 7d)")
      .option("--to <date>", "Fecha fin (YYYY-MM-DD, YYYY-MM, today)")
      .option("--sort <dir>", "Orden: asc o desc", "desc")
      .option("--order-by <field>", "Ordenar por: timestamp o name", "timestamp")
      .option("--format <fmt>", "Formato de salida: csv o json", "csv")
      .option("--team <id>", "Team ID");

    if (sub.extraOpts) cmd = sub.extraOpts(cmd);

    cmd.action(async (opts) => {
      try {
        const query = buildListQuery(opts);
        if (sub.applyFilters) sub.applyFilters(opts, query);

        const items = await fetchAllPages(sub.endpoint, query, opts.team);

        if (opts.format === "json") {
          process.stdout.write(JSON.stringify(items, null, 2) + "\n");
        } else {
          // CSV output
          process.stdout.write(csvHeader(sub.columns) + "\n");
          for (const item of items) {
            process.stdout.write(toCsvRow(sub.columns, item) + "\n");
          }
        }
      } catch (e: any) {
        error(e.message);
        process.exit(1);
      }
    });
  }
}
