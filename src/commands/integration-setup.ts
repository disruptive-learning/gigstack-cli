import { credentialMode } from "../credential-mode.js";
import { Command, Option } from "commander";
import { api } from "../api.js";
import { requireConfirmation, segment, teamTarget } from "../input.js";
import { printJson } from "../output.js";

const pathFor = (team: string, session?: string) =>
  `${teamTarget(team)}/integration-connection-sessions${session === undefined ? "" : `/${segment(session)}`}`;
const pick = (value: any, keys: string[]) =>
  Object.fromEntries(
    keys.filter((k) => Object.hasOwn(value ?? {}, k)).map((k) => [k, value[k]]),
  );
function show(response: any) {
  const data = pick(response?.data, [
    "id",
    "team_id",
    "team",
    "provider",
    "method",
    "credential_livemode",
    "effect_scope",
    "status",
    "created_at",
    "expires_at",
    "updated_at",
    "completion_url",
    "can_submit",
    "recovery_available_at",
    "disclosures",
    "credential_schema",
    "result",
    "error",
    "resolution",
  ]);
  if (response?.data?.recovery !== undefined)
    data.recovery =
      response.data.recovery === null
        ? null
        : pick(response.data.recovery, [
            "operation_id",
            "action",
            "original_status",
            "effect_scope",
            "livemode",
            "local_disabled_count",
            "snapshot_complete",
            "identity_verification",
            "imports_disabled",
            "prior_outcome_preserved",
          ]);
  const result = { ...pick(response, ["success", "timestamp"]), data };
  const status = result?.data?.status;
  if (["failed", "outcome_unknown"].includes(status)) {
    process.exitCode = 1;
    printJson({
      ...result,
      success: false,
      error: {
        code: status,
        message:
          "Conexión no confirmada; consulta o concilia la misma sesión. No repitas el envío de credenciales.",
      },
    });
  } else printJson(result);
}
export function registerIntegrationSetup(integrations: Command) {
  const setup = integrations
    .command("setup")
    .description(
      "Sesiones de conexión con credenciales privadas en el navegador; usuario Firebase/MCP personal",
    );
  setup
    .command("create <teamId>")
    .description(
      "Crear enlace autenticado; no conecta hasta completar el consentimiento en el navegador",
    )
    .addOption(
      new Option("--provider <provider>", "Adaptador de conexión admitido")
        .choices(["airtable", "mercadolibre", "netsuite", "zettle"])
        .makeOptionMandatory(),
    )
    .option(
      "--expected-mode <mode>",
      "Modo live|test explícito para credenciales sin modo declarado",
    )
    .option(
      "--recovery-operation-id <uuid>",
      "Operación Airtable incierta original; no repite refresh",
    )
    .option(
      "--acknowledge-unconfirmed-effects",
      "Reconocer desactivación local compartida y efectos previos inciertos",
    )
    .option(
      "-y, --yes",
      "Confirmar creación de sesión y bloqueo temporal del proveedor",
    )
    .action(async (team, opts) => {
      const path = pathFor(team);
      await requireConfirmation(
        opts.yes,
        "¿Crear una sesión de conexión? Abre completion_url en el navegador y revisa el alcance antes de autorizar; esta acción no conecta el proveedor. La recuperación Airtable desactiva hasta 100 suscripciones locales por llamada en ambos modos; cada continuación necesita confirmación. La reconexión de recuperación restaura acceso limitado, no importaciones.",
      );
      if (
        Boolean(opts.recoveryOperationId) !==
          Boolean(opts.acknowledgeUnconfirmedEffects) ||
        (opts.recoveryOperationId &&
          (opts.provider !== "airtable" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              opts.recoveryOperationId,
            )))
      )
        throw new Error(
          "Recuperación Airtable requiere UUID original y reconocimiento explícito juntos",
        );
      show(
        await api("POST", path, {
          team,
          body: {
            provider: opts.provider,
            ...(opts.provider === "airtable"
              ? { expected_livemode: credentialMode(opts.expectedMode) }
              : {}),
            ...(opts.recoveryOperationId
              ? {
                  recovery_operation_id: opts.recoveryOperationId,
                  acknowledge_unconfirmed_effects: true,
                }
              : {}),
          },
        }),
      );
    });
  setup
    .command("get <teamId> <sessionId>")
    .description(
      "Leer estado, alcance y enlace; pending/awaiting_oauth no significa conectado",
    )
    .action(async (team, session) =>
      show(await api("GET", pathFor(team, session), { team })),
    );
  setup
    .command("cancel <teamId> <sessionId>")
    .description(
      "Cancelar sesión pendiente/vencida; nunca desconecta una conexión existente",
    )
    .option("-y, --yes", "Confirmar cancelación de la sesión")
    .action(async (team, session, opts) => {
      const path = pathFor(team, session);
      await requireConfirmation(
        opts.yes,
        "¿Cancelar esta sesión de configuración? No desconecta ni deshace conexiones existentes.",
      );
      show(await api("DELETE", path, { body: {}, team }));
    });
  setup
    .command("reconcile <teamId> <sessionId>")
    .description(
      "Consultar evidencia de la misma sesión sin repetir escrituras al proveedor; recuperación explícita solo en navegador",
    )
    .action(async (team, session) =>
      show(
        await api("POST", `${pathFor(team, session)}/reconcile`, {
          body: {},
          team,
        }),
      ),
    );
}
