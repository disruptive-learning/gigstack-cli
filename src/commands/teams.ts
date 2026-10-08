import { registerFiscalSessionCommands } from "./fiscal-sessions.js";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { api } from "../api.js";
import { printJson, printKeyValue, isJsonMode } from "../output.js";
import { withJsonInput, readJsonInput, requireConfirmation, segment } from "../input.js";
import settingsSchema from "../schemas/team-settings.json";
import { runtimeOptions } from "../runtime.js";

/** A path target cannot silently disagree with the invocation's account context. */
function target(id: string): string {
  const selected = runtimeOptions().team ?? process.env.GIGSTACK_TEAM;
  if (selected && selected !== id) throw new Error("El ID del equipo no coincide con --team/GIGSTACK_TEAM");
  return `/teams/${segment(id)}`;
}
function show(res: any) {
  if (isJsonMode()) return printJson(res);
  printKeyValue(res.data && !Array.isArray(res.data) ? res.data : res);
}
async function call(method: string, path: string, body?: Record<string, any>) {
  show(await api(method, path, { body }));
}

export function registerTeamCommands(program: Command) {
  const teams = program.command("teams").description("Gestionar equipos, configuración y accesos");
  registerFiscalSessionCommands(teams);
  teams.command("list").description("Listar equipos accesibles")
    .option("--limit <n>", "Tamaño de página", "20").option("--next <cursor>", "Cursor")
    .action(async opts => call("GET", `/teams?limit=${encodeURIComponent(opts.limit)}${opts.next ? `&next=${encodeURIComponent(opts.next)}` : ""}`));
  teams.command("get <id>").description("Leer equipo y configuración")
    .action(async id => call("GET", target(id)));
  teams.command("integrations").description("Leer integraciones del equipo seleccionado con --team")
    .action(async () => call("GET", "/teams/integrations"));
  withJsonInput(teams.command("create").description("Crear equipo: objeto del contrato v2 teams"))
    .action(async opts => call("POST", "/teams", await readJsonInput(opts)));
  withJsonInput(teams.command("update <id>").description("Actualizar marca, datos fiscales y contacto del equipo"))
    .action(async (id, opts) => call("PUT", target(id), await readJsonInput(opts)));

  const settings = teams.command("settings").description("Valores predeterminados y automatizaciones");
  settings.command("schema").description("Contrato JSON Schema de los campos de configuración; no requiere conexión")
    .action(() => printJson(settingsSchema));
  settings.command("get <id>").description("Leer configuración persistida")
    .action(async id => call("GET", `${target(id)}/settings`));
  withJsonInput(settings.command("update <id>").description("Actualizar campos presentes; enviar null solo donde el contrato permita borrar"))
    .action(async (id, opts) => call("PUT", `${target(id)}/settings`, await readJsonInput(opts)));

  const series = teams.command("series").description("Series y folios");
  series.command("list <id>").action(async id => call("GET", `${target(id)}/series`));
  withJsonInput(series.command("create <id>").description('Crear serie: {"series":"A","live":0,"test":0}'))
    .action(async (id, opts) => call("POST", `${target(id)}/series`, await readJsonInput(opts)));
  withJsonInput(series.command("update <id> <seriesId>").description("Actualizar contadores live/test"))
    .action(async (id, seriesId, opts) => call("PUT", `${target(id)}/series/${segment(seriesId)}`, await readJsonInput(opts)));
  teams.command("onboarding-url <id>").description("Generar enlace fiscal y renovar la contraseña/desafío del portal CSD")
    .option("-y, --yes", "Confirmar renovación del acceso fiscal")
    .action(async (id, opts) => {
      const path = `${target(id)}/onboarding-url`;
      await requireConfirmation(opts.yes, "¿Generar nuevo acceso fiscal y renovar la contraseña/desafío del portal CSD?");
      show(await api("GET", path, { sideEffect: true }));
    });
  teams.command("portal-token <id>").description("Crear token de lectura del portal; trata la respuesta como secreto")
    .option("--expires-in <duration>", "Duración, máximo 24h", "1h")
    .action(async (id, opts) => call("POST", `${target(id)}/portal-access-token`, { expiresIn: opts.expiresIn }));
  teams.command("sat-connection <id>").description("Cargar CSD .cer/.key y contraseña desde archivos locales")
    .requiredOption("--cert-file <path>", "Certificado .cer")
    .requiredOption("--key-file <path>", "Llave privada .key")
    .requiredOption("--password-file <path>", "Archivo con contraseña (solo se retira el salto de línea final)")
    .action(async (id, opts) => {
      const path = target(id);
      const [cert, key, password] = await Promise.all([readFile(opts.certFile), readFile(opts.keyFile), readFile(opts.passwordFile, "utf8")]);
      const form = new FormData();
      form.set("cert", new Blob([new Uint8Array(cert)]), "certificate.cer");
      form.set("key", new Blob([new Uint8Array(key)]), "private.key");
      form.set("keyPass", password.replace(/\r?\n$/, ""));
      show(await api("POST", `${path}/sat-connection`, { form }));
    });
  withJsonInput(teams.command("sign-manifest <id>").description("Firmar manifiesto con e.firma; key/cert base64 y password"))
    .option("-y, --yes", "Confirmar firma")
    .action(async (id, opts) => {
      const path = target(id); const body = await readJsonInput(opts);
      await requireConfirmation(opts.yes, "¿Firmar el manifiesto de este equipo con la e.firma proporcionada?");
      await call("POST", `${path}/manifest/sign`, body);
    });
  teams.command("delete <id>").description("Programar eliminación del equipo (validaciones del servidor)")
    .option("-y, --yes", "Confirmar eliminación")
    .action(async (id, opts) => {
      const path = target(id);
      await requireConfirmation(opts.yes, `¿Programar la eliminación del equipo ${id}?`);
      await call("DELETE", path);
    });

  const members = teams.command("members").description("Miembros y permisos; cambios de rol/remoción requieren propietario");
  members.command("list <id>").action(async id => call("GET", `${target(id)}/members`));
  members.command("add <id> <userId>").description("Agregar usuario existente de la misma cuenta de facturación; no envía invitación")
    .option("--role <role>", "admin, editor o viewer", "viewer")
    .action(async (id, userId, opts) => {
      if (!["admin", "editor", "viewer"].includes(opts.role)) throw new Error("Rol inválido");
      await call("POST", `${target(id)}/add-member`, { id: userId, role: opts.role });
    });
  withJsonInput(members.command("update <id> <memberId>").description("Actualizar role y/o permissions (invoices, receipts, payments, services, expenses)"))
    .action(async (id, memberId, opts) => call("PATCH", `${target(id)}/members/${segment(memberId)}`, await readJsonInput(opts)));
  members.command("remove <id> <memberId>").description("Remover miembro como propietario autenticado")
    .option("-y, --yes", "Confirmar remoción")
    .action(async (id, memberId, opts) => {
      const path = `${target(id)}/members/${segment(memberId)}`;
      await requireConfirmation(opts.yes, `¿Remover a ${memberId} del equipo ${id}?`);
      await call("DELETE", path);
    });
  teams.command("transfer-ownership <id> <newOwnerId>").description("Transferir propiedad a un miembro; exige identidad del propietario actual")
    .option("-y, --yes", "Confirmar transferencia")
    .action(async (id, newOwnerId, opts) => {
      const path = target(id);
      await requireConfirmation(opts.yes, `¿Transferir la propiedad del equipo ${id} a ${newOwnerId}?`);
      await call("POST", `${path}/transfer-ownership`, { new_owner_id: newOwnerId });
    });

  const invites = teams.command("invitations").description("Invitaciones por correo; administración requiere identidad de usuario admin");
  invites.command("list <id>").action(async id => call("GET", `${target(id)}/invitations`));
  invites.command("get <id> <inviteId>")
    .action(async (id, inviteId) => call("GET", `${target(id)}/invitations/${segment(inviteId)}`));
  invites.command("create <id>").requiredOption("--email <email>", "Correo del destinatario")
    .option("--role <role>", "admin, editor o viewer", "viewer")
    .option("--no-send-email", "Crear sin enviar correo")
    .action(async (id, opts) => {
      if (!["admin", "editor", "viewer"].includes(opts.role)) throw new Error("Rol inválido");
      await call("POST", `${target(id)}/invitations`, { email: opts.email, role: opts.role, send_email: opts.sendEmail });
    });
  invites.command("resend <id> <inviteId>").description("Reenviar el correo de invitación")
    .action(async (id, inviteId) => call("POST", `${target(id)}/invitations/${segment(inviteId)}/resend`, {}));
  invites.command("revoke <id> <inviteId>").option("-y, --yes", "Confirmar revocación")
    .action(async (id, inviteId, opts) => {
      const path = `${target(id)}/invitations/${segment(inviteId)}`;
      await requireConfirmation(opts.yes, `¿Revocar la invitación ${inviteId}?`);
      await call("DELETE", path);
    });
  for (const action of ["accept", "decline"]) {
    withJsonInput(invites.command(action).description(`Responder invitación: {"token":"..."}; usa Firebase ID token del destinatario`))
      .action(async opts => call("POST", `/teams/invitations/${action}`, await readJsonInput(opts)));
  }
}
