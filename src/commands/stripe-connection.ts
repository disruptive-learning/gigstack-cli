import { Command } from "commander";
import { api } from "../api.js";
import { credentialMode } from "../credential-mode.js";
import { printJson } from "../output.js";
import {
  withJsonInput,
  readJsonInput,
  teamTarget,
  segment,
  requireConfirmation,
} from "../input.js";
import {
  safeStripe,
  safeStripeActivation,
  stripeInput,
  stripeSchema,
  stripeUuid,
} from "../stripe-connection.js";
const root = (team: string) => `${teamTarget(team)}/integrations/stripe`;
const operation = (id: string) => {
  if (!stripeUuid(id))
    throw Error("operation_id debe ser UUIDv4 guardado antes de enviar");
  return segment(id);
};
export function registerStripeConnectionCommands(program: Command) {
  const commands = program
    .command("stripe-connection")
    .description(
      "Conexión Stripe con IDs seguros; OAuth, claves y webhooks requieren revisión personal en navegador privado. Desconectar localmente no revoca Stripe ni elimina webhooks.",
    );
  commands
    .command("schema <action>")
    .action((action) => printJson(stripeSchema(action)));
  commands
    .command("status <teamId>")
    .option("--expected-mode <mode>", "live|test")
    .action(async (team, opts) => {
      const mode = credentialMode(opts.expectedMode),
        res = await api("GET", root(team) + "/connection", {
          team,
          query: { livemode: String(mode) },
        });
      printJson({ data: safeStripe(res.data, team, mode) });
    });
  for (const action of ["prepare", "disconnect", "create-standard"] as const)
    withJsonInput(
      commands
        .command(`${action} <teamId>`)
        .option("--expected-mode <mode>", "live|test")
        .option("--yes", "Confirmar eliminación local de credenciales")
        .description(
          action === "create-standard"
            ? "Crea cuenta Standard real con UUID guardado; no prueba activación, consulta tras respuesta incierta"
            : action === "prepare"
              ? "Guarda UUID antes de enviar; devuelve revisión privada sin credenciales"
              : "Elimina credenciales compartidas de ambos modos; no cancela llamadas ya autorizadas ni revoca Stripe",
        ),
    ).action(async (team, opts) => {
      const mode = credentialMode(opts.expectedMode),
        input = await readJsonInput(opts);
      if (input.livemode !== undefined && input.livemode !== mode)
        throw Error("El modo no coincide con la credencial");
      const body = stripeInput(
        action === "prepare"
          ? "create"
          : action === "create-standard"
            ? "standard_create"
            : "disconnect",
        {
          ...input,
          livemode: mode,
        },
      );
      if (action === "disconnect")
        await requireConfirmation(
          opts.yes,
          "Eliminar todas las credenciales locales live/test sin revocar autorización ni eliminar webhooks en Stripe",
        );
      const res = await api(
        "POST",
        root(team) +
          (action === "prepare"
            ? "/connection-sessions"
            : action === "create-standard"
              ? "/standard-accounts"
              : "/disconnect"),
        { team, body },
      );
      printJson({
        data: safeStripe(res.data, team, mode, String(body.operation_id)),
      });
    });
  withJsonInput(
    commands
      .command("refresh-standard <teamId> <accountId>")
      .option("--expected-mode <mode>", "live|test")
      .description(
        "Consultar activación actual en Stripe; sin crear cuentas ni repetir efectos financieros",
      ),
  ).action(async (team, accountId, opts) => {
    if (!/^acct_[A-Za-z0-9]+$/.test(accountId))
      throw Error("Cuenta Stripe inválida");
    const mode = credentialMode(opts.expectedMode),
      input = await readJsonInput(opts);
    if (input.livemode !== undefined && input.livemode !== mode)
      throw Error("El modo no coincide con la credencial");
    const body = stripeInput("standard_refresh", { ...input, livemode: mode });
    const res = await api(
      "POST",
      root(team) + `/standard-accounts/${segment(accountId)}/refresh`,
      { team, body },
    );
    printJson({
      data: safeStripeActivation(
        res.data,
        team,
        mode,
        accountId,
        Number(body.expected_generation),
      ),
    });
  });
  for (const action of ["operation", "cancel"] as const)
    commands
      .command(`${action} <teamId> <operationId>`)
      .option("--expected-mode <mode>", "live|test")
      .description(
        action === "operation"
          ? "Consultar UUID guardado; nunca repetir efectos desconocidos"
          : "Cancelar preparación sin efectos; resultados inciertos requieren revisión privada",
      )
      .action(async (team, id, opts) => {
        const mode = credentialMode(opts.expectedMode),
          op = operation(id),
          res = await api(
            action === "operation" ? "GET" : "POST",
            root(team) +
              (action === "operation"
                ? `/operations/${op}`
                : `/connection-sessions/${op}/cancel`),
            {
              team,
              query: { livemode: String(mode) },
              ...(action === "cancel"
                ? { body: stripeInput("terminal", { livemode: mode }) }
                : {}),
            },
          );
        printJson({ data: safeStripe(res.data, team, mode, id) });
      });
}
