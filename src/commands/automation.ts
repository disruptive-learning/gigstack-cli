import { Command } from "commander";
import { api } from "../api.js";
import { withJsonInput, readJsonInput, requireConfirmation, segment } from "../input.js";
import { withListOpts, buildListQuery } from "../list-opts.js";
import { printJson } from "../output.js";

// Preserve nested graphs, per-journey outcomes and pagination in both output modes.
function show(res: any) {
  if (Array.isArray(res?.data?.results) && res.data.results.some((r: any) => r.status === "failed")) {
    process.exitCode = 1;
    printJson({ ...res, success: false, error: { code: "partial_failure", message: "Algunos flujos fallaron; revisa data.results antes de repetir." } });
  } else printJson(res);
}

async function optionalBody(opts: any) {
  return opts.data !== undefined || opts.file !== undefined || opts.stdin ? readJsonInput(opts) : {};
}

function confirmed(command: Command, message: string, run: (id: string, opts: any) => Promise<any>) {
  command.option("-y, --yes", message).action(async (id, opts) => {
    segment(id);
    await requireConfirmation(opts.yes, `${message} (${id})?`);
    show(await run(id, opts));
  });
}

export function registerAutomationCommands(program: Command) {
  const journeys = program.command("journeys").description("Flujos: borradores, publicación, pruebas y ejecuciones; cambios requieren admin");
  withListOpts(journeys.command("list").description("Listar flujos del equipo y ambiente de la credencial"))
    .option("--status <status>", "draft, published, paused o archived")
    .option("--trigger-type <type>", "Clave de disparador del catálogo")
    .action(async opts => show(await api("GET", "/journeys", { query: { ...buildListQuery(opts), ...(opts.status ? { status: opts.status } : {}), ...(opts.triggerType ? { triggerType: opts.triggerType } : {}) } })));
  journeys.command("catalog").description("Catálogo completo de nodos y configuración")
    .action(async () => show(await api("GET", "/journeys/catalog")));
  journeys.command("get <id>").action(async id => show(await api("GET", `/journeys/${segment(id)}`)));
  journeys.command("runs <id>").description("Últimas 50 ejecuciones; incluye pruebas, sin cursor")
    .action(async id => show(await api("GET", `/journeys/${segment(id)}/runs`)));
  withJsonInput(journeys.command("create").description("Crear borrador: name, description, graph, triggerType, replacesDefaults"))
    .action(async opts => show(await api("POST", "/journeys", { body: await readJsonInput(opts) })));
  withJsonInput(journeys.command("update <id>").description("Editar campos del borrador; no publica cambios"))
    .action(async (id, opts) => show(await api("PUT", `/journeys/${segment(id)}`, { body: await readJsonInput(opts) })));
  confirmed(journeys.command("delete <id>").description("Eliminar flujo draft o archived"), "Confirmar eliminación del flujo", async id => api("DELETE", `/journeys/${segment(id)}`));
  for (const action of ["publish", "pause"] as const) {
    confirmed(journeys.command(`${action} <id>`), action === "publish" ? "Confirmar publicación del flujo" : "Confirmar pausa del flujo", async id => api("POST", `/journeys/${segment(id)}/${action}`, { body: {} }));
  }
  withJsonInput(journeys.command("clone <id>").description("Clonar como borrador; JSON opcional {name,targetLivemode}; conserva ambiente por defecto"))
    .action(async (id, opts) => show(await api("POST", `/journeys/${segment(id)}/clone`, { body: await optionalBody(opts) })));
  withJsonInput(journeys.command("test <id>").description("Encolar prueba: source_collection y exactamente source_id o source_snapshot"))
    .action(async (id, opts) => {
      const body = await readJsonInput(opts);
      if ((body.source_id !== undefined) === (body.source_snapshot !== undefined)) throw new Error("Indica exactamente source_id o source_snapshot");
      show(await api("POST", `/journeys/${segment(id)}/test`, { body }));
    });

  const groups = program.command("journey-groups").description("Grupos de flujos con revisiones y control de cambios simultáneos");
  withListOpts(groups.command("list")).option("--created-from <source>", "ai, manual o clone")
    .action(async opts => show(await api("GET", "/journey-groups", { query: { ...buildListQuery(opts), ...(opts.createdFrom ? { createdFrom: opts.createdFrom } : {}) } })));
  groups.command("get <id>").description("Leer grupo, flujos y last_updated para editar o revertir")
    .action(async id => show(await api("GET", `/journey-groups/${segment(id)}`)));
  withJsonInput(groups.command("create").description("Crear grupo y 1-10 flujos borradores: name, journeys:[{name,graph}]") )
    .action(async opts => show(await api("POST", "/journey-groups", { body: await readJsonInput(opts) })));
  confirmed(withJsonInput(groups.command("update <id>").description("Reemplazar lista de flujos; omitir uno lo archiva. Incluye expectedLastUpdated del GET")), "Confirmar edición y archivo de flujos omitidos", async (id, opts) => api("PUT", `/journey-groups/${segment(id)}`, { body: await readJsonInput(opts) }));
  confirmed(withJsonInput(groups.command("revert <id>").description("Restaurar revisión anterior: {expectedLastUpdated:<last_updated del GET>}; 409 si cambió")), "Confirmar restauración de la revisión", async (id, opts) => api("POST", `/journey-groups/${segment(id)}/revert`, { body: await readJsonInput(opts) }));
  withJsonInput(groups.command("clone <id>").description("Clonar grupo como borrador; JSON opcional {name,targetLivemode}"))
    .action(async (id, opts) => show(await api("POST", `/journey-groups/${segment(id)}/clone`, { body: await optionalBody(opts) })));
  for (const action of ["publish", "pause"] as const) {
    confirmed(groups.command(`${action} <id>`).description("Opera cada flujo independientemente; errores parciales salen con código 1"), action === "publish" ? "Confirmar publicación de los flujos del grupo" : "Confirmar pausa de los flujos del grupo", async id => api("POST", `/journey-groups/${segment(id)}/${action}`, { body: {} }));
  }

  const sheets = program.command("sheets").description("Importación de Google Sheets; usa el equipo y ambiente de la credencial");
  sheets.command("status").description("Conexión, estado y correo para compartir la hoja")
    .action(async () => show(await api("GET", "/sheets")));
  sheets.command("fields <target>").description("Campos para payment o invoice")
    .action(async target => {
      if (!["payment", "invoice"].includes(target)) throw new Error("target debe ser payment o invoice");
      show(await api("GET", "/sheets/fields", { query: { target } }));
    });
  sheets.command("headers").description("Actualizar encabezados almacenados y leer filas de muestra")
    .action(async () => show(await api("GET", "/sheets/headers", { sideEffect: true })));
  sheets.command("rows").description("Últimas 50 filas procesadas, sin cursor")
    .option("--status <statuses>", "error,review,imported,processing separados por coma")
    .action(async opts => show(await api("GET", "/sheets/rows", { query: opts.status ? { status: opts.status } : {} })));
  withJsonInput(sheets.command("connect").description("Conectar con usuario Firebase/MCP y acceso directo a Drive: url, sheet_name?, header_row?, copy_from_other?"))
    .option("-y, --yes", "Confirmar conexión y columnas gigstack en la hoja")
    .action(async opts => {
      const body = await readJsonInput(opts);
      await requireConfirmation(opts.yes, "¿Conectar la hoja y agregar las columnas gigstack?");
      show(await api("POST", "/sheets/connect", { body }));
    });
  withJsonInput(sheets.command("mapping").description("Guardar mapeo y pausar importación: target, fields, poll_interval_minutes (2 o 5)"))
    .action(async opts => show(await api("PUT", "/sheets/mapping", { body: await readJsonInput(opts) })));
  withJsonInput(sheets.command("preview").description("Previsualizar sin crear documentos; JSON opcional target, fields, limit"))
    .action(async opts => show(await api("POST", "/sheets/preview", { body: await optionalBody(opts) })));
  for (const action of ["enable", "pause", "sync", "disconnect"] as const) {
    sheets.command(action).description(action === "enable" || action === "sync" ? "Autorizar importación de documentos desde la hoja" : "Pausar o desconectar importación")
      .option("-y, --yes", "Confirmar cambio en importación")
      .action(async opts => {
        await requireConfirmation(opts.yes, `¿Ejecutar ${action} sobre la conexión de Google Sheets?`);
        show(await api(action === "disconnect" ? "DELETE" : "POST", action === "disconnect" ? "/sheets" : `/sheets/${action}`, { body: {} }));
      });
  }
}
