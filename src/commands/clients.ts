import { Command } from "commander";
import { api } from "../api.js";
import { printTable, printJson, printKeyValue, success, error, isJsonMode, formatDate } from "../output.js";
import { ask, askRequired, select } from "../prompt.js";

const TAX_SYSTEMS = [
  { label: "601 — General de Ley (Personas Morales)", value: "601" },
  { label: "612 — Personas Físicas con Actividad Empresarial", value: "612" },
  { label: "616 — Sin obligaciones fiscales", value: "616" },
  { label: "621 — Incorporación Fiscal", value: "621" },
  { label: "625 — Régimen de actividades agrícolas", value: "625" },
  { label: "626 — RESICO", value: "626" },
];

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
    .description("Crear un cliente (interactivo si no se pasan flags)")
    .option("--name <name>", "Nombre o razón social")
    .option("--email <email>", "Email")
    .option("--rfc <rfc>", "RFC")
    .option("--tax-system <code>", "Régimen fiscal (ej: 601, 612, 626)")
    .option("--zip <zip>", "Código postal")
    .option("--use <use>", "Uso CFDI", "G03")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const interactive = !opts.name && !opts.rfc;

        const name = opts.name || (interactive ? await askRequired("Nombre / razón social") : "");
        const email = opts.email || (interactive ? await ask("Email") : "");
        const rfc = opts.rfc || (interactive ? await askRequired("RFC") : "");
        const taxSystem = opts.taxSystem || (interactive ? await select("Régimen fiscal", TAX_SYSTEMS) : "");
        const zip = opts.zip || (interactive ? await ask("Código postal") : "");

        if (!name || !rfc) { error("Nombre y RFC son requeridos"); process.exit(1); }

        const res = await api("POST", "/clients", {
          body: {
            name,
            legal_name: name,
            email: email || undefined,
            tax_id: rfc,
            tax_system: taxSystem || undefined,
            use: opts.use,
            address: zip ? { zip } : undefined,
          },
          team: opts.team,
        });
        success(`Cliente creado: ${res.data.id}`);
        if (!isJsonMode()) console.log(`  RFC: ${res.data.tax_id}  Email: ${res.data.email || "—"}`);
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
