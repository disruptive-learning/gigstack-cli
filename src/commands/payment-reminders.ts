import { Command } from "commander";
import { api } from "../api.js";
import { credentialMode } from "../credential-mode.js";
import { printJson } from "../output.js";
import {
  readJsonInput,
  withJsonInput,
  segment,
  teamTarget,
  requireConfirmation,
} from "../input.js";
import {
  reminderInput,
  reminderSchema,
  reminderUuid,
  safeReminderConfig,
  safeReminderResult,
  safeReminderPrepared,
} from "../payment-reminders.js";
const operation = (value: string) => {
  if (!reminderUuid(value))
    throw new Error("operation_id debe ser UUIDv4 guardado");
  return segment(value);
};
const root = (team: string, payment: string) => {
  teamTarget(team);
  return `/payments/${segment(payment)}`;
};
export function registerPaymentReminderCommands(program: Command) {
  const commands = program
    .command("payment-reminders")
    .description(
      "Programación individual por pago/modo; los estados no confirman entrega de correo. Quitar todos puede activar predeterminados del equipo; modo de prueba en producción puede enviar correos reales.",
    );
  commands.command("schema <action>").action((action) => {
    if (!["configure", "recovery_prepare"].includes(action))
      throw new Error("Acción de esquema inválida");
    printJson(reminderSchema(action));
  });
  commands
    .command("get <teamId> <paymentId>")
    .option("--expected-mode <mode>", "live|test")
    .action(async (team, payment, opts) => {
      const mode = credentialMode(opts.expectedMode);
      const response = await api("GET", root(team, payment) + "/reminders", {
        team,
      });
      printJson({
        data: safeReminderConfig(response.data, team, mode, payment),
      });
    });
  withJsonInput(
    commands
      .command("replace <teamId> <paymentId>")
      .option("--expected-mode <mode>", "live|test")
      .option("--yes", "Confirmar programación")
      .description(
        "Guarda UUID antes de enviar; no reintentes resultados desconocidos. expected_livemode deriva de la credencial.",
      ),
  ).action(async (team, payment, opts) => {
    const mode = credentialMode(opts.expectedMode);
    const input = await readJsonInput(opts);
    if ("expected_livemode" in input)
      throw new Error("expected_livemode deriva de la credencial");
    const body = reminderInput("configure", {
      ...input,
      expected_livemode: mode,
    });
    await requireConfirmation(
      opts.yes,
      "Guardar esta programación; puede enviar correos reales y quitar todos puede activar los predeterminados del equipo",
    );
    const response = await api("PUT", root(team, payment) + "/reminders", {
      team,
      body,
    });
    printJson({
      data: safeReminderResult(
        response.data,
        team,
        mode,
        payment,
        body.operation_id,
      ),
    });
  });
  for (const action of ["operation", "reconcile", "continue"] as const)
    commands
      .command(`${action} <teamId> <paymentId> <operationId>`)
      .option("--expected-mode <mode>", "live|test")
      .description(
        action === "continue"
          ? "Continuar únicamente pasos sin intentar; no repetir envíos inciertos"
          : "Leer estado; no prueba que no se haya enviado correo",
      )
      .action(async (team, payment, id, opts) => {
        const mode = credentialMode(opts.expectedMode);
        const path =
          root(team, payment) +
          `/reminder-operations/${operation(id)}` +
          (action === "operation" ? "" : `/${action}`);
        const response = await api(
          action === "operation" ? "GET" : "POST",
          path,
          { team, ...(action === "operation" ? {} : { body: {} }) },
        );
        printJson({
          data: safeReminderResult(response.data, team, mode, payment, id),
        });
      });
  withJsonInput(
    commands
      .command("prepare-recovery <teamId> <paymentId>")
      .option("--expected-mode <mode>", "live|test")
      .description(
        "Preparar revisión congelada, sin enviar; abrir review_url en navegador privado y volver a autenticar. El CLI no revela desafíos ni ejecuta recuperaciones.",
      ),
  ).action(async (team, payment, opts) => {
    const mode = credentialMode(opts.expectedMode);
    const input = await readJsonInput(opts);
    if ("expected_livemode" in input)
      throw new Error("expected_livemode deriva de la credencial");
    const body = reminderInput("recovery_prepare", {
      ...input,
      expected_livemode: mode,
    });
    const response = await api(
      "POST",
      root(team, payment) + "/reminder-recoveries",
      { team, body },
    );
    printJson({
      data: safeReminderPrepared(
        response.data,
        team,
        mode,
        payment,
        body.operation_id,
      ),
    });
  });
}
