import { Command, Option } from "commander";
import { api } from "../api.js";
import { requireConfirmation, segment, teamTarget } from "../input.js";
import { printJson } from "../output.js";

const pathFor = (team: string, session?: string) => `${teamTarget(team)}/integration-connection-sessions${session === undefined ? "" : `/${segment(session)}`}`;
function show(result: any) {
  const status = result?.data?.status;
  if (["failed", "outcome_unknown"].includes(status)) {
    process.exitCode = 1;
    printJson({ ...result, success: false, error: { code: status, message: "Conexión no confirmada; consulta o concilia la misma sesión. No repitas el envío de credenciales." } });
  } else printJson(result);
}
export function registerIntegrationSetup(integrations: Command) {
  const setup = integrations.command("setup").description("Sesiones de conexión con credenciales privadas en el navegador; usuario Firebase/MCP personal");
  setup.command("create <teamId>").description("Crear enlace autenticado; no conecta hasta completar el consentimiento en el navegador")
    .addOption(new Option("--provider <provider>", "Adaptador de conexión admitido").choices(["airtable", "mercadolibre", "netsuite", "zettle"]).makeOptionMandatory())
    .option("-y, --yes", "Confirmar creación de sesión y bloqueo temporal del proveedor")
    .action(async (team, opts) => {
      const path = pathFor(team);
      await requireConfirmation(opts.yes, "¿Crear una sesión de conexión? Abre completion_url en el navegador y revisa el alcance antes de autorizar; esta acción no conecta el proveedor.");
      show(await api("POST", path, { body: { provider: opts.provider } }));
    });
  setup.command("get <teamId> <sessionId>").description("Leer estado, alcance y enlace; pending/awaiting_oauth no significa conectado")
    .action(async (team, session) => show(await api("GET", pathFor(team, session))));
  setup.command("cancel <teamId> <sessionId>").description("Cancelar sesión pendiente/vencida; nunca desconecta una conexión existente")
    .option("-y, --yes", "Confirmar cancelación de la sesión")
    .action(async (team, session, opts) => {
      const path = pathFor(team, session);
      await requireConfirmation(opts.yes, "¿Cancelar esta sesión de configuración? No desconecta ni deshace conexiones existentes.");
      show(await api("DELETE", path, { body: {} }));
    });
  setup.command("reconcile <teamId> <sessionId>").description("Consultar evidencia de la misma sesión sin repetir escrituras al proveedor; recuperación explícita solo en navegador")
    .action(async (team, session) => show(await api("POST", `${pathFor(team, session)}/reconcile`, { body: {} })));
}
