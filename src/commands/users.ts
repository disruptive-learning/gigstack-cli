import { managedInput } from '../managed-identity-contract.js';
import { approvalTeam, prepareApproval, membershipTarget } from '../account-approvals.js';
import { Command } from "commander";
import { api } from "../api.js";
import { withListOpts, buildListQuery } from "../list-opts.js";
import { withJsonInput, readJsonInput, requireConfirmation, segment } from "../input.js";
import { printJson, printKeyValue, isJsonMode } from "../output.js";

function show(res: any) { isJsonMode() ? printJson(res) : printKeyValue(res.data ?? res); }

export function registerUserCommands(program: Command) {
  const users = program.command("users").description("Usuarios de la cuenta; escrituras requieren admin, no equivale a perfil personal");
  withListOpts(users.command("list").description("Listar usuarios accesibles"))
    .action(async opts => show(await api("GET", "/users", { query: buildListQuery(opts) })));
  users.command("get <id>").description("Consultar usuario accesible")
    .action(async id => show(await api("GET", `/users/${segment(id)}`)));
  withJsonInput(users.command("create-admin").description("Prepare managed administrator creation for two browser reviews; --team and both canonical ownerships required")
    .requiredOption("--operation-id <uuid>", "Persisted UUIDv4; reuse only for identical preparation"))
    .action(async opts => prepareApproval(opts.operationId, "managed_users.create_admin", approvalTeam(), managedInput(await readJsonInput(opts))));
  withJsonInput(users.command("create").description("Crear usuario administrado: email, first_name, last_name, phone, address, auto_join y role"))
    .action(async opts => {
      const body = await readJsonInput(opts);
      if (body.role === "admin") throw new Error("Use users create-admin with --operation-id and --team for reviewed creation. For separate creation/promotion, create a viewer/editor first.");
      if (body.role !== undefined && !["admin", "editor", "viewer"].includes(body.role)) throw new Error("role debe ser admin, editor o viewer");
      show(await api("POST", "/users", { body }));
    });
  withJsonInput(users.command("update <id>").description("Actualizar perfil de un usuario como admin; no cambia email ni membresías reservadas"))
    .action(async (id, opts) => show(await api("PUT", `/users/${segment(id)}`, { body: await readJsonInput(opts) })));
  users.command("reset-password <id>").description("Retirado: usa password-reset prepare/get/execute con UUID guardado")
    .action(() => { throw new Error("reset_delivery_operation_required: use password-reset prepare, then explicitly execute the saved UUID; no email was requested"); });
  users.command("issue-session <id>").alias("login-link")
    .description("Prepare owner-reviewed managed session access; no bearer or login link is returned to CLI")
    .requiredOption("--operation-id <uuid>", "Persisted UUIDv4 for this exact session intent")
    .action(async (id, opts) => prepareApproval(opts.operationId, "managed_users.issue_session", approvalTeam(), { user_id: membershipTarget(id) }));
  users.command("revoke-sessions <id>")
    .description("Prepare owner-reviewed refresh-token revocation; existing custom tokens may still be exchanged")
    .requiredOption("--operation-id <uuid>", "Persisted UUIDv4 for this exact revocation intent")
    .action(async (id, opts) => prepareApproval(opts.operationId, "managed_users.revoke_sessions", approvalTeam(), { user_id: membershipTarget(id) }));
  users.command("delete <id>").description("Retirar al usuario de equipos administrados; conserva su acceso de inicio de sesión y perfil")
    .option("-y, --yes", "Confirmar retiro de equipos; no elimina la identidad")
    .action(async (id, opts) => {
      const path = `/users/${segment(id)}`;
      await requireConfirmation(opts.yes, `¿Retirar al usuario ${id} de los equipos que administras? Se conservarán su identidad y perfil.`);
      show(await api("DELETE", path));
    });
}
