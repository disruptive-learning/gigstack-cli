import { Command } from "commander";
import { api } from "../api.js";
import { withJsonInput, readJsonInput, requireConfirmation, segment } from "../input.js";
import { printJson } from "../output.js";
import { approvalTeam, prepareApproval } from "../account-approvals.js";

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
  withJsonInput(tokens.command("create").description("Preparar aprobación en navegador: name, team_id, livemode. El usuario acepta términos y recibe el secreto sólo allí"))
    .requiredOption("--operation-id <uuid>", "UUIDv4 persistido antes del primer intento; no cambiarlo al reintentar")
    .action(async opts => {
      const body = await readJsonInput(opts);
      if (Object.keys(body).some(k => !["name", "team_id", "livemode"].includes(k)) || typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 64 || typeof body.livemode !== "boolean") throw new Error("Se requiere name (1-64 caracteres), livemode booleano y team_id; los términos se aceptan en el navegador");
      await prepareApproval(opts.operationId, "mcp_tokens.create", approvalTeam(body.team_id), { name: body.name.trim(), livemode: body.livemode });
    });
  tokens.command("revoke <keyId>").description("Revocar uno de tus tokens MCP")
    .option("-y, --yes", "Confirmar revocación")
    .action(async (id, opts) => {
      const path = `/users/me/mcp-tokens/${segment(id)}`;
      await requireConfirmation(opts.yes, `¿Revocar tu token MCP ${id}?`);
      printJson(await api("DELETE", path));
    });
}
