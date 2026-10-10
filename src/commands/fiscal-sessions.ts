import { Command } from "commander";
import { api } from "../api.js";
import { requireConfirmation, segment, teamTarget } from "../input.js";
import { printJson } from "../output.js";

/** Agent-safe handoff only: private files, passwords and browser consent never enter these commands. */
export function registerFiscalSessionCommands(teams: Command) {
  const fiscal = teams.command("fiscal").description("Carga fiscal en navegador; requiere propietario Firebase/MCP actual");
  fiscal.command("status <teamId>").description("Estado fiscal seguro; configuración compartida entre prueba y real")
    .action(async id => printJson(await api("GET", `${teamTarget(id)}/fiscal-status`)));
  const sessions = fiscal.command("sessions").description("Sesiones de carga; el usuario confirma el alcance y envía archivos en su navegador");
  sessions.command("create <teamId>")
    .requiredOption("--purpose <purpose>", "csd, fiel, pfx o manifest")
    .option("-y, --yes", "Confirmar creación de sesión; no sustituye el consentimiento del navegador")
    .action(async (id, opts) => {
      const path = `${teamTarget(id)}/fiscal-upload-sessions`;
      if (!["csd", "fiel", "pfx", "manifest"].includes(opts.purpose)) throw new Error("Propósito fiscal inválido");
      await requireConfirmation(opts.yes, "¿Crear una sesión de carga fiscal para el propietario? La configuración se comparte entre prueba y real; el proveedor puede operar en producción.");
      printJson(await api("POST", path, { body: { purpose: opts.purpose } }));
    });
  sessions.command("get <teamId> <sessionId>").description("Consultar URL/estado; no devuelve certificados ni contraseñas")
    .action(async (id, sessionId) => printJson(await api("GET", `${teamTarget(id)}/fiscal-upload-sessions/${segment(sessionId)}`)));
  sessions.command("cancel <teamId> <sessionId>").description("Cancelar sesión pendiente; no revierte operaciones iniciadas")
    .option("-y, --yes", "Confirmar cancelación")
    .action(async (id, sessionId, opts) => {
      const path = `${teamTarget(id)}/fiscal-upload-sessions/${segment(sessionId)}`;
      await requireConfirmation(opts.yes, "¿Cancelar esta sesión pendiente? La configuración fiscal existente se conserva.");
      printJson(await api("DELETE", path));
    });
  sessions.command("reconcile <teamId> <sessionId>").description("Verificar resultado incierto con lectura segura; nunca repite la carga")
    .option("-y, --yes", "Confirmar conciliación del estado de la sesión")
    .action(async (id, sessionId, opts) => {
      const path = `${teamTarget(id)}/fiscal-upload-sessions/${segment(sessionId)}/reconcile`;
      await requireConfirmation(opts.yes, "¿Consultar y conciliar el estado de esta operación sin volver a enviar archivos?");
      printJson(await api("POST", path, { body: {} }));
    });
}
