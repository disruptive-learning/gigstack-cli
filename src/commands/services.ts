import { Command } from "commander";
import pc from "picocolors";
import { api } from "../api.js";
import { printTable, printJson, printKeyValue, success, error, isJsonMode, formatMoney, spin } from "../output.js";
import { ask } from "../prompt.js";
import { withListOpts, buildListQuery, printPaginationHint } from "../list-opts.js";

export function registerServiceCommands(program: Command) {
  const services = program.command("services").description("Gestionar productos y servicios");

  withListOpts(
    services
      .command("list")
      .description("Listar servicios")
  )
    .action(async (opts) => {
      try {
        const query = buildListQuery(opts);
        const res = await spin("Cargando servicios…", () => api("GET", "/services", { query, team: opts.team }));
        const items = res.data || [];
        if (isJsonMode()) return printJson(items);
        printTable(
          items.map((s: any) => ({
            id: s.id ? s.id.slice(0, 12) + "…" : "—",
            descripcion: (s.description || "—").slice(0, 35),
            precio: formatMoney(s.unit_price, "MXN"),
            clave_prod: s.product_key || "—",
            clave_unit: s.unit_key || "—",
          })),
        );
        printPaginationHint(res);
      } catch (e: any) { error(e.message); }
    });

  services
    .command("get <id>")
    .description("Ver detalle de un servicio")
    .option("--team <id>", "Team ID")
    .action(async (id, opts) => {
      try {
        const res = await api("GET", `/services/${id}`, { team: opts.team });
        const s = res.data;
        if (isJsonMode()) return printJson(s);
        printKeyValue({
          ID: s.id,
          Descripción: s.description,
          SKU: s.sku || "—",
          "Precio unitario": formatMoney(s.unit_price, "MXN"),
          "Clave producto": s.product_key,
          "Clave unidad": s.unit_key,
          "Nombre unidad": s.unit_name || "—",
          Impuestos: (s.taxes || []).map((t: any) => `${t.type} ${(t.rate * 100).toFixed(0)}%${t.withholding ? " (ret)" : ""}`).join(", ") || "—",
        });
      } catch (e: any) { error(e.message); }
    });

  services
    .command("create")
    .description("Crear un servicio")
    .requiredOption("--description <desc>", "Descripción del servicio")
    .requiredOption("--price <price>", "Precio unitario")
    .requiredOption("--product-key <key>", "Clave SAT del producto (ej: 84111506)")
    .requiredOption("--unit-key <key>", "Clave SAT de unidad (ej: E48, H87)")
    .option("--sku <sku>", "SKU interno")
    .option("--unit-name <name>", "Nombre de unidad")
    .option("--iva", "Agregar IVA 16%")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const taxes = opts.iva ? [{ type: "IVA", rate: 0.16, factor: "Tasa", withholding: false }] : [];
        const res = await spin("Creando servicio…", () => api("POST", "/services", {
          body: {
            description: opts.description,
            unit_price: parseFloat(opts.price),
            product_key: opts.productKey,
            unit_key: opts.unitKey,
            unit_name: opts.unitName,
            sku: opts.sku,
            taxes,
          },
          team: opts.team,
        }));
        success(`Servicio creado: ${res.data.id}`);
        if (isJsonMode()) printJson(res.data);
      } catch (e: any) { error(e.message); }
    });

  services
    .command("update <id>")
    .description("Actualizar un servicio")
    .option("--description <desc>", "Descripción")
    .option("--price <price>", "Precio unitario")
    .option("--product-key <key>", "Clave SAT del producto")
    .option("--unit-key <key>", "Clave SAT de unidad")
    .option("--sku <sku>", "SKU interno")
    .option("--team <id>", "Team ID")
    .action(async (id, opts) => {
      try {
        const hasFlags = opts.description || opts.price || opts.productKey || opts.unitKey || opts.sku;
        let body: any = {};

        if (hasFlags) {
          if (opts.description) body.description = opts.description;
          if (opts.price) body.unit_price = parseFloat(opts.price);
          if (opts.productKey) body.product_key = opts.productKey;
          if (opts.unitKey) body.unit_key = opts.unitKey;
          if (opts.sku) body.sku = opts.sku;
        } else {
          const current = await spin("Cargando servicio…", () => api("GET", `/services/${id}`, { team: opts.team }));
          const s = current.data;
          console.log(pc.dim(`Editando: ${s.description}\n`));
          console.log(pc.dim("Deja vacío para mantener el valor actual.\n"));

          const description = await ask("Descripción", s.description || "");
          const price = await ask("Precio unitario", String(s.unit_price || ""));
          const productKey = await ask("Clave producto SAT", s.product_key || "");
          const unitKey = await ask("Clave unidad SAT", s.unit_key || "");
          const sku = await ask("SKU", s.sku || "");

          if (description && description !== s.description) body.description = description;
          if (price && parseFloat(price) !== s.unit_price) body.unit_price = parseFloat(price);
          if (productKey && productKey !== s.product_key) body.product_key = productKey;
          if (unitKey && unitKey !== s.unit_key) body.unit_key = unitKey;
          if (sku && sku !== s.sku) body.sku = sku;
        }

        if (Object.keys(body).length === 0) { console.log(pc.dim("Sin cambios")); return; }

        const res = await spin("Actualizando servicio…", () => api("PUT", `/services/${id}`, { body, team: opts.team }));
        success(`Servicio ${id} actualizado`);
        if (isJsonMode()) printJson(res.data);
      } catch (e: any) { error(e.message); }
    });

  services
    .command("delete <id>")
    .description("Eliminar un servicio")
    .option("--team <id>", "Team ID")
    .action(async (id, opts) => {
      try {
        await api("DELETE", `/services/${id}`, { team: opts.team });
        success(`Servicio ${id} eliminado`);
      } catch (e: any) { error(e.message); }
    });
}
