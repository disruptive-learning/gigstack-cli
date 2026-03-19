import { Command } from "commander";
import { api } from "../api.js";
import { printTable, printJson, printKeyValue, success, error, isJsonMode } from "../output.js";

export function registerWebhookCommands(program: Command) {
  const webhooks = program.command("webhooks").description("Gestionar webhooks");

  webhooks
    .command("list")
    .description("Listar webhooks configurados")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const res = await api("GET", "/webhooks", { team: opts.team });
        const items = res.data || [];
        if (isJsonMode()) return printJson(items);
        printTable(
          items.map((w: any) => ({
            id: w.id ? w.id.slice(0, 12) + "…" : "—",
            url: (w.url || "—").slice(0, 40),
            events: (w.events || []).join(", ").slice(0, 30) || "all",
          })),
        );
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
        const res = await api("POST", "/webhooks", { body, team: opts.team });
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
