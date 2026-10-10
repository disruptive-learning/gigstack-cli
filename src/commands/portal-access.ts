import { Command } from "commander";
import { api } from "../api.js";
import { credentialMode } from "../credential-mode.js";
import { printJson } from "../output.js";
import { readJsonInput, teamTarget, withJsonInput } from "../input.js";
import { portalUuid, safePortalOperation } from "../portal-access.js";
export function registerPortalAccessCommands(program: Command) {
  const portals = program
    .command("portal-access")
    .description(
      "Preparar acceso privado sin entregar credenciales a agentes; aprobar sólo en navegador personal",
    );
  for (const family of ["customer", "invoices"] as const) {
    const group = portals
      .command(family)
      .description(
        family === "customer"
          ? "Cliente exacto: desafío 5 días, sesión 3 días, lectura/actualización/descarga/renderizado"
          : "Lectura de facturas en modo exacto, máximo 24 horas",
      );
    const resource =
      family === "customer"
        ? "customer-portal-operations"
        : "invoice-portal-operations";
    withJsonInput(
      group
        .command("prepare <teamId>")
        .description(
          "Guarda operation_id UUIDv4 antes de enviar. No emite credencial; abrir browser_handoff para revisión personal explícita.",
        ),
    )
      .option(
        "--expected-mode <mode>",
        "live|test, afirmación de modo verificada por servidor",
      )
      .action(async (teamId, opts) => {
        const path = teamTarget(teamId),
          body = await readJsonInput(opts),
          mode = credentialMode(opts.expectedMode);
        portalUuid(body.operation_id);
        const allowed = [
          "operation_id",
          "livemode",
          "replaces_operation_id",
          ...(family === "customer"
            ? ["client_id", "email"]
            : ["expiresIn", "scopes"]),
        ];
        if (
          Object.keys(body).some((k) => !allowed.includes(k)) ||
          (body.livemode !== undefined && body.livemode !== mode)
        )
          throw new Error("Entrada o modo inválido");
        if (
          family === "customer" &&
          Number(body.client_id !== undefined) +
            Number(body.email !== undefined) !==
            1
        )
          throw new Error("Selecciona exactamente client_id o email");
        const res = await api("POST", `${path}/${resource}`, {
          body: { ...body, livemode: mode },
          team: teamId,
          query: { livemode: String(mode) },
        });
        printJson({
          data: safePortalOperation(
            res.data,
            family,
            teamId,
            mode,
            body.operation_id,
          ),
        });
      });
    for (const [action, method] of [
      ["get", "GET"],
      ["cancel", "DELETE"],
    ] as const)
      group
        .command(`${action} <teamId> <operationId>`)
        .description(
          action === "get"
            ? "Consultar resultado seguro; nunca repite credenciales"
            : "Cancelar preparación no emitida; acceso activo requiere revocación privada revisada",
        )
        .option(
          "--expected-mode <mode>",
          "live|test, afirmación verificada por servidor",
        )
        .action(async (teamId, operationId, opts) => {
          const path = teamTarget(teamId),
            mode = credentialMode(opts.expectedMode),
            operation = portalUuid(operationId);
          const res = await api(method, `${path}/${resource}/${operation}`, {
            team: teamId,
            query: { livemode: String(mode) },
          });
          printJson({
            data: safePortalOperation(
              res.data,
              family,
              teamId,
              mode,
              operation,
            ),
          });
        });
  }
}
