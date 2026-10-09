import { registerManualWebhookCommands } from "./manual-webhooks.js";
import { withJsonInput, readJsonInput, segment } from "../input.js";
import { Command } from "commander";
import { api } from "../api.js";
import { printTable, printJson, printKeyValue, success, error, isJsonMode, spin } from "../output.js";


export function registerWebhookCommands(program: Command) {
  const webhooks = program.command("webhooks").description("Gestionar webhooks");
  registerManualWebhookCommands(webhooks);

  webhooks.command("get <id>").description("Consultar URL, eventos y estado del webhook")
    .action(async id => {
      const res = await api("GET", `/webhooks/${segment(id)}`);
      isJsonMode() ? printJson(res) : printKeyValue(res.data ?? res);
    });
  withJsonInput(webhooks.command("update <id>").description("Actualizar url/events/description/status del webhook"))
    .action(async (id, opts) => {
      const res = await api("PUT", `/webhooks/${segment(id)}`, { body: await readJsonInput(opts) });
      isJsonMode() ? printJson(res) : printKeyValue(res.data ?? res);
    });

  webhooks.command("list").description("Listar webhooks configurados")
    .option("--limit <n>", "Límite (1-100)", "20")
    .option("--cursor <cursor>", "next_cursor anterior")
    .option("--status <status>", "active o inactive")
    .action(async (opts) => {
      try {
        const query = { limit: opts.limit, ...(opts.cursor ? { cursor: opts.cursor } : {}), ...(opts.status ? { status: opts.status } : {}) };
        const res = await spin("Cargando webhooks…", () => api("GET", "/webhooks", { query, team: opts.team }));
        const items = res.data || [];
        if (isJsonMode()) return printJson(res);
        printTable(
          items.map((w: any) => ({
            id: w.id ? w.id.slice(0, 12) + "…" : "—",
            url: (w.url || "—").slice(0, 40),
            events: (w.events || []).join(", ").slice(0, 30) || "all",
          })),
        );
        if (res.has_more) console.log(`Siguiente página: --cursor ${res.next_cursor}`);
      } catch (e: any) { error(e); }
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
      } catch (e: any) { error(e); }
    });

  webhooks
    .command("delete <id>")
    .description("Eliminar un webhook")
    .option("--team <id>", "Team ID")
    .action(async (id, opts) => {
      try {
        await api("DELETE", `/webhooks/${id}`, { team: opts.team });
        success(`Webhook ${id} eliminado`);
      } catch (e: any) { error(e); }
    });
}
