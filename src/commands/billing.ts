import { Command } from "commander";
import { resolve } from "node:path";
import { api, ApiError, getApiKey } from "../api.js";
import { readJsonInput, requireConfirmation, teamTarget, withJsonInput } from "../input.js";
import { printJson } from "../output.js";
import { apiBaseUrl } from "../runtime.js";
import { operationId, OperationReference, prepareOperationJournal } from "../operation-journal.js";

type BillingWrite = "checkout" | "upgrade" | "portal" | "fiscal";
const base = (id: string) => `${teamTarget(id)}/billing`;
function keys(body: Record<string, any>, allowed: string[]) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new Error("La solicitud de facturación contiene campos no admitidos");
}
function validate(action: BillingWrite, body: Record<string, any>) {
  const fields = { checkout: ["plan_id", "plan_version", "billing_cycle", "quantity", "intro", "trial_id", "partner_ref", "coupon"], upgrade: ["plan_id", "billing_cycle", "quantity"], portal: ["intent"], fiscal: ["fiscal"] };
  keys(body, fields[action]);
  if (action === "checkout" || action === "upgrade") {
    if (typeof body.plan_id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(body.plan_id) || !["monthly", "annual"].includes(body.billing_cycle)) throw new Error("Se requieren plan_id y billing_cycle monthly/annual");
    if (body.quantity !== undefined && (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 10000)) throw new Error("quantity debe ser un entero de 1 a 10000");
    if (body.intro !== undefined && typeof body.intro !== "boolean") throw new Error("intro debe ser booleano");
    if (body.intro && body.trial_id) throw new Error("intro y trial_id son excluyentes");
    for (const key of ["plan_version", "trial_id"]) if (body[key] !== undefined && (typeof body[key] !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(body[key]))) throw new Error(`${key} inválido`);
    for (const key of ["partner_ref", "coupon"]) if (body[key] !== undefined && (typeof body[key] !== "string" || !body[key].length || body[key].length > 120)) throw new Error(`${key} inválido`);
  }
  if (action === "portal" && !["manage", "cancel_subscription", "update_payment_method"].includes(body.intent)) throw new Error("intent debe ser manage, cancel_subscription o update_payment_method");
  if (action === "fiscal") {
    keys(body.fiscal, ["legal_name", "rfc", "tax_system", "use", "email", "phone", "address"]);
    for (const key of ["legal_name", "rfc", "tax_system", "use"]) if (typeof body.fiscal[key] !== "string" || !body.fiscal[key].length || body.fiscal[key].length > 200) throw new Error(`fiscal.${key} es obligatorio`);
    for (const key of ["email", "phone"]) if (body.fiscal[key] !== undefined && body.fiscal[key] !== null && (typeof body.fiscal[key] !== "string" || !body.fiscal[key].length || body.fiscal[key].length > 320)) throw new Error(`fiscal.${key} inválido`);
    keys(body.fiscal.address, ["zip", "street", "exterior", "interior", "neighborhood", "municipality", "city", "state", "country"]);
    if (typeof body.fiscal.address.zip !== "string" || !/^\d{5}$/.test(body.fiscal.address.zip)) throw new Error("fiscal.address.zip debe contener cinco dígitos");
    for (const value of Object.values(body.fiscal.address)) if (value !== null && (typeof value !== "string" || !value.length || value.length > 200)) throw new Error("Dirección fiscal inválida");
  }
}
function show(result: any, reference?: OperationReference) {
  const state = result?.data?.status;
  const unsuccessful = state === "failed" || state === "outcome_unknown";
  if (unsuccessful) process.exitCode = 1;
  printJson({ ...result, ...(unsuccessful ? { success: false, error: { code: state, message: "La operación no está confirmada como completada. Revisa data y consulta el mismo ID antes de continuar." } } : {}), ...(reference ? { operation_reference: reference } : {}) });
}
async function write(action: BillingWrite, teamId: string, opts: any) {
  const id = operationId(opts.operationId);
  const reference = { id, team_id: teamId, journal_file: resolve(opts.operationFile) };
  try {
    const path = `${base(teamId)}/${action}`, baseUrl = apiBaseUrl();
    getApiKey(); // Fail before creating a journal if authentication is unavailable.
    const input = await readJsonInput(opts); validate(action, input);
    await requireConfirmation(opts.yes, action === "upgrade"
      ? "¿Cambiar el plan de la cuenta de facturación compartida? Puede generar una factura prorrateada inmediata."
      : action === "checkout" ? "¿Iniciar cambio de plan para la cuenta compartida? Un plan gratuito se aplica inmediatamente; Checkout de pago requiere acción de la persona."
      : action === "portal" ? "¿Crear acceso al portal de la cuenta compartida? Crear el enlace no cancela la suscripción ni cambia el método de pago."
      : "¿Actualizar los datos fiscales de toda la cuenta de facturación y sincronizarlos con el proveedor?");
    const body = { ...input, operation_id: id }, method = action === "fiscal" ? "PATCH" : "POST";
    const scope = (await api("GET", `${base(teamId)}/summary`)).data;
    if (typeof scope?.billing_account_id !== "string" || !["production", "sandbox"].includes(scope?.provider_environment)) throw new Error("No se pudo verificar la cuenta y el ambiente de facturación");
    if (scope.can_manage !== true) throw new Error("El usuario actual no puede administrar esta cuenta de facturación");
    const journal = await prepareOperationJournal(opts.operationFile, { id, teamId, method, path, baseUrl, body, billingAccountId: scope.billing_account_id, providerEnvironment: scope.provider_environment });
    if (journal.existing) {
      try { show(await api("GET", `${base(teamId)}/operations/${id}`), reference); return; }
      catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; }
    }
    show(await api(method, path, { body }), reference);
  } catch (error: any) {
    process.exitCode = 1;
    printJson({ success: false, operation_reference: reference, error: { message: error.message ?? "No se pudo confirmar la operación", ...(error.status ? { status: error.status } : {}), ...(error.code ? { code: error.code } : {}), ...(error.outcome ? { outcome: error.outcome } : {}) } });
  }
}
export function registerBillingCommands(program: Command) {
  const billing = program.command("billing").description("Cuenta de facturación compartida; requiere usuario Firebase/MCP, no API key de equipo/OAuth");
  for (const route of ["summary", "plans"]) billing.command(`${route} <teamId>`)
    .description("Leer cuenta/planes; el ambiente del proveedor lo determina el servidor, no el modo de la credencial")
    .action(async id => show(await api("GET", `${base(id)}/${route}`)));
  billing.command("history <teamId>").option("--limit <n>", "1-100 facturas", "20").option("--cursor <cursor>", "Cursor opaco de data.cursor")
    .action(async (id, opts) => {
      const path = `${base(id)}/history`;
      if (!/^\d+$/.test(opts.limit) || Number(opts.limit) < 1 || Number(opts.limit) > 100) throw new Error("limit debe estar entre 1 y 100");
      show(await api("GET", path, { query: { limit: opts.limit, ...(opts.cursor ? { cursor: opts.cursor } : {}) } }));
    });
  const fiscal = billing.command("fiscal").description("Datos fiscales para facturas de la suscripción");
  fiscal.command("get <teamId>").action(async id => show(await api("GET", `${base(id)}/fiscal`)));
  for (const action of ["checkout", "upgrade", "portal", "fiscal"] as const) {
    const command = action === "fiscal" ? fiscal.command("update <teamId>") : billing.command(`${action} <teamId>`);
    withJsonInput(command.description(action === "upgrade" ? "Cambio compartido con posible factura prorrateada inmediata" : action === "portal" ? "Crear enlace para acción humana; no confirma cancelación ni cambio de tarjeta" : "Operación compartida con ID estable y diario local previo al envío"))
      .requiredOption("--operation-id <uuid>", "UUID v4 persistente; reutiliza el mismo para consultar/reintentar esta operación")
      .requiredOption("--operation-file <path>", "Diario privado 0600; existente solo si API/equipo/contenido son idénticos")
      .option("-y, --yes", "Confirmar operación en cuenta de facturación compartida")
      .action(async (id, opts) => write(action, id, opts));
  }
  const operations = billing.command("operations").description("Readback y conciliación; ninguna acción repite un cobro ni libera el bloqueo incierto");
  operations.command("get <teamId> <operationId>")
    .action(async (team, id) => show(await api("GET", `${base(team)}/operations/${operationId(id)}`)));
  operations.command("reconcile <teamId> <operationId>").description("Consultar evidencia del proveedor sin repetir la operación")
    .action(async (team, id) => show(await api("POST", `${base(team)}/operations/${operationId(id)}/reconcile`, { body: {} })));
}
