import { Command } from "commander";
import { api } from "../api.js";
import { credentialMode } from "../credential-mode.js";
import { printJson } from "../output.js";
import {
  readJsonInput,
  requireConfirmation,
  segment,
  teamTarget,
  withJsonInput,
} from "../input.js";
import schemas from "../schemas/manual-webhook-request.schema.json";
type Action = keyof typeof schemas;
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    v,
  );
function validate(action: Action, body: Record<string, unknown>) {
  const schema = schemas[action] as any;
  if (
    schema.required.some((k: string) => !Object.hasOwn(body, k)) ||
    Object.entries(body).some(([k, v]) => {
      const field = schema.properties[k];
      return (
        !field ||
        (field.const !== undefined && v !== field.const) ||
        (field.type && typeof v !== field.type) ||
        (field.pattern && !new RegExp(field.pattern).test(String(v))) ||
        (field.enum && !field.enum.includes(v))
      );
    })
  )
    throw new Error(
      "Solicitud de webhook inválida. Requiere UUID persistido y confirmación; no acepta payloads ni secretos ni selección de modo en JSON.",
    );
}
function show(
  result: any,
  action: Action,
  team: string,
  input: Record<string, unknown>,
) {
  const d = result?.data;
  if (
    !d ||
    !uuid(d.operation_id) ||
    d.operation_id !== input.operation_id ||
    d.team_id !== team ||
    d.livemode !== input.expected_livemode ||
    !["test", "retry", "resend_current"].includes(d.action) ||
    (action !== "get" && d.action !== action) ||
    !id(d.endpoint_id) ||
    (input.endpoint_id !== undefined && input.endpoint_id !== d.endpoint_id) ||
    typeof d.delivery_id !== "string" ||
    !/^manual-[0-9a-f]{64}$/.test(d.delivery_id) ||
    d.log_id !== d.delivery_id ||
    !["attempting", "submitted", "unknown", "prevented"].includes(
      d.submission,
    ) ||
    !["pending", "processing", "delivered", "retrying", "failed"].includes(
      d.delivery,
    ) ||
    (d.submission === "prevented" && d.delivery !== "failed") ||
    !Number.isSafeInteger(d.attempts) ||
    d.attempts < 0 ||
    d.duplicate_delivery_possible !== true ||
    d.payload_semantics !==
      (d.action === "retry" ? "stored_event_snapshot" : "current_resource") ||
    d.v2_state !== "current_at_delivery"
  )
    throw new Error(
      "Recibo de webhook inválido. Conserva UUID/equipo/modo; consulta la operación sin repetir el envío.",
    );
  const data = Object.fromEntries(
    [
      "operation_id",
      "action",
      "team_id",
      "livemode",
      "endpoint_id",
      "delivery_id",
      "log_id",
      "submission",
      "delivery",
      "attempts",
      "duplicate_delivery_possible",
      "payload_semantics",
      "v2_state",
    ].map((k) => [k, d[k]]),
  );
  const failed =
    ["unknown", "prevented"].includes(d.submission) || d.delivery === "failed";
  if (failed) process.exitCode = 1;
  printJson({
    success: !failed,
    data,
    ...(failed
      ? {
          error: {
            code: "webhook_delivery_unconfirmed",
            message:
              "Consulta el mismo UUID. No repitas el envío automáticamente; el receptor puede haber causado efectos.",
          },
        }
      : {}),
  });
}
export function registerManualWebhookCommands(webhooks: Command) {
  for (const action of ["test", "resend_current", "retry"] as const) {
    const name = action === "resend_current" ? "resend-current" : action;
    withJsonInput(
      webhooks
        .command(`${name} <teamId> <id>`)
        .description(
          action === "retry"
            ? "Nueva entrega de log histórico; v2 usa estado actual al entregar, no copia exacta"
            : action === "test"
              ? "Enviar prueba explícita a endpoint guardado, incluso inactivo"
              : "Enviar estado actual de recurso como nuevo evento",
        ),
    )
      .option(
        "--yes",
        "Confirmar envío externo y efectos reales incluso en prueba",
      )
      .option(
        "--expected-mode <mode>",
        "Afirmación live|test para credencial sin modo",
      )
      .action(async (team, target, opts) => {
        teamTarget(team);
        if (!id(team) || !id(target)) throw new Error("Identificador inválido");
        const raw = await readJsonInput(opts);
        const pathField = action === "retry" ? "log_id" : "endpoint_id";
        if (
          Object.hasOwn(raw, pathField) ||
          Object.hasOwn(raw, "expected_livemode")
        )
          throw new Error(
            "El equipo/identificador/modo procede de la selección explícita, no del JSON",
          );
        const mode = credentialMode(opts.expectedMode);
        const input = { ...raw, [pathField]: target, expected_livemode: mode };
        validate(action, input);
        await requireConfirmation(
          opts.yes,
          `Enviar ${name} para equipo ${team}, modo ${mode ? "live" : "test"}, destino/log ${target}, operación ${input.operation_id}. El receptor puede causar efectos reales y duplicados; configuración compartida entre modos. ¿Continuar?`,
        );
        const body = { ...input };
        delete body[pathField];
        const path =
          action === "retry"
            ? `${teamTarget(team)}/webhook-deliveries/${segment(target)}/retry`
            : `/webhooks/${segment(target)}/${name}`;
        let result: unknown;
        try {
          result = await api("POST", path, { team, body });
        } catch {
          throw Object.assign(
            new Error(
              `Envío no confirmado; el resultado puede ser desconocido. Conserva operación ${input.operation_id}, equipo ${team} y modo ${mode ? "live" : "test"}; consulta la operación sin repetir el envío.`,
            ),
            { code: "manual_webhook_unconfirmed", outcome: "unknown" },
          );
        }
        show(result, action, team, input);
      });
  }
  webhooks
    .command("operation <teamId> <operationId>")
    .description(
      "Consultar recibo sin enviar ni reintentar; conserva UUID y modo originales",
    )
    .option(
      "--expected-mode <mode>",
      "Afirmación live|test para credencial sin modo",
    )
    .action(async (team, operation, opts) => {
      teamTarget(team);
      const input = {
        operation_id: operation,
        expected_livemode: credentialMode(opts.expectedMode),
      };
      validate("get", input);
      show(
        await api(
          "GET",
          `${teamTarget(team)}/webhook-operations/${segment(operation)}`,
          {
            team,
            query: { expected_livemode: String(input.expected_livemode) },
          },
        ),
        "get",
        team,
        input,
      );
    });
  webhooks
    .command("manual-schema <action>")
    .description(
      "JSON local para test/resend_current/retry/get; UUID estable, campos de ruta/modo derivados",
    )
    .action((action) => {
      if (!Object.hasOwn(schemas, action))
        throw new Error("Acción desconocida");
      const schema = structuredClone(schemas[action as Action]) as any;
      const fields = [
        "expected_livemode",
        action === "retry"
          ? "log_id"
          : action === "get"
            ? "operation_id"
            : "endpoint_id",
      ];
      fields.forEach((k) => delete schema.properties[k]);
      schema.required = schema.required.filter(
        (k: string) => !fields.includes(k),
      );
      printJson(schema);
    });
}
