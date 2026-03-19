import { Command } from "commander";
import { api } from "../api.js";
import { printTable, printJson, printKeyValue, success, error, isJsonMode, formatMoney, formatDate } from "../output.js";

function uid(item: any): string {
  return item.uuid ? item.uuid.slice(0, 8) + "…" : item.id ? item.id.slice(0, 12) + "…" : "—";
}

export function registerInvoiceCommands(program: Command) {
  const invoices = program.command("invoices").description("Gestionar facturas CFDI");

  invoices
    .command("list")
    .description("Listar facturas de ingreso")
    .option("-l, --limit <n>", "Límite", "20")
    .option("--status <status>", "Filtrar por status")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const query: Record<string, string> = { limit: opts.limit };
        if (opts.status) query.status = opts.status;
        const res = await api("GET", "/invoices/income", { query, team: opts.team });
        const items = res.data || [];
        if (isJsonMode()) return printJson(items);
        printTable(
          items.map((i: any) => ({
            uuid: uid(i),
            cliente: (i.client?.legal_name || i.client?.name || "—").slice(0, 25),
            total: formatMoney(i.total, i.currency),
            status: i.status || "—",
            fecha: formatDate(i.created_at),
          })),
        );
        if (res.has_more) console.log(`\n... ${res.total_results} total`);
      } catch (e: any) { error(e.message); }
    });

  invoices
    .command("get <uuid>")
    .description("Ver detalle de una factura")
    .option("--team <id>", "Team ID")
    .action(async (uuid, opts) => {
      try {
        const res = await api("GET", `/invoices/income/${uuid}`, { team: opts.team });
        const i = res.data;
        if (isJsonMode()) return printJson(i);
        printKeyValue({
          UUID: i.uuid || i.id || "—",
          Status: i.status || "—",
          Cliente: i.client?.legal_name || i.client?.name || "—",
          RFC: i.client?.tax_id || "—",
          Subtotal: formatMoney(i.subtotal, i.currency),
          Total: formatMoney(i.total, i.currency),
          "Método pago": i.payment_method || "—",
          "Forma pago": i.payment_form || "—",
          Serie: i.series || "—",
          Folio: i.folio_number || "—",
          Creado: formatDate(i.created_at),
        });
      } catch (e: any) { error(e.message); }
    });

  invoices
    .command("create")
    .description("Crear factura de ingreso (CFDI 4.0)")
    .requiredOption("--client <id>", "ID del cliente")
    .requiredOption("--items <json>", 'Items JSON: [{"description":"...","quantity":1,"unit_price":100,"product_key":"84111506","unit_key":"E48"}]')
    .option("--payment-form <code>", "Forma de pago (ej: 01=Efectivo, 03=Transferencia, 04=Tarjeta)", "03")
    .option("--payment-method <code>", "Método de pago (PUE o PPD)", "PUE")
    .option("--use <use>", "Uso CFDI", "G03")
    .option("--currency <code>", "Moneda", "MXN")
    .option("--series <series>", "Serie")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        let items;
        try { items = JSON.parse(opts.items); } catch { error("Items JSON inválido"); process.exit(1); }

        const res = await api("POST", "/invoices/income", {
          body: {
            automation_type: "stamp_invoice",
            client: { id: opts.client },
            items,
            payment_form: opts.paymentForm,
            payment_method: opts.paymentMethod,
            use: opts.use,
            currency: opts.currency,
            series: opts.series,
          },
          team: opts.team,
        });
        success(`Factura creada: ${res.data.uuid || res.data.id}`);
        if (isJsonMode()) printJson(res.data);
        else console.log(`  Total: ${formatMoney(res.data.total, res.data.currency)}`);
      } catch (e: any) { error(e.message); }
    });

  invoices
    .command("cancel <uuid>")
    .description("Cancelar una factura")
    .requiredOption("--motive <code>", "Motivo de cancelación (01, 02, 03, 04)")
    .option("--replacement <uuid>", "UUID de factura de reemplazo (para motivo 01)")
    .option("--team <id>", "Team ID")
    .action(async (uuid, opts) => {
      try {
        await api("DELETE", `/invoices/${uuid}`, {
          body: { motive: opts.motive, replacement: opts.replacement },
          team: opts.team,
        });
        success(`Factura ${uuid} cancelada`);
      } catch (e: any) { error(e.message); }
    });

  invoices
    .command("search <query>")
    .description("Buscar facturas")
    .option("--team <id>", "Team ID")
    .action(async (query, opts) => {
      try {
        const res = await api("GET", "/invoices/search", { query: { q: query }, team: opts.team });
        const items = res.data || [];
        if (isJsonMode()) return printJson(items);
        printTable(
          items.map((i: any) => ({
            uuid: uid(i),
            cliente: (i.client?.legal_name || "—").slice(0, 25),
            total: formatMoney(i.total, i.currency),
            status: i.status || "—",
          })),
        );
      } catch (e: any) { error(e.message); }
    });

  invoices
    .command("files <uuid>")
    .description("Obtener archivos PDF/XML de una factura")
    .option("--team <id>", "Team ID")
    .action(async (uuid, opts) => {
      try {
        const res = await api("GET", `/invoices/${uuid}/files`, { team: opts.team });
        if (isJsonMode()) return printJson(res.data);
        const files = res.data;
        if (files.pdf) console.log(`PDF: ${files.pdf}`);
        if (files.xml) console.log(`XML: ${files.xml}`);
      } catch (e: any) { error(e.message); }
    });

  // Drafts
  const drafts = invoices.command("drafts").description("Pre-facturas / borradores");

  drafts
    .command("list")
    .description("Listar borradores")
    .option("-l, --limit <n>", "Límite", "20")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const res = await api("GET", "/invoices/draft", { query: { limit: opts.limit }, team: opts.team });
        const items = res.data || [];
        if (isJsonMode()) return printJson(items);
        printTable(
          items.map((i: any) => ({
            uuid: uid(i),
            cliente: (i.client?.legal_name || "—").slice(0, 25),
            total: formatMoney(i.total || 0, i.currency),
            fecha: formatDate(i.created_at),
          })),
        );
      } catch (e: any) { error(e.message); }
    });

  drafts
    .command("stamp <uuid>")
    .description("Timbrar borrador (convertir a CFDI)")
    .option("--team <id>", "Team ID")
    .action(async (uuid, opts) => {
      try {
        const res = await api("POST", `/invoices/draft/${uuid}/stamp`, { team: opts.team });
        success(`Borrador timbrado: ${res.data.uuid || res.data.id}`);
        if (isJsonMode()) printJson(res.data);
      } catch (e: any) { error(e.message); }
    });

  // Credit notes
  invoices
    .command("credit-notes")
    .description("Listar notas de crédito")
    .option("-l, --limit <n>", "Límite", "20")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const res = await api("GET", "/invoices/egress", { query: { limit: opts.limit }, team: opts.team });
        const items = res.data || [];
        if (isJsonMode()) return printJson(items);
        printTable(
          items.map((i: any) => ({
            uuid: uid(i),
            cliente: (i.client?.legal_name || "—").slice(0, 25),
            total: formatMoney(i.total, i.currency),
            status: i.status || "—",
          })),
        );
      } catch (e: any) { error(e.message); }
    });

  // Complements
  invoices
    .command("complements")
    .description("Listar complementos de pago")
    .option("-l, --limit <n>", "Límite", "20")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const res = await api("GET", "/invoices/complements", { query: { limit: opts.limit }, team: opts.team });
        const items = res.data || [];
        if (isJsonMode()) return printJson(items);
        printTable(
          items.map((i: any) => ({
            uuid: uid(i),
            cliente: (i.client?.legal_name || "—").slice(0, 25),
            total: formatMoney(i.total, i.currency),
            status: i.status || "—",
          })),
        );
      } catch (e: any) { error(e.message); }
    });
}
