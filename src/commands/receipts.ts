import { sendCompleteBody, withCompleteBody } from "../core-input.js";
import { segment } from "../input.js";
import { Command } from "commander";
import { api } from "../api.js";
import { printTable, printJson, printListJson, success, error, isJsonMode, formatMoney, formatDate, spin } from "../output.js";
import { withListOpts, buildListQuery, printPaginationHint } from "../list-opts.js";

export function registerReceiptCommands(program: Command) {
  const receipts = program.command("receipts").description("Gestionar recibos de venta");
  receipts.command("get <id>").description("Read a receipt and its returned state")
    .action(async id => printJson(await api("GET", `/receipts/${segment(id)}`)));
  receipts.command("search <query>").description("Search receipts; retain server pagination")
    .option("--limit <n>", "Maximum results").option("--page <n>", "Search page").option("--fields <fields>", "Comma-separated search fields")
    .action(async (q, opts) => {
      const query: Record<string,string> = {q};
      for(const key of ["limit","page","fields"]) if(opts[key] !== undefined) query[key]=opts[key];
      printJson(await api("GET", "/receipts/search", { query }));
    });
  withCompleteBody(receipts.command("create").description("Create a receipt from its full JSON body"))
    .action(async (opts, command) => sendCompleteBody(command, opts, "POST", "/receipts"));
  withCompleteBody(receipts.command("reopen <id>").description("Reopen a receipt under server eligibility rules; optional reason in JSON"))
    .action(async (id, opts, command) => sendCompleteBody(command, opts, "POST", `/receipts/${segment(id)}/reopen`));

  withListOpts(
    receipts
      .command("list")
      .description("Listar recibos")
  )
    .option("--status <status>", "Filtrar: pending, open, invoiced, completed, expired, cancelled")
    .option("--client <id>", "Filtrar por cliente")
    .action(async (opts) => {
      try {
        const query = buildListQuery(opts);
        if (opts.status) query.status = opts.status;
        if (opts.client) query.client_id = opts.client;
        const res = await spin("Cargando recibos…", () => api("GET", "/receipts", { query, team: opts.team }));
        const items = (res.data || []).filter((r: any) => r != null);
        if (isJsonMode()) return printListJson(res, items);
        printTable(
          items.map((r: any) => ({
            id: r.id ? r.id.slice(0, 12) + "…" : "—",
            cliente: (r.client?.legal_name || r.client?.name || "público general").slice(0, 25),
            total: formatMoney(r.total, r.currency),
            status: r.status || "—",
            válido: formatDate(r.validUntil),
          })),
        );
        printPaginationHint(res);
      } catch (e: any) { error(e); }
    });

  receipts
    .command("stamp <id>")
    .description("Timbrar un recibo")
    .option("--team <id>", "Team ID")
    .action(async (id, opts) => {
      try {
        const res = await spin("Timbrando recibo…", () => api("POST", `/receipts/${id}/stamp`, { team: opts.team }));
        success(`Recibo timbrado: ${res.data.id}`);
        if (isJsonMode()) printJson(res.data);
      } catch (e: any) { error(e); }
    });

  receipts
    .command("cancel <id>")
    .description("Cancelar un recibo")
    .option("--team <id>", "Team ID")
    .action(async (id, opts) => {
      try {
        const res = await api("DELETE", `/receipts/${segment(id)}`, { team: opts.team });
        if (isJsonMode()) return printJson(res);
        success(`Recibo ${id} cancelado`);
      } catch (e: any) { error(e); }
    });
}
