import { registerManualWebhookCommands } from "./manual-webhooks.js";
import {
  withJsonInput,
  readJsonInput,
  segment,
  requireConfirmation,
} from "../input.js";
import { Command } from "commander";
import { api, ApiError, getApiKey } from "../api.js";
import { getTeamFromKey } from "../config.js";
import { runtimeOptions } from "../runtime.js";
import { printJson } from "../output.js";
import {
  savedWebhook,
  configurationReceipt,
  configurationInput,
  configurationSchema,
  configurationHandoff,
  configUuid,
} from "../webhook-configuration.js";
function target(opts: any) {
  const team =
    opts.team ??
    runtimeOptions().team ??
    (process.env.GIGSTACK_TEAM || undefined) ??
    getTeamFromKey(getApiKey());
  if (typeof team !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(team))
    throw new Error("Selecciona --team para el webhook");
  return team;
}
function knownRejection(error: unknown): Error | undefined {
  if (!(error instanceof ApiError)) return;
  if (error.code === "webhook_revision_conflict")
    return new Error(
      "webhook_revision_conflict: consulta GET y revisa la configuración actual antes de una nueva intención explícita.",
    );
  if (
    [
      "webhook_plan_required",
      "webhook_configuration_forbidden",
      "master_team_required",
      "original_credential_required",
      "original_credential_configuration_required",
    ].includes(error.code ?? "")
  )
    return new Error(
      `${error.code}: el servidor rechazó esta configuración; revisa la autoridad y el plan actuales. No se reintentó.`,
    );
}
function show(result: ReturnType<typeof configurationReceipt>) {
  const failed = result.operation.status !== "completed";
  if (failed) process.exitCode = 1;
  printJson({
    success: !failed,
    ...result,
    ...(failed
      ? {
          error: {
            code: "webhook_configuration_unconfirmed",
            message:
              "Consulta el mismo UUID. processing/outcome_unknown es solo lectura; no repitas ni generes otro UUID automáticamente.",
          },
        }
      : {}),
  });
}
export function registerWebhookCommands(program: Command) {
  const webhooks = program
    .command("webhooks")
    .description("Configuración compartida live/test y entregas de webhooks");
  registerManualWebhookCommands(webhooks);
  webhooks
    .command("get <id>")
    .description("Metadatos seguros y revisión actual")
    .action(async (id) => {
      const team = target({});
      const res = await api("GET", `/webhooks/${segment(id)}`, { team });
      printJson({ data: savedWebhook(res.data) });
    });
  webhooks
    .command("list")
    .option("--limit <n>", "1-100", "20")
    .option("--cursor <cursor>")
    .option("--status <status>", "active|inactive")
    .action(async (opts) => {
      const team = target(opts);
      if (
        !/^\d+$/.test(opts.limit) ||
        Number(opts.limit) < 1 ||
        Number(opts.limit) > 100 ||
        (opts.status && !["active", "inactive"].includes(opts.status))
      )
        throw new Error("Filtro inválido");
      const res = await api("GET", "/webhooks", {
        team,
        query: {
          limit: opts.limit,
          ...(opts.cursor ? { cursor: opts.cursor } : {}),
          ...(opts.status ? { status: opts.status } : {}),
        },
      });
      if (
        !Array.isArray(res.data) ||
        typeof res.has_more !== "boolean" ||
        !(res.next_cursor === null || typeof res.next_cursor === "string")
      )
        throw new Error("Página de webhooks inválida");
      printJson({
        data: res.data.map(savedWebhook),
        has_more: res.has_more,
        next_cursor: res.next_cursor,
      });
    });
  for (const action of ["create", "update"] as const) {
    const cmd = withJsonInput(
      webhooks
        .command(action === "create" ? "create" : "update <id>")
        .description(
          "Guardar configuración compartida; UUID estable, secretos solo en navegador",
        ),
    )
      .option("--operation-id <uuid>")
      .option("--expected-revision <revision>")
      .option("--yes", "Confirmar efecto compartido live/test")
      .option("--team <id>");
    if (action === "create")
      cmd
        .option("--url <url>")
        .option(
          "--events <events>",
          "Eventos separados por coma; vacío para inactivo",
        )
        .option("--status <status>")
        .option("--version <version>")
        .option("--type <type>")
        .option("--description <text>");
    cmd.action(async (...args: any[]) => {
      const endpoint = action === "update" ? args[0] : undefined,
        opts = action === "update" ? args[1] : args[0],
        team = target(opts);
      const json =
        opts.data !== undefined || opts.file !== undefined || opts.stdin;
      let body: Record<string, any> = json ? await readJsonInput(opts) : {};
      if (action === "update" && !json)
        throw new Error("Proporciona JSON con cambios");
      if (action === "create") {
        for (const field of [
          "url",
          "status",
          "version",
          "type",
          "description",
        ]) {
          if (opts[field] !== undefined) {
            if (Object.hasOwn(body, field))
              throw new Error("No dupliques campos entre flags y JSON");
            body[field] = opts[field];
          }
        }
        if (opts.events !== undefined) {
          if (Object.hasOwn(body, "events"))
            throw new Error("No dupliques eventos");
          body.events = opts.events ? opts.events.split(",") : [];
        }
      }
      for (const [flag, field] of [
        ["operationId", "operation_id"],
        ["expectedRevision", "expected_revision"],
      ])
        if (opts[flag] !== undefined) {
          if (Object.hasOwn(body, field))
            throw new Error("No dupliques el UUID/revisión");
          body[field] = opts[flag];
        }
      body = configurationInput(action, body);
      await requireConfirmation(
        opts.yes,
        `${action} webhook ${endpoint ?? body.url}, equipo ${team}, operación ${body.operation_id}; configuración compartida live/test y futuros envíos externos. ¿Continuar?`,
      );
      let res;
      try {
        res = await api(
          action === "create" ? "POST" : "PUT",
          action === "create" ? "/webhooks" : `/webhooks/${segment(endpoint)}`,
          { team, body },
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.body?.operation)
          res = e.body;
        else
          throw (
            knownRejection(e) ??
            new Error(
              `Configuración no confirmada. Conserva UUID ${body.operation_id} y equipo ${team}; consulta configuration-operation sin repetir la escritura.`,
            )
          );
      }
      show(
        configurationReceipt(res, team, body.operation_id, action, endpoint),
      );
    });
  }
  webhooks
    .command("delete <id>")
    .requiredOption("--expected-revision <revision>")
    .option("--yes")
    .option("--team <id>")
    .description(
      "Eliminar endpoint compartido; preserva secretos almacenados; ante pérdida de respuesta consulta GET",
    )
    .action(async (id, opts) => {
      const team = target(opts),
        body = configurationInput("delete", {
          expected_revision: opts.expectedRevision,
        });
      await requireConfirmation(
        opts.yes,
        `Eliminar webhook ${id}, equipo ${team}, compartido live/test. ¿Continuar?`,
      );
      let res;
      try {
        res = await api("DELETE", `/webhooks/${segment(id)}`, { team, body });
      } catch (e) {
        throw (
          knownRejection(e) ??
          new Error(
            `Eliminación no confirmada; consulta GET del webhook ${id} en equipo ${team}, sin repetir DELETE. Un 404 solo prueba ausencia actual.`,
          )
        );
      }
      if (res?.data?.deleted !== true)
        throw new Error("El API no confirmó la eliminación");
      printJson({ success: true, data: { deleted: true } });
    });
  webhooks
    .command("configuration-operation <operationId>")
    .option("--team <id>")
    .description("Recibo histórico y endpoint actual nullable; no escribe")
    .action(async (uuid, opts) => {
      if (!configUuid(uuid)) throw new Error("UUID inválido");
      const team = target(opts);
      show(
        configurationReceipt(
          await api(
            "GET",
            `/webhooks/configuration-operations/${segment(uuid)}`,
            { team },
          ),
          team,
          uuid,
        ),
      );
    });
  webhooks
    .command("configure <id>")
    .requiredOption("--intent <intent>", "headers|signing")
    .option("--team <id>")
    .description(
      "Enlace privado para revisión humana; no escribe ni abre el navegador",
    )
    .action(async (id, opts) => {
      if (!["headers", "signing"].includes(opts.intent))
        throw new Error("Intent debe ser headers|signing");
      const team = target(opts);
      printJson({
        data: configurationHandoff(
          await api("GET", `/webhooks/${segment(id)}`, {
            team,
            query: { configuration_access: "true" },
          }),
          team,
          id,
          opts.intent,
        ),
      });
    });
  webhooks
    .command("schema <action>")
    .description("JSON de configuración agente; secretos solo en navegador")
    .action((action) => printJson(configurationSchema(action)));
}
