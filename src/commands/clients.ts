import { Command } from "commander";
import pc from "picocolors";
import { api } from "../api.js";
import { printTable, printJson, printKeyValue, success, error, isJsonMode, formatDate, spin } from "../output.js";
import { ask, askRequired, select } from "../prompt.js";
import { withListOpts, buildListQuery, printPaginationHint } from "../list-opts.js";

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

  withListOpts(
    clients
      .command("list")
      .description("Listar clientes")
  )
    .action(async (opts) => {
      try {
        const query = buildListQuery(opts);
        const res = await spin("Cargando clientes…", () => api("GET", "/clients", { query, team: opts.team }));
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
        printPaginationHint(res);
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

        const res = await spin("Creando cliente…", () => api("POST", "/clients", {
          body: {
            name, legal_name: name,
            email: email || undefined,
            tax_id: rfc,
            tax_system: taxSystem || undefined,
            use: opts.use,
            address: zip ? { zip } : undefined,
          },
          team: opts.team,
        }));
        success(`Cliente creado: ${res.data.id}`);
        if (!isJsonMode()) console.log(`  RFC: ${res.data.tax_id}  Email: ${res.data.email || "—"}`);
        else printJson(res.data);
      } catch (e: any) { error(e.message); }
    });

  clients
    .command("update <id>")
    .description("Actualizar un cliente")
    .option("--name <name>", "Nombre o razón social")
    .option("--email <email>", "Email")
    .option("--rfc <rfc>", "RFC")
    .option("--tax-system <code>", "Régimen fiscal")
    .option("--zip <zip>", "Código postal")
    .option("--use <use>", "Uso CFDI")
    .option("--team <id>", "Team ID")
    .action(async (id, opts) => {
      try {
        const hasFlags = opts.name || opts.email || opts.rfc || opts.taxSystem || opts.zip || opts.use;
        let body: any = {};

        if (hasFlags) {
          if (opts.name) { body.name = opts.name; body.legal_name = opts.name; }
          if (opts.email) body.email = opts.email;
          if (opts.rfc) body.tax_id = opts.rfc;
          if (opts.taxSystem) body.tax_system = opts.taxSystem;
          if (opts.zip) body.address = { zip: opts.zip };
          if (opts.use) body.use = opts.use;
        } else {
          const current = await spin("Cargando cliente…", () => api("GET", `/clients/${id}`, { team: opts.team }));
          const c = current.data;
          console.log(pc.dim(`Editando: ${c.legal_name || c.name} (${c.tax_id || "sin RFC"})\n`));
          console.log(pc.dim("Deja vacío para mantener el valor actual.\n"));

          const name = await ask("Nombre", c.legal_name || c.name || "");
          const email = await ask("Email", c.email || "");
          const rfc = await ask("RFC", c.tax_id || "");
          const taxSystem = await ask("Régimen fiscal", c.tax_system || "");
          const zip = await ask("Código postal", c.address?.zip || "");

          if (name && name !== (c.legal_name || c.name)) { body.name = name; body.legal_name = name; }
          if (email && email !== c.email) body.email = email;
          if (rfc && rfc !== c.tax_id) body.tax_id = rfc;
          if (taxSystem && taxSystem !== c.tax_system) body.tax_system = taxSystem;
          if (zip && zip !== c.address?.zip) body.address = { zip };
        }

        if (Object.keys(body).length === 0) { console.log(pc.dim("Sin cambios")); return; }

        const res = await spin("Actualizando cliente…", () => api("PUT", `/clients/${id}`, { body, team: opts.team }));
        success(`Cliente ${id} actualizado`);
        if (isJsonMode()) printJson(res.data);
      } catch (e: any) { error(e.message); }
    });

  clients
    .command("search <query>")
    .description("Buscar clientes")
    .option("--team <id>", "Team ID")
    .action(async (query, opts) => {
      try {
        const res = await spin("Buscando clientes…", () => api("GET", "/clients/search", { query: { q: query }, team: opts.team }));
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
        const res = await spin("Validando contra el SAT…", () => api("POST", `/clients/validate/${id}`, { team: opts.team }));
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
