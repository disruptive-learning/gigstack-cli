import { Command } from "commander";
import { api } from "../api.js";
import { printJson } from "../output.js";
import { readJsonInput, requireConfirmation, segment, teamTarget, withJsonInput } from "../input.js";

function base(id: string, provider: "zettle" | "netsuite") { return `${teamTarget(id)}/integrations/${provider}`; }
function show(result: any) {
  const data = result?.data?.data;
  if (data?.partial_cleanup === true || data?.ok === false) {
    process.exitCode = 1;
    printJson({ ...result, success: false, error: { code: data?.partial_cleanup ? "partial_cleanup" : "provider_operation_failed", message: "La operación no se completó totalmente. Revisa data.data antes de repetir." } });
  } else printJson(result);
}
function onlyKeys(body: Record<string, any>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new Error("El contrato no admite campos adicionales");
}
function ruleBody(body: Record<string, any>, saving: boolean) {
  onlyKeys(body, saving ? ["rule", "days", "previewToken", "confirmChanges"] : ["rule", "days"]);
  if (!body.rule || typeof body.rule !== "object" || Array.isArray(body.rule)) throw new Error("rule debe ser un objeto");
  onlyKeys(body.rule, ["match", "matchType", "itemId", "refundItemId", "scope"]);
  const rule = body.rule;
  if (typeof rule.match !== "string" || !rule.match.length || rule.match.length > 1000 || !["exact", "contains"].includes(rule.matchType) || typeof rule.itemId !== "string" || !/^\d+$/.test(rule.itemId)) throw new Error("Regla de artículos inválida");
  if (rule.refundItemId !== undefined && (typeof rule.refundItemId !== "string" || !/^\d+$/.test(rule.refundItemId))) throw new Error("refundItemId debe ser una cadena numérica");
  if (rule.scope !== undefined && !["domestic", "foreign"].includes(rule.scope)) throw new Error("scope debe ser domestic o foreign");
  if (body.days !== undefined && (!Number.isInteger(body.days) || body.days < 1 || body.days > 180)) throw new Error("days debe ser un entero de 1 a 180");
  if (saving && (typeof body.previewToken !== "string" || !body.previewToken.length || body.previewToken.length > 256)) throw new Error("Se requiere previewToken del preview vigente");
  if (body.confirmChanges !== undefined && typeof body.confirmChanges !== "boolean") throw new Error("confirmChanges debe ser booleano y explícito");
}
export function registerProviderOperations(integrations: Command) {
  const pos = integrations.command("zettle").description("PayPal POS: usuario Firebase/MCP; prueba también consulta compras reales del comercio");
  pos.command("status <teamId>").description("Conexión y primeras 20 compras en revisión; no es historia paginada")
    .action(async id => show(await api("GET", `${base(id, "zettle")}/status`)));
  withJsonInput(pos.command("settings <teamId>").description('Configuración de la conexión: {"automaticInvoicing":false,"cardPaymentForm":"04"}; modo debe coincidir'))
    .option("-y, --yes", "Confirmar ajustes")
    .action(async (id, opts) => {
      const path = `${base(id, "zettle")}/connection-settings`, body = await readJsonInput(opts);
      onlyKeys(body, ["automaticInvoicing", "cardPaymentForm"]);
      if (typeof body.automaticInvoicing !== "boolean" || !["04", "28"].includes(body.cardPaymentForm)) throw new Error("Se requieren automaticInvoicing booleano y cardPaymentForm 04 o 28");
      await requireConfirmation(opts.yes, "¿Actualizar ajustes de la conexión POS en su modo actual?");
      show(await api("PATCH", path, { body }));
    });
  pos.command("sync <teamId>").description("Encolar importación; queued no significa finalizada, incluso en modo prueba consulta al comercio real")
    .option("-y, --yes", "Confirmar importación")
    .action(async (id, opts) => {
      const path = `${base(id, "zettle")}/sync`;
      await requireConfirmation(opts.yes, "¿Encolar importación de compras del comercio real?");
      show(await api("POST", path, { body: {} }));
    });
  pos.command("disconnect <teamId>").description("Desconectar localmente; partial_cleanup/remote_removed describe el resultado remoto real")
    .option("-y, --yes", "Confirmar desconexión")
    .action(async (id, opts) => {
      const path = `${base(id, "zettle")}/connection`;
      await requireConfirmation(opts.yes, "¿Desconectar POS y retirar las credenciales locales? La limpieza remota puede ser parcial.");
      show(await api("DELETE", path));
    });

  const ns = integrations.command("netsuite").description("NetSuite: usuario Firebase/MCP; respeta permisos y modo actual");
  ns.command("status <teamId>").description("Conexión de ambos modos y primeras 20 sincronizaciones")
    .action(async id => show(await api("GET", `${base(id, "netsuite")}/status`)));
  ns.command("ping <teamId>").description("Consultar conexión con el proveedor real del ambiente seleccionado")
    .option("-y, --yes", "Confirmar consulta al proveedor")
    .action(async (id, opts) => {
      const path = `${base(id, "netsuite")}/ping`;
      await requireConfirmation(opts.yes, "¿Consultar la conexión con NetSuite en el ambiente seleccionado?");
      show(await api("POST", path, { body: {} }));
    });
  ns.command("disconnect <teamId>").description("Desactivar modo seleccionado; las credenciales cifradas permanecen guardadas")
    .option("-y, --yes", "Confirmar desactivación")
    .action(async (id, opts) => {
      const path = `${base(id, "netsuite")}/connection`;
      await requireConfirmation(opts.yes, "¿Desactivar esta conexión NetSuite? Las credenciales cifradas no se borrarán.");
      show(await api("DELETE", path));
    });
  const invoices = ns.command("invoices").description("Sincronización de facturas del mismo equipo y modo");
  invoices.command("status <teamId> <invoiceId>")
    .action(async (id, invoiceId) => show(await api("GET", `${base(id, "netsuite")}/invoices/${segment(invoiceId)}/sync`)));
  for (const action of ["sync", "resync"]) invoices.command(`${action} <teamId> <invoiceId>`)
    .description(action === "resync" ? "Reencolar; en facturas pagadas elimina y recrea el pago aplicado por el total actual. No repitas tras timeout" : "Encolar sincronización; puede modificar pasos locales antes del envío. No repitas automáticamente tras timeout")
    .option("-y, --yes", "Confirmar sincronización")
    .action(async (id, invoiceId, opts) => {
      const path = `${base(id, "netsuite")}/invoices/${segment(invoiceId)}/${action}`;
      await requireConfirmation(opts.yes, action === "resync" ? `¿Reencolar ${invoiceId}? Si está pagada, se eliminará y recreará el pago aplicado en NetSuite por el total actual.` : `¿Encolar la factura ${invoiceId} en NetSuite?`);
      show(await api("POST", path, { body: {} }));
    });
  ns.command("syncs <teamId>").description("Historial de 50 filas; conserva nextBefore/truncated de la consulta acotada")
    .option("--before <cursor>", "nextBefore de la página anterior")
    .action(async (id, opts) => {
      const path = `${base(id, "netsuite")}/syncs`;
      if (opts.before && !/^\d+_[A-Za-z0-9_-]+$/.test(opts.before)) throw new Error("Cursor before inválido");
      show(await api("GET", path, { query: opts.before ? { before: opts.before } : {} }));
    });
  const items = ns.command("items").description("Mapeo compartido por empresa; consulta proveedor live incluso con credencial de prueba");
  items.command("get <teamId>").description("Leer configuración compartida sin consultar al proveedor")
    .action(async id => show(await api("GET", `${base(id, "netsuite")}/items`)));
  for (const [command, endpoint, saving] of [["preview", "preview", false], ["save-rule", "rules", true]] as const) {
    withJsonInput(items.command(`${command} <teamId>`).description(saving ? "Guardar regla con previewToken vigente; mover líneas exige confirmChanges:true explícito" : "Calcular efecto de rule y days; devuelve previewToken para guardar"))
      .option("-y, --yes", "Confirmar operación compartida con consulta live")
      .action(async (id, opts) => {
        const path = `${base(id, "netsuite")}/items/${endpoint}`, body = await readJsonInput(opts);
        ruleBody(body, saving);
        await requireConfirmation(opts.yes, saving ? "¿Guardar este mapeo compartido con el preview vigente? --yes no sustituye confirmChanges para mover líneas." : "¿Consultar el catálogo live y calcular el efecto de esta regla compartida?");
        show(await api("POST", path, { body }));
      });
  }
}
