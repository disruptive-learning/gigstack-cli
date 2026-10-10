import { Command } from "commander";
import { resolve } from "node:path";
import { domainToASCII } from "node:url";
import { api, ApiError, getApiKey } from "../api.js";
import { requireConfirmation, teamTarget } from "../input.js";
import { apiBaseUrl } from "../runtime.js";
import { operationId, OperationReference, prepareOperationJournal } from "../operation-journal.js";
import { printJson } from "../output.js";
const base = (team: string) => `${teamTarget(team)}/email-domain`;
function show(result: any, reference?: OperationReference) {
  const failed = ["failed", "outcome_unknown"].includes(result?.data?.status);
  if (failed) process.exitCode = 1;
  printJson({ ...result, ...(failed ? { success: false, error: { code: result.data.status, message: "La operación no está confirmada; consulta o concilia el mismo ID antes de continuar." } } : {}), ...(reference ? { operation_reference: reference } : {}) });
}
function dns(value: string, isDomain: boolean) {
  const normalized = domainToASCII(value.toLowerCase()), label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (!normalized || normalized.length > 253 || (isDomain && !normalized.includes(".")) || !normalized.split(".").every(part => label.test(part))) throw new Error("Usa nombres DNS sin URL, correo ni credenciales");
  return normalized;
}
async function write(action: "set" | "validate" | "remove", team: string, opts: any) {
  const id = operationId(opts.operationId), reference = { id, team_id: team, journal_file: resolve(opts.operationFile) };
  try {
    const path = base(team) + (action === "validate" ? "/validate" : ""), method = action === "set" ? "PUT" : action === "remove" ? "DELETE" : "POST";
    const body = { operation_id: id, ...(action === "set" ? { domain: dns(opts.domain, true), subdomain: dns(opts.subdomain, false) } : {}) };
    const baseUrl = apiBaseUrl(); getApiKey();
    await requireConfirmation(opts.yes, action === "set"
      ? "¿Configurar el dominio de toda la empresa en SendGrid? Test mode no aísla al proveedor, incluso en staging. Un dominio anterior puede permanecer en SendGrid."
      : action === "remove" ? "¿Eliminar el dominio actual de SendGrid y quitarlo de toda la empresa? Test mode no aísla al proveedor."
      : "¿Solicitar a SendGrid la validación DNS de toda la empresa? Operación completada no significa que los registros DNS ya sean válidos.");
    const scope = (await api("GET", base(team))).data;
    if (scope?.can_manage !== true || typeof scope?.billing_account_id !== "string" || scope.provider_environment !== "configured_sendgrid_account") throw new Error("No se pudo verificar autoridad, cuenta y alcance del proveedor");
    const journal = await prepareOperationJournal(opts.operationFile, { id, teamId: team, method, path, baseUrl, body, billingAccountId: scope.billing_account_id, providerEnvironment: scope.provider_environment });
    if (journal.existing) {
      try { show(await api("GET", `${base(team)}/operations/${id}`), reference); return; }
      catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; }
    }
    show(await api(method, path, { body }), reference);
  } catch (error: any) {
    process.exitCode = 1; printJson({ success: false, operation_reference: reference, error: { message: error.message ?? "Resultado no confirmado", ...(error.status ? { status: error.status } : {}), ...(error.code ? { code: error.code } : {}), ...(error.outcome ? { outcome: error.outcome } : {}) } });
  }
}
export function registerEmailDomainCommands(program: Command) {
  const domain = program.command("email-domain").description("Dominio de correo compartido; usuario Firebase/MCP admin, proveedor SendGrid configurado sin aislamiento por testmode");
  domain.command("get <teamId>").description("Leer dominio, DNS y operación activa; configured no implica valid")
    .action(async team => show(await api("GET", base(team))));
  for (const action of ["set", "validate", "remove"] as const) {
    const command = domain.command(`${action} <teamId>`);
    if (action === "set") command.requiredOption("--domain <domain>", "Dominio DNS, ejemplo empresa.mx").requiredOption("--subdomain <subdomain>", "Subdominio de envío, ejemplo facturas");
    command.requiredOption("--operation-id <uuid>", "UUID v4 estable de esta operación")
      .requiredOption("--operation-file <path>", "Diario privado 0600 antes de enviar; reutilizar consulta primero")
      .option("-y, --yes", "Confirmar acción compartida con el proveedor configurado")
      .action(async (team, opts) => write(action, team, opts));
  }
  const operations = domain.command("operations").description("Resultados duraderos; conciliar no repite acciones del proveedor");
  operations.command("get <teamId> <operationId>").action(async (team, id) => show(await api("GET", `${base(team)}/operations/${operationId(id)}`)));
  operations.command("reconcile <teamId> <operationId>").description("Consultar evidencia exacta; un dominio con el mismo nombre no prueba la creación")
    .action(async (team, id) => show(await api("POST", `${base(team)}/operations/${operationId(id)}/reconcile`, { body: {} })));
  operations.command("resolve <teamId> <operationId>").description("Tras 10 minutos, liberar bloqueo incierto sin deshacer efectos; conserva el resultado desconocido")
    .option("--acknowledge-unconfirmed-effects", "La persona reconoce expresamente posibles efectos previos en SendGrid")
    .option("-y, --yes", "Confirmar liberación del bloqueo; no revierte el proveedor")
    .action(async (team, id, opts) => {
      const path = `${base(team)}/operations/${operationId(id)}/resolve`;
      if (opts.acknowledgeUnconfirmedEffects !== true) throw new Error("Se requiere --acknowledge-unconfirmed-effects elegido expresamente por la persona");
      await requireConfirmation(opts.yes, "¿Liberar el bloqueo tras revisar los posibles efectos? Esto no elimina ni deshace recursos en SendGrid; el resultado original permanece desconocido.");
      show(await api("POST", path, { body: { acknowledge_unconfirmed_effects: true } }));
    });
}
