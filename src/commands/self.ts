import { Command } from "commander";
import { api } from "../api.js";
import { withJsonInput, readJsonInput, requireConfirmation, segment } from "../input.js";
import { printJson } from "../output.js";
import { saveCredential } from "../secure-output.js";

export function registerSelfCommands(program: Command) {
  const me = program.command("me").description("Tu identidad Firebase/MCP: perfil, preferencias, avisos y tokens personales; API/OAuth no puede suplantar al creador");
  me.command("get").action(async () => printJson(await api("GET", "/users/me")));
  withJsonInput(me.command("update").description("Editar first_name, last_name, phone, country alpha3, company_role; null borra, email no editable"))
    .action(async opts => printJson(await api("PATCH", "/users/me", { body: await readJsonInput(opts) })));
  const preferences = me.command("preferences");
  preferences.command("get <teamId>").action(async id => printJson(await api("GET", `/users/me/preferences/${segment(id)}`)));
  withJsonInput(preferences.command("update <teamId>").description("testmode, search_collection, invoices_order_by; null restablece"))
    .action(async (id, opts) => printJson(await api("PATCH", `/users/me/preferences/${segment(id)}`, { body: await readJsonInput(opts) })));
  withJsonInput(me.command("active-context").description("Elegir contexto de cuenta: team_id y/o billing_account_id; requiere membresía actual"))
    .action(async opts => printJson(await api("POST", "/users/me/active-context", { body: await readJsonInput(opts) })));
  const notifications = me.command("notifications");
  notifications.command("list").option("--limit <n>", "Límite 1-100", "50").option("--cursor <cursor>", "next_cursor anterior")
    .action(async opts => printJson(await api("GET", "/users/me/notifications", { query: { limit: opts.limit, ...(opts.cursor ? { cursor: opts.cursor } : {}) } })));
  notifications.command("unread-count").action(async () => printJson(await api("GET", "/users/me/notifications/unread-count")));
  notifications.command("read <notificationId>").description("Marcar leído por ID del destinatario")
    .action(async id => printJson(await api("POST", `/users/me/notifications/${segment(id)}/read`, { body: {} })));
  notifications.command("dismiss <notificationId>").description("Descartar aviso personal")
    .action(async id => printJson(await api("DELETE", `/users/me/notifications/${segment(id)}`)));
  notifications.command("read-all").description("Marcar leídos todos tus avisos")
    .option("-y, --yes", "Confirmar marcar todos leídos")
    .action(async opts => { await requireConfirmation(opts.yes, "¿Marcar todos tus avisos como leídos?"); printJson(await api("POST", "/users/me/notifications/read-all", { body: {} })); });
  const tokens = me.command("mcp-tokens").description("Tus tokens MCP; términos requieren aceptación expresa del usuario");
  tokens.command("list").action(async () => printJson(await api("GET", "/users/me/mcp-tokens")));
  withJsonInput(tokens.command("create").description("Emitir token personal: name, team_id, livemode; términos sólo con --accept-terms elegido expresamente por el usuario"))
    .option("--accept-terms", "El usuario ha leído y acepta expresamente los términos MCP; nunca inferir consentimiento")
    .requiredOption("--out <path>", "Archivo NUEVO privado (0600) para token y URL de una sola entrega")
    .option("-y, --yes", "Confirmar creación (no sustituye --accept-terms)")
    .action(async opts => {
      const body = await readJsonInput(opts);
      if (!opts.acceptTerms || body.terms_accepted === false) throw new Error("Se requiere --accept-terms con aceptación expresa del usuario; --yes no acepta términos");
      body.terms_accepted = true;
      await requireConfirmation(opts.yes, "¿Crear este token MCP personal con los términos aceptados expresamente?");
      const saved = await saveCredential(opts.out, () => api("POST", "/users/me/mcp-tokens", { body }));
      printJson({ success: true, data: { token: saved.result.data.token, credentials_file: saved.path } });
    });
  tokens.command("revoke <keyId>").description("Revocar uno de tus tokens MCP")
    .option("-y, --yes", "Confirmar revocación")
    .action(async (id, opts) => {
      const path = `/users/me/mcp-tokens/${segment(id)}`;
      await requireConfirmation(opts.yes, `¿Revocar tu token MCP ${id}?`);
      printJson(await api("DELETE", path));
    });
}
