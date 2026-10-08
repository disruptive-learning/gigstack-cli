import { Command } from "commander";
import { api } from "../api.js";
import { requireConfirmation, segment } from "../input.js";
import { printJson } from "../output.js";
import { saveCredential } from "../secure-output.js";

export function registerCredentialCommands(program: Command) {
  const keys = program.command("api-keys").description("Claves de equipo; requiere usuario Firebase/MCP administrador actual");
  keys.command("list").description("Metadatos sin secretos; pagina hasta has_more=false, incluso si data está vacía")
    .option("--limit <n>", "Límite (1-100)", "20")
    .option("--cursor <cursor>", "next_cursor de la página anterior")
    .option("--include-revoked", "Incluir claves revocadas")
    .action(async opts => printJson(await api("GET", "/api-keys", { query: { limit: opts.limit, ...(opts.cursor ? { cursor: opts.cursor } : {}), ...(opts.includeRevoked ? { include_revoked: "true" } : {}) } })));
  for (const action of ["create", "rotate"] as const) {
    keys.command(action).description(action === "create" ? "Crear par live/test si no hay claves API activas" : "Reemplazar par live/test; conserva tokens MCP personales")
      .requiredOption("--out <path>", "Archivo NUEVO privado para secretos de una sola entrega (modo 0600)")
      .option("-y, --yes", "Confirmar emisión de credenciales")
      .action(async opts => {
        await requireConfirmation(opts.yes, action === "rotate" ? "¿Revocar claves API actuales y emitir un par live/test nuevo?" : "¿Emitir un par de claves API live/test?");
        const saved = await saveCredential(opts.out, () => api("POST", action === "create" ? "/api-keys" : "/api-keys/rotate", { body: {} }));
        const data = saved.result.data;
        printJson({ success: true, data: { live: data.live.key, test: data.test.key, revoked_count: data.revoked_count, credentials_file: saved.path } });
      });
  }
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
