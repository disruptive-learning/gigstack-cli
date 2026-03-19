import { Command } from "commander";
import { api } from "../api.js";
import { printTable, printJson, printKeyValue, success, error, isJsonMode, formatDate } from "../output.js";

export function registerClientCommands(program: Command) {
  const clients = program.command("clients").description("Gestionar clientes");

  clients
    .command("list")
    .description("Listar clientes")
    .option("-l, --limit <n>", "Límite de resultados", "20")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const res = await api("GET", "/clients", { query: { limit: opts.limit }, team: opts.team });
        const items = res.data || [];
        if (isJsonMode()) return printJson(items);
        printTable(
          items.map((c: any) => ({
            id: c.id,
            nombre: c.legal_name || c.name || "—",
            rfc: c.tax_id || "—",
            email: c.email || "—",
          })),
        );
        if (res.has_more) console.log(`\n... ${res.total_results} total`);
      } catch (e: any) { error(e.message); }
    });

  clients
    .command("get <id>")
    .description("Ver detalle de un cliente")
    .option("--team <id>", "Team ID")
    .action(async (id, opts) => {
      try {
        const res = await api("GET", `/clients/${id}`, { team: opts.team });
        const c = res.data;
        if (isJsonMode()) return printJson(c);
        printKeyValue({
          ID: c.id,
          Nombre: c.legal_name || c.name,
          RFC: c.tax_id || "—",
          Email: c.email || "—",
          "Régimen fiscal": c.tax_system || "—",
          "Uso CFDI": c.use || "—",
          "Código postal": c.address?.zip || "—",
          Válido: c.is_valid ? "Sí" : "No",
          Creado: formatDate(c.created_at),
        });
      } catch (e: any) { error(e.message); }
    });

  clients
    .command("create")
    .description("Crear un cliente")
    .requiredOption("--name <name>", "Nombre o razón social")
    .requiredOption("--email <email>", "Email")
    .requiredOption("--rfc <rfc>", "RFC")
    .requiredOption("--tax-system <code>", "Régimen fiscal (ej: 601, 612, 626)")
    .option("--zip <zip>", "Código postal")
    .option("--use <use>", "Uso CFDI (default: G03)", "G03")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const res = await api("POST", "/clients", {
          body: {
            name: opts.name,
            legal_name: opts.name,
            email: opts.email,
            tax_id: opts.rfc,
            tax_system: opts.taxSystem,
            use: opts.use,
            address: opts.zip ? { zip: opts.zip } : undefined,
          },
          team: opts.team,
        });
        success(`Cliente creado: ${res.data.id}`);
        if (!isJsonMode()) console.log(`  RFC: ${res.data.tax_id}  Email: ${res.data.email}`);
        else printJson(res.data);
      } catch (e: any) { error(e.message); }
    });

  clients
    .command("search <query>")
    .description("Buscar clientes")
    .option("--team <id>", "Team ID")
    .action(async (query, opts) => {
      try {
        const res = await api("GET", "/clients/search", { query: { q: query }, team: opts.team });
        const items = res.data || [];
        if (isJsonMode()) return printJson(items);
        printTable(
          items.map((c: any) => ({
            id: c.id,
            nombre: c.legal_name || c.name || "—",
            rfc: c.tax_id || "—",
            email: c.email || "—",
          })),
        );
      } catch (e: any) { error(e.message); }
    });

  clients
    .command("validate <id>")
    .description("Validar datos fiscales de un cliente contra el SAT")
    .option("--team <id>", "Team ID")
    .action(async (id, opts) => {
      try {
        const res = await api("POST", `/clients/validate/${id}`, { team: opts.team });
        success("Validación completada");
        if (isJsonMode()) printJson(res.data);
        else printKeyValue(res.data);
      } catch (e: any) { error(e.message); }
    });

  clients
    .command("delete <id>")
    .description("Eliminar un cliente")
    .option("--team <id>", "Team ID")
    .action(async (id, opts) => {
      try {
        await api("DELETE", `/clients/${id}`, { team: opts.team });
        success(`Cliente ${id} eliminado`);
      } catch (e: any) { error(e.message); }
    });
}
