import { Command } from "commander";
import pc from "picocolors";
import { api } from "../api.js";
import { printJson, printKeyValue, error, isJsonMode, formatMoney, formatDate, spin, warn } from "../output.js";

// ─── ID type detection ──────────────────────────────────────

type EntityType = "invoice" | "payment" | "receipt" | "client" | "service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function detectType(id: string): EntityType | null {
  if (id.startsWith("client_") || id.startsWith("cus_")) return "client";
  if (id.startsWith("payment_")) return "payment";
  if (id.startsWith("receipt_")) return "receipt";
  if (id.startsWith("service_")) return "service";
  if (UUID_RE.test(id)) return "invoice";
  return null;
}

// ─── Fetchers ───────────────────────────────────────────────

async function fetchInvoice(id: string, team?: string) {
  const res = await api("GET", `/invoices/income/${id}`, { team });
  return { type: "invoice" as const, data: res.data };
}

async function fetchPayment(id: string, team?: string) {
  const res = await api("GET", `/payments/${id}`, { team });
  return { type: "payment" as const, data: res.data };
}

async function fetchReceipt(id: string, team?: string) {
  const res = await api("GET", `/receipts/${id}`, { team });
  return { type: "receipt" as const, data: res.data };
}

async function fetchClient(id: string, team?: string) {
  const res = await api("GET", `/clients/${id}`, { team });
  return { type: "client" as const, data: res.data };
}

async function fetchService(id: string, team?: string) {
  const res = await api("GET", `/services/${id}`, { team });
  return { type: "service" as const, data: res.data };
}

type FetchResult = { type: EntityType; data: any };

async function fetchByType(type: EntityType, id: string, team?: string): Promise<FetchResult> {
  switch (type) {
    case "invoice": return fetchInvoice(id, team);
    case "payment": return fetchPayment(id, team);
    case "receipt": return fetchReceipt(id, team);
    case "client": return fetchClient(id, team);
    case "service": return fetchService(id, team);
  }
}

async function tryAll(id: string, team?: string): Promise<FetchResult> {
  const order: EntityType[] = ["payment", "invoice", "receipt", "client", "service"];
  for (const type of order) {
    try {
      return await fetchByType(type, id, team);
    } catch {
      // try next
    }
  }
  throw new Error(`No se encontró ningún recurso con ID: ${id}`);
}

// ─── Explain renderers ──────────────────────────────────────

function explainInvoice(i: any) {
  const clientName = i.client?.legal_name || i.client?.name || "desconocido";
  const isPPD = (i.payment_method || "").toUpperCase() === "PPD";
  const isCancelled = (i.status || "").toLowerCase() === "cancelled";

  printKeyValue({
    UUID: i.uuid || i.id || "—",
    Tipo: "Factura de ingreso",
    Status: i.status || "—",
    Cliente: clientName,
    RFC: i.client?.tax_id || "—",
    Subtotal: formatMoney(i.subtotal, i.currency),
    Total: formatMoney(i.total, i.currency),
    "Método pago": i.payment_method || "—",
    "Forma pago": i.payment_form || "—",
    Serie: i.series || "—",
    Folio: i.folio_number || "—",
    Creado: formatDate(i.created_at),
  });

  if (isPPD) {
    console.log("");
    console.log(pc.bold(pc.yellow("PPD — Pago en parcialidades")));
    console.log(`  Saldo pendiente: ${i.last_balance !== undefined ? formatMoney(i.last_balance, i.currency) : "desconocido"}`);
    console.log(`  Complementos: ${i.payment_complements ?? 0}`);
    const fullyPaid = i.last_balance !== undefined && i.last_balance <= 0;
    console.log(`  Liquidada: ${fullyPaid ? pc.green("Sí") : pc.yellow("No")}`);
  }

  if (isCancelled) {
    console.log("");
    console.log(pc.bold(pc.red("Cancelada")));
    if (i.cancellation_status) console.log(`  Status cancelación: ${i.cancellation_status}`);
    if (i.cancellation_receipt) console.log(`  Acuse: ${i.cancellation_receipt}`);
  }

  // Narrative
  console.log("");
  const methodLabel = isPPD ? "PPD" : "PUE";
  let narrative = `Factura de ingreso ${methodLabel} por ${formatMoney(i.total, i.currency)} a ${clientName} creada el ${formatDate(i.created_at)}.`;
  if (isCancelled) {
    narrative += ` Status: ${pc.red("cancelada")}.`;
  } else if (isPPD && i.last_balance !== undefined && i.last_balance <= 0) {
    narrative += ` Status: ${pc.green("válida")} — completamente liquidada con ${i.payment_complements ?? 0} complemento(s).`;
  } else if (isPPD) {
    narrative += ` Status: ${pc.yellow("válida")} — saldo pendiente ${formatMoney(i.last_balance, i.currency)}.`;
  } else {
    narrative += ` Status: ${pc.green("válida")}.`;
  }
  console.log(pc.dim(narrative));
}

function explainPayment(p: any) {
  const clientName = p.client?.legal_name || p.client?.name || "desconocido";

  printKeyValue({
    ID: p.id || "—",
    Tipo: "Pago",
    Status: p.status || "—",
    Cliente: clientName,
    Email: p.client?.email || "—",
    RFC: p.client?.tax_id || "—",
    Total: formatMoney(p.total, p.currency),
    "Forma pago": p.payment_form || "—",
    Procesador: p.processor || p.payment_processor || "—",
    "Link de pago": p.short_url || "—",
    Creado: formatDate(p.created_at),
  });

  // Automation & invoice info
  if (p.automation_type || p.invoice_id || p.invoice?.uuid) {
    console.log("");
    console.log(pc.bold("Automatización"));
    if (p.automation_type) console.log(`  Tipo: ${p.automation_type}`);
    const invoiceRef = p.invoice?.uuid || p.invoice_id || p.invoiceId;
    if (invoiceRef) console.log(`  Factura generada: ${invoiceRef}`);
    if (p.receipt_id || p.receiptId) console.log(`  Recibo generado: ${p.receipt_id || p.receiptId}`);
  }

  // Narrative
  console.log("");
  const formLabel = p.payment_form ? ` via forma ${p.payment_form}` : "";
  const processorLabel = p.processor || p.payment_processor ? ` (${p.processor || p.payment_processor})` : "";
  let narrative = `Pago de ${formatMoney(p.total, p.currency)} recibido de ${clientName} el ${formatDate(p.created_at)}${formLabel}${processorLabel}.`;
  narrative += ` Status: ${p.status || "desconocido"}.`;
  const invoiceRef = p.invoice?.uuid || p.invoice_id || p.invoiceId;
  if (invoiceRef) narrative += ` Se generó factura ${invoiceRef}.`;
  const receiptRef = p.receipt_id || p.receiptId;
  if (receiptRef) narrative += ` Se generó recibo ${receiptRef}.`;
  console.log(pc.dim(narrative));
}

async function explainClient(c: any, team?: string) {
  printKeyValue({
    ID: c.id || "—",
    Tipo: "Cliente",
    Nombre: c.legal_name || c.name || "—",
    RFC: c.tax_id || "—",
    Email: c.email || "—",
    "Régimen fiscal": c.tax_system || "—",
    "Uso CFDI": c.use || "—",
    "Código postal": c.address?.zip || "—",
    Válido: c.is_valid ? pc.green("Sí") : pc.yellow("No"),
    Creado: formatDate(c.created_at),
  });

  // Try to fetch recent invoices and payments for this client
  let invoiceCount = 0;
  let paymentCount = 0;

  try {
    const invoiceRes = await api("GET", "/invoices/income", { query: { client_id: c.id, limit: "1" }, team });
    invoiceCount = invoiceRes.pagination?.totalItems ?? (invoiceRes.data || []).length;
  } catch { /* ignore */ }

  try {
    const paymentRes = await api("GET", "/payments", { query: { client_id: c.id, limit: "1" }, team });
    paymentCount = paymentRes.pagination?.totalItems ?? (paymentRes.data || []).length;
  } catch { /* ignore */ }

  console.log("");
  console.log(pc.bold("Actividad"));
  console.log(`  Facturas: ${invoiceCount}`);
  console.log(`  Pagos: ${paymentCount}`);

  // Narrative
  console.log("");
  const clientName = c.legal_name || c.name || "desconocido";
  const rfcLabel = c.tax_id ? `RFC: ${c.tax_id}` : "sin RFC";
  const validLabel = c.is_valid ? "datos fiscales válidos" : "datos fiscales sin validar";
  const narrative = `Cliente ${clientName} (${rfcLabel}). ${invoiceCount} factura(s), ${paymentCount} pago(s) registrados. ${validLabel}.`;
  console.log(pc.dim(narrative));
}

function explainReceipt(r: any) {
  const clientName = r.client?.legal_name || r.client?.name || "público general";
  const status = (r.status || "").toLowerCase();

  printKeyValue({
    ID: r.id || "—",
    Tipo: "Recibo de venta",
    Status: r.status || "—",
    Cliente: clientName,
    Total: formatMoney(r.total, r.currency),
    "Válido hasta": formatDate(r.validUntil),
    Creado: formatDate(r.created_at),
  });

  if (r.invoice_id || r.invoiceId || r.invoice?.uuid) {
    console.log("");
    console.log(pc.bold("Autofactura"));
    console.log(`  Factura: ${r.invoice?.uuid || r.invoice_id || r.invoiceId}`);
    if (r.invoiced_at) console.log(`  Fecha: ${formatDate(r.invoiced_at)}`);
  }

  // Narrative
  console.log("");
  let narrative: string;
  if (status === "pending" || status === "open") {
    narrative = `Recibo pendiente de autofactura por ${formatMoney(r.total, r.currency)} para ${clientName}. El dinero YA fue cobrado.`;
    if (r.validUntil) narrative += ` Vigente hasta ${formatDate(r.validUntil)}.`;
  } else if (status === "invoiced" || status === "completed") {
    const invoiceRef = r.invoice?.uuid || r.invoice_id || r.invoiceId;
    narrative = `Recibo por ${formatMoney(r.total, r.currency)}. El cliente se autofacturó${r.invoiced_at ? ` el ${formatDate(r.invoiced_at)}` : ""}.`;
    if (invoiceRef) narrative += ` Factura: ${invoiceRef}.`;
  } else if (status === "expired") {
    narrative = `Recibo expirado por ${formatMoney(r.total, r.currency)}. El cliente no se autofacturó a tiempo. Se incluirá en factura global.`;
  } else if (status === "cancelled") {
    narrative = `Recibo cancelado por ${formatMoney(r.total, r.currency)}.`;
  } else {
    narrative = `Recibo por ${formatMoney(r.total, r.currency)} para ${clientName}. Status: ${r.status || "desconocido"}.`;
  }
  console.log(pc.dim(narrative));
}

function explainService(s: any) {
  printKeyValue({
    ID: s.id || "—",
    Tipo: "Servicio / Producto",
    Descripción: s.description || "—",
    SKU: s.sku || "—",
    "Precio unitario": formatMoney(s.unit_price, "MXN"),
    "Clave producto": s.product_key || "—",
    "Clave unidad": s.unit_key || "—",
    "Nombre unidad": s.unit_name || "—",
    Impuestos: (s.taxes || []).map((t: any) => `${t.type} ${(t.rate * 100).toFixed(0)}%${t.withholding ? " (ret)" : ""}`).join(", ") || "Sin impuestos",
  });

  // Narrative
  console.log("");
  const taxLabel = (s.taxes || []).length > 0
    ? `Con ${(s.taxes || []).map((t: any) => `${t.type} ${(t.rate * 100).toFixed(0)}%`).join(" + ")}.`
    : "Sin impuestos configurados.";
  const narrative = `Servicio "${s.description || "—"}" a ${formatMoney(s.unit_price, "MXN")} por unidad (${s.unit_key || "—"}). ${taxLabel}`;
  console.log(pc.dim(narrative));
}

// ─── Command registration ───────────────────────────────────

export function registerExplainCommand(program: Command) {
  program
    .command("explain <id>")
    .description("Explicar cualquier recurso de gigstack (factura, pago, recibo, cliente, servicio)")
    .option("--team <id>", "Team ID")
    .action(async (id: string, opts: any) => {
      try {
        const detectedType = detectType(id);
        let result: FetchResult;

        if (detectedType) {
          try {
            result = await spin(
              `Cargando ${detectedType}…`,
              () => fetchByType(detectedType, id, opts.team),
            );
          } catch {
            // Detection was wrong, try all endpoints
            warn(`No se encontró como ${detectedType}, buscando en otros tipos…`);
            result = await spin("Buscando recurso…", () => tryAll(id, opts.team));
          }
        } else {
          result = await spin("Detectando tipo de recurso…", () => tryAll(id, opts.team));
        }

        if (isJsonMode()) {
          return printJson({ type: result.type, ...result.data });
        }

        console.log(pc.bold(`\n${pc.cyan("─── gigstack explain ───")}\n`));

        switch (result.type) {
          case "invoice":
            explainInvoice(result.data);
            break;
          case "payment":
            explainPayment(result.data);
            break;
          case "client":
            await explainClient(result.data, opts.team);
            break;
          case "receipt":
            explainReceipt(result.data);
            break;
          case "service":
            explainService(result.data);
            break;
        }

        console.log("");
      } catch (e: any) {
        error(e.message);
      }
    });
}
