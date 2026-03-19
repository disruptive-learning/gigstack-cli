import { Command } from "commander";
import { api } from "../api.js";
import { printTable, printJson, printKeyValue, success, error, isJsonMode, formatMoney, formatDate } from "../output.js";

export function registerPaymentCommands(program: Command) {
  const payments = program.command("payments").description("Gestionar pagos y cobros");

  payments
    .command("list")
    .description("Listar pagos")
    .option("-l, --limit <n>", "Límite", "20")
    .option("--status <status>", "Filtrar por status")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const query: Record<string, string> = { limit: opts.limit };
        if (opts.status) query.status = opts.status;
        const res = await api("GET", "/payments", { query, team: opts.team });
        const items = res.data || [];
        if (isJsonMode()) return printJson(items);
        printTable(
          items.map((p: any) => ({
            id: p.id ? p.id.slice(0, 12) + "…" : "—",
            cliente: (p.client?.legal_name || p.client?.name || "—").slice(0, 25),
            total: formatMoney(p.total, p.currency),
            status: p.status,
            fecha: formatDate(p.created_at),
          })),
        );
      } catch (e: any) { error(e.message); }
    });

  payments
    .command("get <id>")
    .description("Ver detalle de un pago")
    .option("--team <id>", "Team ID")
    .action(async (id, opts) => {
      try {
        const res = await api("GET", `/payments/${id}`, { team: opts.team });
        const p = res.data;
        if (isJsonMode()) return printJson(p);
        printKeyValue({
          ID: p.id || "—",
          Status: p.status,
          Cliente: p.client?.legal_name || p.client?.name || "—",
          Total: formatMoney(p.total, p.currency),
          "Link de pago": p.short_url || "—",
          Creado: formatDate(p.created_at),
        });
      } catch (e: any) { error(e.message); }
    });

  payments
    .command("request")
    .description("Solicitar un pago (genera link de cobro)")
    .requiredOption("--client <id>", "ID del cliente")
    .requiredOption("--items <json>", 'Items JSON')
    .option("--currency <code>", "Moneda", "MXN")
    .option("--methods <list>", "Métodos permitidos (card,bank,oxxo,stripe-spei)", "card,bank")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        let items;
        try { items = JSON.parse(opts.items); } catch { error("Items JSON inválido"); process.exit(1); }
        const res = await api("POST", "/payments/request", {
          body: {
            client: { id: opts.client },
            items,
            currency: opts.currency,
            allowed_payment_methods: opts.methods.split(","),
          },
          team: opts.team,
        });
        success(`Pago solicitado: ${res.data.id}`);
        if (res.data.short_url) console.log(`  Link: ${res.data.short_url}`);
        if (isJsonMode()) printJson(res.data);
      } catch (e: any) { error(e.message); }
    });

  payments
    .command("register")
    .description("Registrar un pago recibido")
    .requiredOption("--client <id>", "ID del cliente")
    .requiredOption("--items <json>", 'Items JSON')
    .requiredOption("--payment-form <code>", "Forma de pago (03=Transferencia, etc)")
    .option("--currency <code>", "Moneda", "MXN")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        let items;
        try { items = JSON.parse(opts.items); } catch { error("Items JSON inválido"); process.exit(1); }
        const res = await api("POST", "/payments/register", {
          body: {
            automation_type: "stamp_invoice",
            client: { id: opts.client },
            items,
            currency: opts.currency,
            payment_form: opts.paymentForm,
            idempotency_key: `cli_${Date.now()}`,
          },
          team: opts.team,
        });
        success(`Pago registrado: ${res.data.id}`);
        if (isJsonMode()) printJson(res.data);
      } catch (e: any) { error(e.message); }
    });

  payments
    .command("refund <id>")
    .description("Reembolsar un pago")
    .option("--team <id>", "Team ID")
    .action(async (id, opts) => {
      try {
        const res = await api("POST", `/payments/${id}/refund`, { team: opts.team });
        success(`Pago ${id} reembolsado`);
        if (isJsonMode()) printJson(res.data);
      } catch (e: any) { error(e.message); }
    });
}
