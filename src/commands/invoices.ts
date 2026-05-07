import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import pc from "picocolors";
import { api } from "../api.js";
import { printTable, printJson, printListJson, printKeyValue, success, error, isJsonMode, formatMoney, formatDate, spin } from "../output.js";
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
        if (isJsonMode()) return printListJson(res, items);
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
        if (isJsonMode()) return printListJson(res, items);
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
        if (isJsonMode()) return printListJson(res, items);
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
        if (isJsonMode()) return printListJson(res, items);
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
        const res = await spin("Cargando complementos…", () => api("GET", "/invoices/payment", { query, team: opts.team }));
        const items = res.data || [];
        if (isJsonMode()) return printListJson(res, items);
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

  // Descarga Masiva SAT
  const sat = invoices.command("sat").description("Descarga Masiva SAT — facturas recibidas y emitidas");

  withListOpts(sat.command("list").description("Listar facturas descargadas del SAT"))
    .option("--direction <dir>", "Dirección: issued (emitidas) o received (recibidas)")
    .option("--status <status>", "Status SAT: Vigente o Cancelado")
    .option("--type <code>", "Tipo de comprobante: I, E, P, N, T")
    .option("--issuer-rfc <rfc>", "Filtrar por RFC del emisor")
    .option("--receiver-rfc <rfc>", "Filtrar por RFC del receptor")
    .action(async (opts) => {
      try {
        const query: Record<string, string> = { limit: opts.limit };
        if (opts.next) query.starting_after = opts.next;
        if (opts.from) query.from = opts.from;
        if (opts.to) query.to = opts.to;
        if (opts.direction) query.direction = opts.direction;
        if (opts.status) query.status = opts.status;
        if (opts.type) query.invoice_type = opts.type;
        if (opts.issuerRfc) query.issuer_rfc = opts.issuerRfc;
        if (opts.receiverRfc) query.receiver_rfc = opts.receiverRfc;

        const res = await spin("Cargando facturas SAT…", () => api("GET", "/invoices/sat", { query, team: opts.team }));
        const items = res.data || [];
        if (isJsonMode()) return printListJson(res, items);
        printTable(
          items.map((i: any) => ({
            uuid: uid(i),
            dir: i.direction === "issued" ? "emit" : "recib",
            tipo: i.invoice_type || "—",
            emisor: (i.issuer?.name || i.issuer?.rfc || "—").slice(0, 22),
            receptor: (i.receiver?.name || i.receiver?.rfc || "—").slice(0, 22),
            total: formatMoney(i.total, i.currency),
            status: i.status || "—",
            estado: i.resource_status || "—",
            fecha: formatDate(i.issue_date),
          })),
        );
        if (res.has_more && res.next) {
          console.log(pc.dim(`\n... más resultados. Usa --next ${res.next} para la siguiente página`));
        }
      } catch (e: any) { error(e.message); }
    });

  sat
    .command("get <uuid>")
    .description("Ver detalle de una factura del SAT")
    .option("--team <id>", "Team ID")
    .action(async (uuid, opts) => {
      try {
        const res = await api("GET", `/invoices/sat/${uuid}`, { team: opts.team });
        const i = res.data;
        if (isJsonMode()) return printJson(i);
        printKeyValue({
          UUID: i.uuid || "—",
          Dirección: i.direction === "issued" ? "Emitida" : "Recibida",
          Tipo: i.invoice_type || "—",
          "Estado XML": i.resource_status || "—",
          "Tiene XML": i.has_xml ? "sí" : "no",
          "Status SAT": i.status || "—",
          "Emisor RFC": i.issuer?.rfc || "—",
          "Emisor": i.issuer?.name || "—",
          "Receptor RFC": i.receiver?.rfc || "—",
          "Receptor": i.receiver?.name || "—",
          Subtotal: formatMoney(i.subtotal, i.currency),
          Total: formatMoney(i.total, i.currency),
          "Tipo cambio": i.exchange_rate ?? "—",
          Serie: i.series || "—",
          Folio: i.folio || "—",
          "Fecha emisión": formatDate(i.issue_date),
          "Fecha timbrado": formatDate(i.stamp_date),
          "Fecha cancelación": i.cancellation_date ? formatDate(i.cancellation_date) : "—",
          "PAC RFC": i.pac_rfc || "—",
          Versión: i.version || "—",
          "No. certificado": i.certificate_number || "—",
        });
      } catch (e: any) { error(e.message); }
    });

  sat
    .command("retry <uuid>")
    .description("Reintentar descarga del XML para facturas atascadas o con error")
    .option("--team <id>", "Team ID")
    .action(async (uuid, opts) => {
      try {
        const res = await spin("Reintentando descarga del XML…", () => api("POST", `/invoices/sat/${uuid}/retry-xml`, { team: opts.team }));
        if (isJsonMode()) return printJson(res);
        success(res.message || "XML descargado correctamente");
        if (res.data?.credit_charged !== undefined) {
          console.log(pc.dim(`  Crédito cobrado: ${res.data.credit_charged ? "sí" : "no"}`));
        }
      } catch (e: any) { error(e.message); }
    });

  sat
    .command("pdf <uuid>")
    .description("Generar y descargar el PDF de una factura del SAT")
    .option("-o, --out <dir>", "Directorio de salida", ".")
    .option("--team <id>", "Team ID")
    .action(async (uuid, opts) => {
      try {
        const res = await spin("Generando PDF…", () => api("POST", `/invoices/sat/${uuid}/pdf`, { team: opts.team }));
        const pdfBase64 = res.pdf;
        if (!pdfBase64) { error("La respuesta no contiene PDF"); return; }
        const buf = Buffer.from(pdfBase64, "base64");
        const path = join(opts.out, `${uuid}.pdf`);
        writeFileSync(path, buf);
        if (isJsonMode()) return printJson({ path, bytes: buf.length });
        success(`PDF descargado: ${path}`);
      } catch (e: any) { error(e.message); }
    });

  sat
    .command("download <uuid>")
    .description("Descargar PDF de una factura del SAT (el XML solo se expone vía web app)")
    .option("-o, --out <dir>", "Directorio de salida", ".")
    .option("--team <id>", "Team ID")
    .action(async (uuid, opts) => {
      try {
        const res = await spin("Generando PDF…", () => api("POST", `/invoices/sat/${uuid}/pdf`, { team: opts.team }));
        const pdfBase64 = res.pdf;
        if (!pdfBase64) { error("La respuesta no contiene PDF"); return; }
        const buf = Buffer.from(pdfBase64, "base64");
        const path = join(opts.out, `${uuid}.pdf`);
        writeFileSync(path, buf);
        if (isJsonMode()) return printJson({ path, bytes: buf.length, xml_available: false });
        success(`PDF descargado: ${path}`);
        console.log(pc.dim("  Nota: el XML del SAT solo está disponible desde app.gigstack.pro/gastos"));
      } catch (e: any) { error(e.message); }
    });

  sat
    .command("status")
    .description("Ver estado de activación de Descarga Masiva SAT")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const res = await api("GET", "/invoices/download/activate/status", { team: opts.team });
        const d = res.data;
        if (isJsonMode()) return printJson(d);

        const statusLabel: Record<string, string> = {
          active: "Activa",
          needs_activation: "Lista para activar (incluida en su plan)",
          needs_addon: "Requiere contratar add-on",
          needs_upgrade: "Requiere actualizar su plan",
        };

        printKeyValue({
          Estado: statusLabel[d.status] || d.status,
          "Plan incluye función": d.planIncludesFeature ? "sí" : "no",
          "Está activada": d.isActivated ? "sí" : "no",
          "Precio por descarga": d.pricing?.perDownload || "—",
          "Add-on mensual": d.pricing?.addonMonthly || "—",
        });

        console.log("");
        if (d.status === "needs_activation" || d.status === "needs_addon") {
          console.log(pc.dim("→ Ejecute 'gigstack invoices sat activate' para habilitar"));
        } else if (d.status === "needs_upgrade") {
          console.log(pc.dim("→ Actualice su plan en https://app.gigstack.pro/billing"));
        } else if (d.status === "active") {
          console.log(pc.dim("→ Descarga Masiva está habilitada. Use 'gigstack invoices sat list' para ver facturas"));
        }
      } catch (e: any) { error(e.message); }
    });

  sat
    .command("activate")
    .description("Activar Descarga Masiva SAT (agrega cargos a su suscripción)")
    .option("-y, --yes", "Saltar confirmación")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const statusRes = await spin("Consultando estado…", () => api("GET", "/invoices/download/activate/status", { team: opts.team }));
        const d = statusRes.data;

        if (d.status === "active") {
          success("Descarga Masiva ya está activada para este RFC");
          return;
        }

        if (d.status === "needs_upgrade") {
          error("Su plan actual no permite agregar Descarga Masiva. Actualice su plan en https://app.gigstack.pro/billing");
          return;
        }

        console.log(pc.bold("\nResumen de cargos:"));
        console.log(`  Por descarga: ${d.pricing?.perDownload || "$0.20 MXN"}`);
        if (d.status === "needs_addon") {
          console.log(`  Add-on mensual: ${d.pricing?.addonMonthly || "$400 MXN/mes por RFC"}`);
        } else {
          console.log(pc.dim("  Su plan ya incluye la función — solo se cobra por descarga"));
        }

        if (!opts.yes) {
          const proceed = await confirm("\n¿Activar Descarga Masiva SAT?");
          if (!proceed) { console.log(pc.dim("Cancelado")); return; }
        }

        const res = await spin("Activando…", () => api("POST", "/invoices/download/activate", { team: opts.team }));
        if (isJsonMode()) return printJson(res.data);
        success(res.message || "Descarga Masiva activada");
        if (res.data?.type) {
          console.log(pc.dim(`  Tipo: ${res.data.type === "included" ? "incluida en plan" : "add-on"}`));
        }
      } catch (e: any) { error(e.message); }
    });

  sat
    .command("deactivate")
    .description("Desactivar Descarga Masiva SAT")
    .option("-y, --yes", "Saltar confirmación")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        if (!opts.yes) {
          const proceed = await confirm("¿Cancelar Descarga Masiva SAT? Se detendrán las descargas automáticas", false);
          if (!proceed) { console.log(pc.dim("Cancelado")); return; }
        }
        const res = await spin("Desactivando…", () => api("POST", "/invoices/download/deactivate", { team: opts.team }));
        if (isJsonMode()) return printJson(res);
        success(res.message || "Descarga Masiva desactivada");
      } catch (e: any) { error(e.message); }
    });

  // Schedule sub-group (read-only + history; saving requires multi-field config — defer to web UI)
  const schedule = sat.command("schedule").description("Configuración de descarga automática programada");

  schedule
    .command("show")
    .description("Ver configuración actual de descarga programada")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const res = await api("GET", "/invoices/download/schedule", { team: opts.team });
        const d = res.data;
        if (isJsonMode()) return printJson(d);

        const s = d.schedule;
        printKeyValue({
          "FIEL cargada": d.fiel_uploaded ? "sí" : "no",
          "RFC registrado": d.registered ? "sí" : "no",
          "SAT completado": d.sat_completed ? "sí" : "no",
          "Inicio sincronización": d.sync_start_date || "—",
          "Programación habilitada": s?.enabled ? "sí" : "no",
          "Hora": s?.time || "—",
          "Tipos de descarga": s?.downloadTypes?.join(", ") || "—",
          "Días hacia atrás": s?.daysBack ?? "—",
          "Última ejecución": s?.lastRunAt ? formatDate(s.lastRunAt) : "—",
          "Status última corrida": s?.lastRunStatus || "—",
        });
        if (d.prodigia) {
          console.log("");
          console.log(pc.bold("Sincronización Prodigia/SAT:"));
          printKeyValue({
            "Sincronizado": d.prodigia.synced ? "sí" : "no",
            "Desde": d.prodigia.sync_from || "—",
            "Última sync": d.prodigia.last_sync || "—",
            "Tope mensual": d.prodigia.monthly_cap ?? "—",
          });
          if (d.prodigia.message) console.log(pc.dim(`\n  ${d.prodigia.message}`));
        }
      } catch (e: any) { error(e.message); }
    });

  schedule
    .command("history")
    .description("Ver historial reciente de descargas programadas")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const res = await spin("Cargando historial…", () => api("GET", "/invoices/download/schedule/history", { team: opts.team }));
        const items = res.data?.history || [];
        if (isJsonMode()) return printListJson(res, items);
        printTable(
          items.map((h: any) => ({
            id: (h.id || "—").slice(0, 12) + "…",
            tipo: h.rfcType || "—",
            inicio: h.startDate || "—",
            fin: h.endDate || "—",
            status: h.status || "—",
            facturas: h.invoiceCount ?? 0,
            procesadas: h.processedCount ?? 0,
            origen: h.source || "—",
            fecha: formatDate(h.createdAt),
          })),
        );
      } catch (e: any) { error(e.message); }
    });

  schedule
    .command("set")
    .description("Configurar descarga automática programada")
    .option("--enabled <bool>", "Habilitar (true/false)", "true")
    .option("--time <HH:mm>", "Hora de ejecución diaria (ej: 21:00)")
    .option("--types <list>", "Tipos a descargar (issued,received)", "issued,received")
    .option("--days-back <n>", "Días hacia atrás a sincronizar (1-90)", "7")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        if (!opts.time) { error("--time es requerido (formato HH:mm, ej: 21:00)"); process.exit(1); }
        const downloadTypes = opts.types.split(",").map((t: string) => t.trim()).filter(Boolean);
        const daysBack = parseInt(opts.daysBack, 10);
        const enabled = String(opts.enabled).toLowerCase() !== "false";

        const body = {
          enabled,
          time: opts.time,
          download_types: downloadTypes,
          days_back: daysBack,
        };

        const res = await spin("Guardando configuración…", () => api("PUT", "/invoices/download/schedule", { body, team: opts.team }));
        if (isJsonMode()) return printJson(res.data);
        success(res.message || "Configuración guardada");
      } catch (e: any) { error(e.message); }
    });
}
