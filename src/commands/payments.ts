import { hasJsonInput, sendCompleteBody, withCompleteBody } from "../core-input.js";
import { requireConfirmation, segment } from "../input.js";
import { registerSupportDocumentCommands } from "./documents.js";
import { Command } from "commander";
import { api } from "../api.js";
import { printTable, printJson, printListJson, printKeyValue, success, error, isJsonMode, formatMoney, formatDate, spin } from "../output.js";
import { withListOpts, buildListQuery, printPaginationHint } from "../list-opts.js";

export function registerPaymentCommands(program: Command) {
  const payments = program.command("payments").description("Gestionar pagos y cobros");
  registerSupportDocumentCommands(payments, "payments");
  payments.command("search <query>").description("Search payments; preserve the complete response and pagination")
    .option("--limit <n>", "Maximum results").option("--page <n>", "Search page").option("--fields <fields>", "Comma-separated search fields")
    .option("--status <status>", "Payment status").option("--currency <code>", "Currency").option("--client <id>", "Client ID")
    .action(async (q, opts) => {
      const query: Record<string,string> = {q};
      for (const key of ["limit","page","fields","status","currency"]) if(opts[key] !== undefined) query[key]=opts[key];
      if(opts.client !== undefined) query.client_id=opts.client;
      printJson(await api("GET", "/payments/search", { query }));
    });
  for (const [name, method, suffix] of [["update", "PUT", ""], ["paid", "POST", "/paid"]]) {
    withCompleteBody(payments.command(`${name} <id>`).description("Apply the endpoint's full JSON body; server validates fields and permissions"))
      .action(async (id, opts, command) => sendCompleteBody(command, opts, method, `/payments/${segment(id)}${suffix}`));
  }
  payments.command("cancel <id>").description("Cancel the payment using its public cancellation rules")
    .option("-y, --yes", "Confirm cancellation")
    .action(async (id, opts) => {
      const path = `/payments/${segment(id)}`;
      await requireConfirmation(opts.yes, "Cancel this payment in the selected team and mode?");
      printJson(await api("DELETE", path));
    });

  withListOpts(
    payments
      .command("list")
      .description("Listar pagos")
  )
    .option("--status <status>", "Filtrar: pending, succeeded, failed, cancelled, refunded")
    .option("--client <id>", "Filtrar por cliente")
    .option("--currency <code>", "Filtrar por moneda (MXN, USD)")
    .option("--email <email>", "Filtrar por email del cliente")
    .option("--rfc <rfc>", "Filtrar por RFC del cliente")
    .action(async (opts) => {
      try {
        const query = buildListQuery(opts);
        if (opts.status) query.status = opts.status;
        if (opts.client) query.client_id = opts.client;
        if (opts.currency) query.currency = opts.currency;
        if (opts.email) query.email = opts.email;
        if (opts.rfc) query.tax_id = opts.rfc;
        const res = await spin("Cargando pagos…", () => api("GET", "/payments", { query, team: opts.team }));
        const items = res.data || [];
        if (isJsonMode()) return printListJson(res, items);
        printTable(
          items.map((p: any) => ({
            id: p.id ? p.id.slice(0, 12) + "…" : "—",
            cliente: (p.client?.legal_name || p.client?.name || "—").slice(0, 25),
            total: formatMoney(p.total, p.currency),
            status: p.status,
            fecha: formatDate(p.created_at),
          })),
        );
        printPaginationHint(res);
      } catch (e: any) { error(e); }
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
          Email: p.client?.email || "—",
          RFC: p.client?.tax_id || "—",
          Total: formatMoney(p.total, p.currency),
          "Forma pago": p.payment_form || "—",
          "Link de pago": p.short_url || "—",
          Creado: formatDate(p.created_at),
        });
      } catch (e: any) { error(e); }
    });

  withCompleteBody(payments
    .command("request")
    .description("Solicitar un pago (genera link de cobro)")
    .option("--client <id>", "ID del cliente")
    .option("--items <json>", 'Items JSON')
    .option("--currency <code>", "Moneda", "MXN")
    .option("--methods <list>", "Métodos permitidos (card,bank,oxxo,stripe-spei)", "card,bank")
    .option("--automation <type>", "Automatización al pagar: none, pue_invoice, ppd_invoice_and_complement", "none")
    .option("--send-email", "Enviar link por email al cliente")
    .option("--idempotency-key <key>", "Stable caller-selected key; keep the same value for the same intended payment")
    .option("--team <id>", "Team ID"))
    .action(async (opts, command) => {
      try {
        if (hasJsonInput(opts)) return await sendCompleteBody(command, opts, "POST", "/payments/request");
        if (!opts.client || !opts.items) throw new Error("Provide the required client/items/payment fields or a complete JSON body");
        let items;
        try { items = JSON.parse(opts.items); } catch { error("Items JSON inválido"); process.exit(1); }
        const body: any = {
          client: { id: opts.client },
          items,
          currency: opts.currency,
          allowed_payment_methods: opts.methods.split(","),
          automation_type: opts.automation || "none",
        };
        if (opts.idempotencyKey !== undefined) body.idempotency_key = opts.idempotencyKey;
        if (opts.sendEmail) body.send_email = true;
        const res = await spin("Creando solicitud de pago…", () => api("POST", "/payments/request", { body, team: opts.team }));
        if (isJsonMode()) return printJson(res.data);
        success(`Pago solicitado: ${res.data.id}`);
        if (res.data.short_url) console.log(`  Link: ${res.data.short_url}`);
        if (isJsonMode()) printJson(res.data);
      } catch (e: any) { error(e); }
    });

  withCompleteBody(payments
    .command("register")
    .description("Registrar un pago recibido")
    .option("--client <id>", "ID del cliente")
    .option("--items <json>", 'Items JSON')
    .option("--payment-form <code>", "Forma de pago (03=Transferencia, etc)")
    .option("--currency <code>", "Moneda", "MXN")
    .option("--automation <type>", "Automatización: pue_invoice, ppd_invoice_and_complement, none", "pue_invoice")
    .option("--send-email", "Enviar confirmación por email")
    .option("--idempotency-key <key>", "Stable caller-selected key; keep the same value for the same intended payment")
    .option("--team <id>", "Team ID"))
    .action(async (opts, command) => {
      try {
        if (hasJsonInput(opts)) return await sendCompleteBody(command, opts, "POST", "/payments/register");
        if (!opts.client || !opts.items || !opts.paymentForm) throw new Error("Provide the required client/items/payment fields or a complete JSON body");
        let items;
        try { items = JSON.parse(opts.items); } catch { error("Items JSON inválido"); process.exit(1); }
        const body: any = {
          automation_type: opts.automation || "pue_invoice",
          client: { id: opts.client },
          items,
          currency: opts.currency,
          payment_form: opts.paymentForm,

        };
        if (opts.idempotencyKey !== undefined) body.idempotency_key = opts.idempotencyKey;
        if (opts.sendEmail) body.send_email = true;
        const res = await spin("Registrando pago…", () => api("POST", "/payments/register", { body, team: opts.team }));
        if (isJsonMode()) return printJson(res.data);
        success(`Pago registrado: ${res.data.id}`);
        if (isJsonMode()) printJson(res.data);
      } catch (e: any) { error(e); }
    });

  withCompleteBody(payments
    .command("refund <id>")
    .description("Reembolsar un pago")
    .option("--team <id>", "Team ID"))
    .action(async (id, opts, command) => {
      try {
        const path = `/payments/${segment(id)}/refund`;
        if (hasJsonInput(opts)) return await sendCompleteBody(command, opts, "POST", path);
        throw new Error("Refund requires a JSON body with reason and amount; use --file/--stdin/--data and --yes");
      } catch (e: any) { error(e); }
    });
}
