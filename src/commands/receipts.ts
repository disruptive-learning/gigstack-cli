import { Command } from "commander";
import { api } from "../api.js";
import { printTable, printJson, success, error, isJsonMode, formatMoney, formatDate } from "../output.js";

export function registerReceiptCommands(program: Command) {
  const receipts = program.command("receipts").description("Gestionar recibos de venta");

  receipts
    .command("list")
    .description("Listar recibos")
    .option("-l, --limit <n>", "Límite", "20")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const res = await api("GET", "/receipts", { query: { limit: opts.limit }, team: opts.team });
        const items = res.data || [];
        if (isJsonMode()) return printJson(items);
        printTable(
          items.map((r: any) => ({
            id: r.id ? r.id.slice(0, 12) + "…" : "—",
            cliente: (r.client?.legal_name || r.client?.name || "público general").slice(0, 25),
            total: formatMoney(r.total, r.currency),
            status: r.status,
            válido: formatDate(r.validUntil),
          })),
        );
      } catch (e: any) { error(e.message); }
    });

  receipts
    .command("stamp <id>")
    .description("Timbrar un recibo")
    .option("--team <id>", "Team ID")
    .action(async (id, opts) => {
      try {
        const res = await api("POST", `/receipts/${id}/stamp`, { team: opts.team });
        success(`Recibo timbrado: ${res.data.id}`);
        if (isJsonMode()) printJson(res.data);
      } catch (e: any) { error(e.message); }
    });

  receipts
    .command("cancel <id>")
    .description("Cancelar un recibo")
    .option("--team <id>", "Team ID")
    .action(async (id, opts) => {
      try {
        await api("DELETE", `/receipts/${id}`, { team: opts.team });
        success(`Recibo ${id} cancelado`);
      } catch (e: any) { error(e.message); }
    });
}
