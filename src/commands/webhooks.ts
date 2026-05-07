import { Command } from "commander";
import { api } from "../api.js";
import { printTable, printJson, printListJson, printKeyValue, success, error, isJsonMode, spin } from "../output.js";
import { withListOpts, buildListQuery, printPaginationHint } from "../list-opts.js";

export function registerWebhookCommands(program: Command) {
  const webhooks = program.command("webhooks").description("Gestionar webhooks");

  withListOpts(
    webhooks
      .command("list")
      .description("Listar webhooks configurados")
  )
    .action(async (opts) => {
      try {
        const query = buildListQuery(opts);
        const res = await spin("Cargando webhooks…", () => api("GET", "/webhooks", { query, team: opts.team }));
        const items = res.data || [];
        if (isJsonMode()) return printListJson(res, items);
        printTable(
          items.map((w: any) => ({
            id: w.id ? w.id.slice(0, 12) + "…" : "—",
            url: (w.url || "—").slice(0, 40),
            events: (w.events || []).join(", ").slice(0, 30) || "all",
          })),
        );
        printPaginationHint(res);
      } catch (e: any) { error(e.message); }
    });

  webhooks
    .command("create")
    .description("Crear un webhook")
    .requiredOption("--url <url>", "URL del webhook")
    .option("--events <events>", "Eventos separados por coma (ej: invoice.created,payment.succeeded)")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const body: any = { url: opts.url };
        if (opts.events) body.events = opts.events.split(",");
        const res = await spin("Creando webhook…", () => api("POST", "/webhooks", { body, team: opts.team }));
        success(`Webhook creado: ${res.data.id}`);
        if (isJsonMode()) printJson(res.data);
      } catch (e: any) { error(e.message); }
    });

  webhooks
    .command("delete <id>")
    .description("Eliminar un webhook")
    .option("--team <id>", "Team ID")
    .action(async (id, opts) => {
      try {
        await api("DELETE", `/webhooks/${id}`, { team: opts.team });
        success(`Webhook ${id} eliminado`);
      } catch (e: any) { error(e.message); }
    });
}
