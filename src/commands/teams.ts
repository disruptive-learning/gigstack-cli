import { Command } from "commander";
import { api } from "../api.js";
import { printTable, printJson, printListJson, printKeyValue, success, error, isJsonMode } from "../output.js";

export function registerTeamCommands(program: Command) {
  const teams = program.command("teams").description("Gestionar equipos");

  teams
    .command("list")
    .description("Listar equipos")
    .action(async () => {
      try {
        const res = await api("GET", "/teams");
        const items = res.data || [];
        if (isJsonMode()) return printListJson(res, items);
        printTable(
          items.map((t: any) => ({
            id: t.id,
            nombre: t.legal_name || t.name || "—",
            rfc: t.tax_id || "—",
          })),
        );
      } catch (e: any) { error(e.message); }
    });

  teams
    .command("get <id>")
    .description("Ver detalle de un equipo")
    .action(async (id) => {
      try {
        const res = await api("GET", `/teams/${id}`);
        const t = res.data;
        if (isJsonMode()) return printJson(t);
        printKeyValue({
          ID: t.id,
          Nombre: t.legal_name || t.name || "—",
          RFC: t.tax_id || "—",
          "Régimen fiscal": t.tax_system || "—",
          "Código postal": t.address?.zip || "—",
        });
      } catch (e: any) { error(e.message); }
    });

  teams
    .command("integrations")
    .description("Ver integraciones del equipo")
    .action(async () => {
      try {
        const res = await api("GET", "/teams/integrations");
        if (isJsonMode()) return printJson(res.data);
        printKeyValue(res.data);
      } catch (e: any) { error(e.message); }
    });
}
