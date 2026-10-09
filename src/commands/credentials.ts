import { Command } from "commander";
import { api } from "../api.js";
import { requireConfirmation, segment } from "../input.js";
import { printJson } from "../output.js";
import { approvalId, approvalRequest, approvalTeam, prepareApproval } from "../account-approvals.js";

export function registerCredentialCommands(program: Command) {
  const keys = program.command("api-keys").description("Claves de equipo; requiere usuario Firebase/MCP administrador actual");
  keys.command("list").description("Metadatos sin secretos; pagina hasta has_more=false, incluso si data está vacía")
    .option("--limit <n>", "Límite (1-100)", "20")
    .option("--cursor <cursor>", "next_cursor de la página anterior")
    .option("--include-revoked", "Incluir claves revocadas")
    .action(async opts => printJson(await api("GET", "/api-keys", { query: { limit: opts.limit, ...(opts.cursor ? { cursor: opts.cursor } : {}), ...(opts.includeRevoked ? { include_revoked: "true" } : {}) } })));
  for (const action of ["create", "rotate"] as const) {
    keys.command(action).description("Preparar aprobación en navegador; no emite ni devuelve secretos. --team requerido")
      .requiredOption("--operation-id <uuid>", "UUIDv4 persistido; reutilizar sólo para solicitud idéntica tras respuesta incierta")
      .action(async opts => prepareApproval(opts.operationId, action === "create" ? "api_keys.generate" : "api_keys.rotate", approvalTeam(), {}));
  }
  const approvals = program.command("account-approvals").description("Aprobaciones de credenciales: estado y cancelación, sin ejecución ni secretos");
  approvals.command("get <id>").action(async id => approvalRequest("GET", `/users/me/account-approvals/${approvalId(id)}`, id));
  approvals.command("cancel <id>").option("-y, --yes", "Confirmar cancelación pendiente")
    .action(async (id, opts) => {
      approvalId(id);
      await requireConfirmation(opts.yes, "¿Cancelar esta aprobación pendiente? No revoca credenciales ya emitidas.");
      await approvalRequest("DELETE", `/users/me/account-approvals/${id}`, id);
    });
  keys.command("revoke <keyId>").description("Revocar una clave API del equipo; no acepta IDs MCP")
    .option("-y, --yes", "Confirmar revocación")
    .action(async (id, opts) => {
      const path = `/api-keys/${segment(id)}`;
      await requireConfirmation(opts.yes, `¿Revocar la clave API ${id}?`);
      printJson(await api("DELETE", path));
    });
  keys.command("emergency-revoke").description("Revocar TODAS las claves API y MCP asociadas al equipo, incluida la credencial actual si es MCP; excluye OAuth")
    .option("-y, --yes", "Confirmar revocación de claves API y MCP del equipo")
    .action(async opts => {
      await requireConfirmation(opts.yes, "¿Revocar todas las claves API y MCP del equipo? OAuth permanecerá activo.");
      printJson(await api("POST", "/api-keys/emergency-revoke", { body: {} }));
    });
}
