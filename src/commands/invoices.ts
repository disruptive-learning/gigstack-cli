import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import pc from "picocolors";
import { api } from "../api.js";
import { printTable, printJson, printKeyValue, success, error, isJsonMode, formatMoney, formatDate, spin } from "../output.js";
import { ask, askRequired, select, confirm } from "../prompt.js";
import { withListOpts, buildListQuery, printPaginationHint } from "../list-opts.js";

function uid(item: any): string {
  return item.uuid ? item.uuid.slice(0, 8) + "…" : item.id ? item.id.slice(0, 12) + "…" : "—";
}

export function registerInvoiceCommands(program: Command) {
  const invoices = program.command("invoices").description("Gestionar facturas CFDI");

  withListOpts(
    invoices
      .command("list")
      .description("Listar facturas de ingreso")
  )
    .option("--status <status>", "Filtrar por status (valid, cancelled)")
    .option("--client <id>", "Filtrar por cliente")
    .option("--series <series>", "Filtrar por serie")
    .action(async (opts) => {
      try {
        const query = buildListQuery(opts);
        if (opts.status) query.status = opts.status;
        if (opts.client) query.client_id = opts.client;
        if (opts.series) query.series = opts.series;
        const res = await spin("Cargando facturas…", () => api("GET", "/invoices/income", { query, team: opts.team }));
        const items = res.data || [];
        if (isJsonMode()) return printJson(items);
        printTable(
          items.map((i: any) => ({
            uuid: uid(i),
            cliente: (i.client?.legal_name || i.client?.name || "—").slice(0, 25),
            total: formatMoney(i.total, i.currency),
            método: i.payment_method || "—",
            status: i.status || "—",
            fecha: formatDate(i.created_at),
          })),
        );
        printPaginationHint(res);
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
          Email: i.client?.email || "—",
          Subtotal: formatMoney(i.subtotal, i.currency),
          Total: formatMoney(i.total, i.currency),
          "Método pago": i.payment_method || "—",
          "Forma pago": i.payment_form || "—",
          Serie: i.series || "—",
          Folio: i.folio_number || "—",
          "Saldo pendiente": i.last_balance !== undefined ? formatMoney(i.last_balance, i.currency) : "—",
          Complementos: i.payment_complements ?? "—",
          Creado: formatDate(i.created_at),
        });
      } catch (e: any) { error(e.message); }
    });

  invoices
    .command("create")
    .description("Crear factura de ingreso (CFDI 4.0) — interactivo si no se pasan flags")
    .option("--client <id>", "ID del cliente")
    .option("--items <json>", 'Items JSON: [{"description":"...","quantity":1,"unit_price":100,"product_key":"84111506","unit_key":"E48"}]')
    .option("--payment-form <code>", "Forma de pago (ej: 01=Efectivo, 03=Transferencia, 04=Tarjeta)", "03")
    .option("--payment-method <code>", "Método de pago (PUE o PPD)", "PUE")
    .option("--use <use>", "Uso CFDI", "G03")
    .option("--currency <code>", "Moneda", "MXN")
    .option("--series <series>", "Serie")
    .option("--send-email", "Enviar factura por email al cliente")
    .option("--emails <emails>", "Emails adicionales (separados por coma)")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const interactive = !opts.client && !opts.items;
        let clientId = opts.client;
        let items: any[];

        if (interactive) {
          const clientQuery = await askRequired("Buscar cliente (nombre, RFC, email o ID)");

          if (clientQuery.startsWith("client_") || clientQuery.match(/^[a-zA-Z0-9_-]{10,}$/)) {
            try {
              const directRes = await spin("Buscando cliente…", () => api("GET", `/clients/${clientQuery}`, { team: opts.team }));
              if (directRes.data) {
                clientId = directRes.data.id;
                const c = directRes.data;
                console.log(pc.dim(`  → ${c.legal_name || c.name || "—"} (${c.tax_id || "sin RFC"})`));
              }
            } catch {
              // Not found by ID, fall through to search
            }
          }

          if (!clientId) {
            const searchRes = await spin("Buscando cliente…", () => api("GET", "/clients/search", { query: { q: clientQuery }, team: opts.team }));
            const found = searchRes.data || [];
            if (found.length === 0) { error("No se encontró el cliente"); process.exit(1); }
            if (found.length === 1) {
              clientId = found[0].id;
              console.log(pc.dim(`  → ${found[0].legal_name || found[0].name} (${found[0].tax_id || "sin RFC"})`));
            } else {
              clientId = await select(
                "Selecciona cliente",
                found.slice(0, 8).map((c: any) => ({
                  label: `${c.legal_name || c.name} — ${c.tax_id || "sin RFC"}`,
                  value: c.id,
                })),
              );
            }
          }

          items = [];
          let addMore = true;
          while (addMore) {
            console.log(pc.bold(`\nConcepto ${items.length + 1}`));
            const description = await askRequired("Descripción");
            const quantity = parseFloat(await ask("Cantidad", "1")) || 1;
            const unitPrice = parseFloat(await askRequired("Precio unitario"));
            const productKey = await ask("Clave producto SAT", "84111506");
            const unitKey = await ask("Clave unidad SAT", "E48");
            const addIva = await confirm("Agregar IVA 16%?");

            const item: any = { description, quantity, unit_price: unitPrice, product_key: productKey, unit_key: unitKey };
            if (addIva) item.taxes = [{ type: "IVA", rate: 0.16, factor: "Tasa", withholding: false }];
            items.push(item);
            addMore = await confirm("Agregar otro concepto?", false);
          }

          opts.paymentForm = await select("Forma de pago", [
            { label: "03 — Transferencia electrónica", value: "03" },
            { label: "01 — Efectivo", value: "01" },
            { label: "04 — Tarjeta de crédito", value: "04" },
            { label: "28 — Tarjeta de débito", value: "28" },
            { label: "99 — Por definir", value: "99" },
          ]);
          opts.paymentMethod = await select("Método de pago", [
            { label: "PUE — Pago en una sola exhibición", value: "PUE" },
            { label: "PPD — Pago en parcialidades o diferido", value: "PPD" },
          ]);

          const subtotal = items.reduce((sum: number, i: any) => sum + i.quantity * i.unit_price, 0);
          console.log(`\n${pc.bold("Resumen:")}`);
          console.log(`  Cliente: ${clientId}`);
          console.log(`  Conceptos: ${items.length}`);
          console.log(`  Subtotal: ${formatMoney(subtotal, opts.currency)}`);
          console.log(`  Forma pago: ${opts.paymentForm}  Método: ${opts.paymentMethod}`);

          const proceed = await confirm("\nTimbrar factura?");
          if (!proceed) { console.log(pc.dim("Cancelado")); return; }
        } else {
          if (!clientId) { error("--client es requerido"); process.exit(1); }
          if (!opts.items) { error("--items es requerido"); process.exit(1); }
          try { items = JSON.parse(opts.items); } catch { error("Items JSON inválido"); process.exit(1); }
        }

        const body: any = {
          client: { id: clientId },
          items,
          payment_form: opts.paymentForm,
          payment_method: opts.paymentMethod,
          use: opts.use,
          currency: opts.currency,
          series: opts.series || undefined,
        };
        if (opts.sendEmail) body.send_email = true;
        if (opts.emails) body.emails = opts.emails.split(",").map((e: string) => e.trim());

        const res = await spin("Timbrando factura…", () => api("POST", "/invoices/income", { body, team: opts.team }));
        success(`Factura creada: ${res.data.uuid || res.data.id}`);
        if (isJsonMode()) printJson(res.data);
        else console.log(`  Total: ${formatMoney(res.data.total, res.data.currency)}`);
      } catch (e: any) { error(e.message); }
    });

  invoices
    .command("send <uuid>")
    .description("Reenviar factura por email (PDF + XML adjuntos)")
    .option("--to <emails>", "Emails adicionales separados por coma")
    .option("--team <id>", "Team ID")
    .action(async (uuid, opts) => {
      try {
        const body: any = {};
        if (opts.to) body.emails = opts.to.split(",").map((e: string) => e.trim());
        const res = await spin("Enviando factura por email…", () => api("POST", `/invoices/${uuid}/send`, { body, team: opts.team }));
        if (isJsonMode()) return printJson(res.data);
        success(`Email enviado a: ${(res.data?.recipients || []).join(", ")}`);
        if (res.data?.attachments?.length) {
          console.log(pc.dim(`  Adjuntos: ${res.data.attachments.join(", ")}`));
        }
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
        await spin("Cancelando factura…", () => api("DELETE", `/invoices/${uuid}`, {
          body: { motive: opts.motive, replacement: opts.replacement },
          team: opts.team,
        }));
        success(`Factura ${uuid} cancelada`);
      } catch (e: any) { error(e.message); }
    });

  invoices
    .command("search <query>")
    .description("Buscar facturas")
    .option("--team <id>", "Team ID")
    .action(async (query, opts) => {
      try {
        const res = await spin("Buscando facturas…", () => api("GET", "/invoices/search", { query: { q: query }, team: opts.team }));
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

  invoices
    .command("download <uuid>")
    .description("Descargar PDF y XML de una factura al directorio actual")
    .option("-o, --out <dir>", "Directorio de salida", ".")
    .option("--team <id>", "Team ID")
    .action(async (uuid, opts) => {
      try {
        const res = await spin("Obteniendo archivos…", () => api("GET", `/invoices/${uuid}/files`, { team: opts.team }));
        const files = res.data;
        const saved: string[] = [];
        if (files.pdf) {
          const pdfRes = await spin("Descargando PDF…", () => fetch(files.pdf));
          const buf = Buffer.from(await pdfRes.arrayBuffer());
          const path = join(opts.out, `${uuid}.pdf`);
          writeFileSync(path, buf);
          saved.push(path);
        }
        if (files.xml) {
          const xmlRes = await spin("Descargando XML…", () => fetch(files.xml));
          const buf = Buffer.from(await xmlRes.arrayBuffer());
          const path = join(opts.out, `${uuid}.xml`);
          writeFileSync(path, buf);
          saved.push(path);
        }
        if (saved.length === 0) error("No se encontraron archivos para esta factura");
        else success(`Descargado: ${saved.join(", ")}`);
      } catch (e: any) { error(e.message); }
    });

  // Drafts
  const drafts = invoices.command("drafts").description("Pre-facturas / borradores");

  withListOpts(drafts.command("list").description("Listar borradores"))
    .action(async (opts) => {
      try {
        const query = buildListQuery(opts);
        const res = await spin("Cargando borradores…", () => api("GET", "/invoices/draft", { query, team: opts.team }));
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
        printPaginationHint(res);
      } catch (e: any) { error(e.message); }
    });

  drafts
    .command("stamp <uuid>")
    .description("Timbrar borrador (convertir a CFDI)")
    .option("--team <id>", "Team ID")
    .action(async (uuid, opts) => {
      try {
        const res = await spin("Timbrando borrador…", () => api("POST", `/invoices/draft/${uuid}/stamp`, { team: opts.team }));
        success(`Borrador timbrado: ${res.data.uuid || res.data.id}`);
        if (isJsonMode()) printJson(res.data);
      } catch (e: any) { error(e.message); }
    });

  // Credit notes
  withListOpts(invoices.command("credit-notes").description("Listar notas de crédito"))
    .action(async (opts) => {
      try {
        const query = buildListQuery(opts);
        const res = await spin("Cargando notas de crédito…", () => api("GET", "/invoices/egress", { query, team: opts.team }));
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
        printPaginationHint(res);
      } catch (e: any) { error(e.message); }
    });

  // Complements
  withListOpts(invoices.command("complements").description("Listar complementos de pago"))
    .option("--invoice <uuid>", "Filtrar por factura PPD relacionada")
    .action(async (opts) => {
      try {
        const query = buildListQuery(opts);
        if (opts.invoice) query.invoice_id = opts.invoice;
        const res = await spin("Cargando complementos…", () => api("GET", "/invoices/complements", { query, team: opts.team }));
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
        printPaginationHint(res);
      } catch (e: any) { error(e.message); }
    });
}
