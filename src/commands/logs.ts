import { writeFile } from "node:fs/promises";
import {
  deliveryEvents,
  deliveryStatuses,
  logProjection,
} from "../log-projection.js";
import { Command, Option } from "commander";
import { api } from "../api.js";
import { segment, teamTarget } from "../input.js";
import { printJson } from "../output.js";
export function registerLogCommands(program: Command) {
  const logs = program
    .command("logs")
    .description(
      "Observabilidad por equipo/modo; detalle API con valores fiscales permitidos y redacción explícita",
    );
  for (const [name, endpoint] of [
    ["api", "api-logs"],
    ["webhooks", "webhook-deliveries"],
  ]) {
    const group = logs
      .command(name)
      .description(
        name === "api"
          ? "Solicitudes API conservadas"
          : "Entregas de webhook; pendiente no significa entregado",
      );
    const list = group
      .command("list <teamId>")
      .description(
        "Página acotada; sigue next_cursor incluso si data está vacío y has_more=true",
      )
      .option("--limit <n>", "Registros examinados (1-100)", "50")
      .option(
        "--cursor <cursor>",
        "next_cursor con el mismo equipo, modo y filtros",
      )
      .option("--from <milliseconds>", "Timestamp inicial inclusivo")
      .option("--to <milliseconds>", "Timestamp final inclusivo")
      .addOption(
        new Option("--status <status>", "Filtro de resultado").choices(
          name === "api" ? ["2xx", "3xx", "4xx", "5xx"] : deliveryStatuses,
        ),
      );
    if (name === "api")
      list
        .addOption(
          new Option("--method <method>", "Método HTTP").choices([
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "OPTIONS",
            "HEAD",
          ]),
        )
        .option(
          "--endpoint <prefix>",
          "Prefijo de ruta redactada (segmentos variables = :id)",
        );
    else list.option("--event <event>", "Evento, ejemplo invoice.created");
    list.action(async (team, opts) => {
      const path = `${teamTarget(team)}/${endpoint}`;
      const limit = Number(opts.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new Error("--limit debe ser 1-100");
      for (const key of ["from", "to"])
        if (
          opts[key] !== undefined &&
          (!Number.isSafeInteger(Number(opts[key])) || Number(opts[key]) < 0)
        )
          throw new Error(`--${key} debe ser epoch milisegundos`);
      if (
        opts.from !== undefined &&
        opts.to !== undefined &&
        Number(opts.from) > Number(opts.to)
      )
        throw new Error("Rango de fechas inválido");
      if (opts.event !== undefined && !deliveryEvents.includes(opts.event))
        throw new Error("Evento inválido");
      if (
        opts.endpoint !== undefined &&
        !/^\/[A-Za-z0-9_/:.-]{0,255}$/.test(opts.endpoint)
      )
        throw new Error("Prefijo de ruta inválido");
      const query = Object.fromEntries(
        [
          "limit",
          "cursor",
          "from",
          "to",
          "status",
          "method",
          "endpoint",
          "event",
        ]
          .filter((key) => opts[key] !== undefined)
          .map((key) => [key, String(opts[key])]),
      );
      const page = logProjection(await api("GET", path, { query }), name);
      if (name === "api" && page.data.some((row: any) => row.team_id !== team))
        throw new Error("Equipo del log cambió");
      printJson(page);
    });
    const detail = group
      .command("get <teamId> <logId>")
      .description(
        "Detalle redactado; API conserva valores fiscales permitidos, sin headers ni URLs privados",
      );
    if (name === "api")
      detail.option(
        "--output <path>",
        "Guardar el detalle redactado JSON sin sobrescribir archivos",
      );
    detail.action(async (team, id, opts) => {
      const result = logProjection(
        await api("GET", `${teamTarget(team)}/${endpoint}/${segment(id)}`),
        name,
        true,
      );
      if (name === "api" && result.data.team_id !== team)
        throw new Error("Equipo del log cambió");
      if (opts.output) {
        await writeFile(opts.output, JSON.stringify(result, null, 2) + "\n", {
          flag: "wx",
        });
        printJson({
          success: true,
          output: opts.output,
          log_id: result.data.id,
          redaction: result.data.payload_redaction ?? result.data.redaction,
        });
      } else printJson(result);
    });
  }
}
