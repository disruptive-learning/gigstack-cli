import { writeFileSync } from "node:fs";
import {
  safeHistoricalDocument,
  safeHistoricalFile,
} from "../payment-link-history.js";
import { runtimeOptions } from "../runtime.js";
import { getTeamFromKey } from "../config.js";
import { Command } from "commander";
import { api, ApiError, getApiKey } from "../api.js";
import { credentialMode } from "../credential-mode.js";
import { printJson } from "../output.js";
import {
  readJsonInput,
  requireConfirmation,
  segment,
  withJsonInput,
} from "../input.js";
import {
  linkInput,
  linkId,
  linkReceipt,
  safeLink,
  linkSchema,
} from "../payment-links.js";
const target = () => {
  const t =
    runtimeOptions().team ??
    process.env.GIGSTACK_TEAM ??
    getTeamFromKey(getApiKey());
  if (typeof t !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(t))
    throw new Error("Selecciona --team para el enlace");
  return t;
};
const path = (id: string) => {
  if (!linkId(id)) throw new Error("ID de enlace inválido");
  return `/payments/links/${segment(id)}`;
};
export function registerPaymentLinkCommands(program: Command) {
  const links = program
    .command("payment-links")
    .description(
      "Enlaces reutilizables por equipo/modo; edición de usos futuros, sin cobro inmediato",
    );
  links
    .command("schema <action>")
    .description(
      "JSON create/update/delete; expected_livemode se deriva de la credencial, nunca del JSON",
    )
    .action((action) => printJson(linkSchema(action)));
  links
    .command("list")
    .option("--limit <n>", "1-100", "25")
    .option("--cursor <cursor>")
    .option("--from <epoch>")
    .option("--to <epoch>")
    .option("--status <status>", "active|deleted")
    .option("--expected-mode <mode>", "live|test")
    .action(async (opts) => {
      const team = target(),
        mode = credentialMode(opts.expectedMode);
      const query: Record<string, string> = { limit: opts.limit };
      if (!/^\d+$/.test(opts.limit) || +opts.limit < 1 || +opts.limit > 100)
        throw new Error("limit inválido");
      for (const k of ["from", "to"])
        if (opts[k] !== undefined) {
          if (!/^\d+$/.test(opts[k]) || !Number.isSafeInteger(+opts[k]))
            throw new Error("Fecha inválida");
          query[k] = opts[k];
        }
      if (opts.status) {
        if (!["active", "deleted"].includes(opts.status))
          throw new Error("Estado inválido");
        query.status = opts.status;
      }
      if (opts.cursor) query.cursor = opts.cursor;
      const r = await api("GET", "/payments/links", { team, query });
      if (
        !Array.isArray(r.data) ||
        r.livemode !== mode ||
        typeof r.has_more !== "boolean" ||
        !(r.next_cursor === null || typeof r.next_cursor === "string") ||
        (r.has_more && !r.next_cursor)
      )
        throw new Error("Página de enlaces inválida");
      printJson({
        data: r.data.map((d: any) => safeLink(d, team, mode)),
        has_more: r.has_more,
        next_cursor: r.next_cursor,
        livemode: mode,
      });
    });
  links
    .command("get <id>")
    .option("--expected-mode <mode>", "live|test")
    .action(async (id, opts) => {
      const team = target(),
        mode = credentialMode(opts.expectedMode);
      const r = await api("GET", path(id), { team });
      printJson({ data: safeLink(r.data, team, mode, id) });
    });
  links
    .command("history <id> <resourceType> <resourceId>")
    .description(
      "Read one current authorized invoice/receipt saved on a payment link; nested IDs remain hints",
    )
    .option("--expected-mode <mode>", "live|test")
    .action(async (id, kind, resourceId, opts) => {
      if (
        !["invoices", "receipts"].includes(kind) ||
        !/^[A-Za-z0-9_-]{1,160}$/.test(resourceId)
      )
        throw new Error("Historical resource identifier invalid");
      const team = target(),
        mode = credentialMode(opts.expectedMode);
      const r = await api(
        "GET",
        `${path(id)}/history/${segment(kind)}/${segment(resourceId)}`,
        { team },
      );
      printJson({
        data: safeHistoricalDocument(r.data, team, mode, kind, resourceId),
      });
    });
  links
    .command("history-file <id> <resourceType> <resourceId> <fileType>")
    .description(
      "Download an existing authorized historical PDF/XML; never generates files or mints tokens",
    )
    .requiredOption(
      "--output <path>",
      "Destination artifact path (existing files are preserved)",
    )
    .option("--expected-mode <mode>", "live|test")
    .action(async (id, kind, resourceId, fileType, opts) => {
      if (
        !["invoices", "receipts"].includes(kind) ||
        !["pdf", "xml"].includes(fileType) ||
        !/^[A-Za-z0-9_-]{1,160}$/.test(resourceId)
      )
        throw new Error("Historical file identifier invalid");
      const team = target(),
        mode = credentialMode(opts.expectedMode);
      const response = await api(
        "GET",
        `${path(id)}/history/${segment(kind)}/${segment(resourceId)}/files/${segment(fileType)}`,
        { team },
      );
      const result = safeHistoricalFile(
        response.data,
        team,
        mode,
        kind,
        resourceId,
        fileType as "pdf" | "xml",
      );
      if (!result.file)
        throw new Error(
          "Historical file unavailable; no generation or retry occurred",
        );
      const bytes = Buffer.from(result.file.content, "base64");
      writeFileSync(opts.output, bytes, { flag: "wx" });
      const { content: _content, ...metadata } = result.file;
      printJson({
        resource_type: kind,
        resource_id: resourceId,
        team_id: team,
        livemode: mode,
        storage_project_id: result.storage_project_id,
        available: true,
        file: { ...metadata, output: opts.output },
      });
    });
  links
    .command("operation <uuid>")
    .description(
      "Leer resultado del UUID original; nunca reintenta la escritura",
    )
    .option("--expected-mode <mode>", "live|test")
    .action(async (id, opts) => {
      const team = target(),
        mode = credentialMode(opts.expectedMode);
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          id,
        )
      )
        throw new Error("UUID inválido");
      printJson({
        success: true,
        ...linkReceipt(
          await api("GET", `/payments/links/operations/${segment(id)}`, {
            team,
          }),
          team,
          mode,
          id,
        ),
      });
    });
  for (const action of ["create", "update", "delete"] as const) {
    withJsonInput(
      links
        .command(action === "create" ? "create" : `${action} <id>`)
        .description(
          action === "delete"
            ? "Eliminar enlace activo incluso usado; conserva pagos generados"
            : "Guardar configuración completa; conserva UUID ante resultado incierto",
        ),
    )
      .option("--operation-id <uuid>")
      .option("--expected-revision <revision>")
      .option("--expected-mode <mode>", "live|test")
      .option("--yes", "Confirmar equipo/modo/efecto exactos")
      .action(async (...args: any[]) => {
        const id = action === "create" ? undefined : args[0],
          opts = action === "create" ? args[0] : args[1],
          team = target(),
          mode = credentialMode(opts.expectedMode);
        const body: Record<string, any> =
          opts.data !== undefined || opts.file !== undefined || opts.stdin
            ? await readJsonInput(opts)
            : {};
        if (Object.hasOwn(body, "expected_livemode"))
          throw new Error(
            "expected_livemode se deriva de la credencial; no se permite en JSON",
          );
        for (const [k, v] of [
          ["operation_id", opts.operationId],
          ["expected_revision", opts.expectedRevision],
        ])
          if (v !== undefined) {
            if (body[k] !== undefined && body[k] !== v)
              throw new Error("Body/flag no coinciden");
            body[k] = v;
          }
        linkInput(action, { ...body, expected_livemode: mode });
        await requireConfirmation(
          opts.yes,
          `Enlace ${action} de equipo ${team}, modo ${mode ? "live" : "test"}${id ? `, ${id}` : ""}, operación ${body.operation_id}. Cambia usos futuros; no cobra ahora. Eliminar conserva pagos generados. ¿Continuar?`,
        );
        let r: any;
        try {
          r = await api(
            action === "create"
              ? "POST"
              : action === "update"
                ? "PATCH"
                : "DELETE",
            id ? path(id) : "/payments/links",
            { team, body: { ...body, expected_livemode: mode } },
          );
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.status >= 400 &&
            error.status < 500
          )
            throw error;
          throw new Error(
            "Resultado desconocido (outcome_unknown). Consulta payment-links operation con el mismo UUID/equipo/modo; no repitas ni generes otro UUID automáticamente.",
          );
        }
        printJson({
          success: true,
          ...linkReceipt(r, team, mode, body.operation_id, action, id),
        });
      });
  }
}
