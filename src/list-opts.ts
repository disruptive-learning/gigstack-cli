import { Command } from "commander";
import pc from "picocolors";

/**
 * Add common list options to a command: --limit, --next, --from, --to, --sort, --order-by
 */
export function withListOpts(cmd: Command): Command {
  return cmd
    .option("-l, --limit <n>", "Límite de resultados (1-100)", "20")
    .option("--next <token>", "Token de paginación (de respuesta anterior)")
    .option("--from <date>", "Fecha inicio (YYYY-MM-DD, YYYY-MM, 30d, 7d)")
    .option("--to <date>", "Fecha fin (YYYY-MM-DD, YYYY-MM, today)")
    .option("--sort <dir>", "Orden: asc o desc", "desc")
    .option("--order-by <field>", "Ordenar por: timestamp o name", "timestamp")
    .option("--team <id>", "Team ID");
}

/**
 * Build query params from common list options.
 */
export function buildListQuery(opts: any): Record<string, string> {
  const query: Record<string, string> = { limit: opts.limit };

  if (opts.next) query.next = opts.next;
  if (opts.sort && opts.sort !== "desc") query.sort = opts.sort;
  if (opts.orderBy && opts.orderBy !== "timestamp") query.order_by = opts.orderBy;

  // Date filtering
  if (opts.from || opts.to) {
    const from = opts.from ? parseDate(opts.from) : undefined;
    const to = opts.to ? parseDate(opts.to, true) : undefined;
    if (from) query["created[gte]"] = String(Math.floor(new Date(from).getTime() / 1000));
    if (to) query["created[lte]"] = String(Math.floor(new Date(to + "T23:59:59").getTime() / 1000));
  }

  return query;
}

/** Print pagination hint if there are more results */
export function printPaginationHint(res: any) {
  if (res.has_more && res.next) {
    console.log(pc.dim(`\n... ${res.total_results ?? "más"} resultados. Usa --next ${res.next} para la siguiente página`));
  } else if (res.has_more) {
    console.log(pc.dim(`\n... más resultados disponibles`));
  }
}

function parseDate(input: string, isEnd = false): string {
  const trimmed = input.trim().toLowerCase();
  const relMatch = trimmed.match(/^(\d+)d$/);
  if (relMatch) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(relMatch[1]));
    return d.toISOString().slice(0, 10);
  }
  if (trimmed === "today") return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    if (isEnd) {
      const [y, m] = trimmed.split("-").map(Number);
      const last = new Date(y, m, 0).getDate();
      return `${trimmed}-${String(last).padStart(2, "0")}`;
    }
    return `${trimmed}-01`;
  }
  return trimmed;
}
