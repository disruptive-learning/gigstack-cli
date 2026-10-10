import { airtableOutput, airtableTimestamp } from "../airtable-output.js";
import { Command, Option } from "commander";
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
import schemas from "../schemas/airtable-request.schema.json";
const base = (id: string) => `${teamTarget(id)}/integrations/airtable`;
type Action = keyof typeof schemas;
function valid(value: any, schema: any): boolean {
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "string")
    return (
      typeof value === "string" &&
      value.length >= (schema.minLength ?? 0) &&
      value.length <= (schema.maxLength ?? Infinity) &&
      (!schema.pattern || new RegExp(schema.pattern).test(value))
    );
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "integer")
    return (
      Number.isSafeInteger(value) &&
      value >= (schema.minimum ?? -Infinity) &&
      value <= (schema.maximum ?? Infinity)
    );
  if (
    schema.type !== "object" ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return false;
  const keys = Object.keys(value);
  return (
    keys.length >= (schema.minProperties ?? 0) &&
    keys.length <= (schema.maxProperties ?? Infinity) &&
    (schema.required ?? []).every((k: string) => Object.hasOwn(value, k)) &&
    keys.every(
      (k) =>
        !["__proto__", "constructor", "prototype"].includes(k) &&
        valid(
          value[k],
          Object.hasOwn(schema.properties ?? {}, k)
            ? schema.properties[k]
            : schema.additionalProperties,
        ),
    )
  );
}
function validate(action: Action, body: Record<string, any>) {
  if (!valid(body, schemas[action]))
    throw new Error(
      "Solicitud Airtable inválida; consulta el esquema local del comando.",
    );
  if (
    body.recovery_operation_id &&
    ((action !== "disconnect" && body.scope !== "shared") ||
      body.acknowledge_shared_connection !== true ||
      body.recovery_operation_id.toLowerCase() ===
        body.operation_id.toLowerCase())
  )
    throw new Error(
      "La recuperación requiere UUID nuevo y reconocimiento compartido explícito",
    );
}
function show(action: Action, result: any) {
  const data = airtableOutput(action, result?.data),
    timestamp = airtableTimestamp(result?.timestamp);
  const failed =
    ["failed", "outcome_unknown"].includes(data.status) ||
    data.partial_cleanup === true;
  if (failed) process.exitCode = 1;
  printJson({
    success: !failed,
    data,
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(failed
      ? {
          error: {
            code: data.status ?? "partial_cleanup",
            message:
              "Resultado incierto o parcial. Consulta o concilia el mismo UUID; no repitas escrituras automáticamente.",
          },
        }
      : {}),
  });
}
const query = (input: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(input)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
export function registerAirtableCommands(integrations: Command) {
  const airtable = integrations
    .command("airtable")
    .description(
      "Airtable real con OAuth compartido; los registros importados conservan modo. Usuario personal Firebase/MCP.",
    );
  airtable
    .command("schema <action>")
    .description(
      "Contrato de entrada local; UUID estable obligatorio en escrituras",
    )
    .action((action) => {
      if (!Object.hasOwn(schemas, action))
        throw new Error("Acción Airtable desconocida");
      const schema = structuredClone(schemas[action as Action]) as any;
      delete schema.properties.expected_livemode;
      schema.required = (schema.required ?? []).filter(
        (field: string) => field !== "expected_livemode",
      );
      if (action === "unregister") {
        delete schema.properties.webhook_id;
        schema.required = schema.required.filter(
          (field: string) => field !== "webhook_id",
        );
      }
      printJson({
        ...schema,
        description:
          "Esquema del JSON de entrada CLI. expected_livemode se deriva de la credencial o --expected-mode, nunca del JSON. En unregister, webhook_id proviene del argumento de ruta.",
      });
    });
  airtable
    .command("bases <teamId>")
    .option("--cursor <cursor>")
    .action(async (team, opts) => {
      const input = query({ cursor: opts.cursor });
      validate("bases", input);
      show(
        "bases",
        await api("GET", `${base(team)}/bases`, { query: input, team }),
      );
    });
  airtable.command("tables <teamId> <baseId>").action(async (team, baseId) => {
    validate("tables", { base_id: baseId });
    show(
      "tables",
      await api("GET", `${base(team)}/bases/${segment(baseId)}/tables`, {
        team,
      }),
    );
  });
  const hooks = airtable
    .command("webhooks")
    .description(
      "Suscripciones locales y remotas; nunca devuelve MAC ni credenciales",
    );
  hooks
    .command("list <teamId>")
    .addOption(new Option("--scope <scope>").choices(["mode", "shared"]))
    .option("--limit <count>")
    .option("--cursor <cursor>")
    .option("--base-id <id>")
    .addOption(
      new Option("--status <status>").choices([
        "active",
        "expired",
        "disabled",
      ]),
    )
    .action(async (team, opts) => {
      const input: any = {
        ...query({
          scope: opts.scope,
          cursor: opts.cursor,
          base_id: opts.baseId,
          status: opts.status,
        }),
        ...(opts.limit !== undefined ? { limit: Number(opts.limit) } : {}),
      };
      validate("webhooks", input);
      show(
        "webhooks",
        await api("GET", `${base(team)}/webhooks`, {
          query: query(input),
          team,
        }),
      );
    });
  hooks
    .command("remote <teamId> <baseId>")
    .description("Inventario remoto real y compartido, sin adopción de hooks")
    .action(async (team, baseId) => {
      validate("remote", { base_id: baseId });
      show(
        "remote",
        await api(
          "GET",
          `${base(team)}/bases/${segment(baseId)}/webhooks/remote`,
          { team },
        ),
      );
    });
  for (const action of ["register", "unregister", "disconnect"] as const) {
    const parent = action === "disconnect" ? airtable : hooks;
    withJsonInput(
      parent
        .command(
          `${action} <teamId>${action === "unregister" ? " <webhookId>" : ""}`,
        )
        .description(
          "UUID operation_id estable en JSON; confirma efectos. Tras timeout consulta el mismo UUID. No reintenta automáticamente.",
        ),
    )
      .option(
        "--expected-mode <mode>",
        "Afirmación live|test para credenciales sin modo declarado",
      )
      .option(
        "-y, --yes",
        "Confirmar esta operación; no sustituye reconocimientos compartidos en JSON",
      )
      .action(async (...args: any[]) => {
        const team = args[0],
          webhookId = action === "unregister" ? args[1] : undefined,
          opts = args[action === "unregister" ? 2 : 1];
        const body = await readJsonInput(opts);
        if (Object.hasOwn(body, "webhook_id"))
          throw new Error(
            "webhook_id proviene del argumento de ruta; no se admite en JSON",
          );
        if (Object.hasOwn(body, "expected_livemode"))
          throw new Error(
            "El modo se deriva de la credencial o --expected-mode; no se admite en JSON",
          );
        const input: Record<string, any> = {
          ...body,
          ...(webhookId ? { webhook_id: webhookId } : {}),
          expected_livemode: credentialMode(opts.expectedMode),
        };
        validate(action, input);
        const path =
          action === "disconnect"
            ? `${base(team)}/disconnect`
            : action === "register"
              ? `${base(team)}/webhooks`
              : `${base(team)}/webhooks/${segment(webhookId)}`;
        const shared = action === "disconnect" || input.scope === "shared";
        await requireConfirmation(
          opts.yes,
          `¿Autorizar Airtable ${action} para equipo ${team}, modo ${input.expected_livemode ? "live" : "test"}, operación ${input.operation_id}? ${shared ? "Alcance compartido: afecta suscripciones de ambos modos, incluyendo registros antiguos." : "Alcance de esta suscripción en el modo confirmado."} Airtable es el proveedor real. Se conservan credenciales OAuth. Tras incertidumbre consulta el mismo UUID; no repitas efectos automáticamente.`,
        );
        const { webhook_id: _hook, ...send } = input as Record<string, any>;
        show(
          action,
          await api(action === "unregister" ? "DELETE" : "POST", path, {
            body: send,
            team,
          }),
        );
      });
  }
  const ops = airtable
    .command("operations")
    .description(
      "Recibos seguros; processing no significa completado y outcome_unknown no autoriza reintento",
    );
  ops
    .command("get <teamId> <operationId>")
    .option("--limit <count>")
    .option("--cursor <cursor>")
    .action(async (team, operationId, opts) => {
      const input = {
        operation_id: operationId,
        ...(opts.limit !== undefined ? { limit: Number(opts.limit) } : {}),
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
      };
      validate("operation", input);
      show(
        "operation",
        await api("GET", `${base(team)}/operations/${segment(operationId)}`, {
          query: query({ limit: opts.limit, cursor: opts.cursor }),
          team,
        }),
      );
    });
  ops
    .command("reconcile <teamId> <operationId>")
    .description(
      "Lee proveedor/evidencia local sin repetir POST/DELETE remotos",
    )
    .action(async (team, operationId) => {
      validate("reconcile", { operation_id: operationId });
      show(
        "reconcile",
        await api(
          "POST",
          `${base(team)}/operations/${segment(operationId)}/reconcile`,
          { body: {}, team },
        ),
      );
    });
}
