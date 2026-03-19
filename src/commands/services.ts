import { Command } from "commander";
import { api } from "../api.js";
import { printTable, printJson, printKeyValue, success, error, isJsonMode, formatMoney } from "../output.js";

export function registerServiceCommands(program: Command) {
  const services = program.command("services").description("Gestionar productos y servicios");

  services
    .command("list")
    .description("Listar servicios")
    .option("-l, --limit <n>", "Límite", "20")
    .option("--team <id>", "Team ID")
    .action(async (opts) => {
      try {
        const res = await api("GET", "/services", { query: { limit: opts.limit }, team: opts.team });
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
        const res = await api("POST", "/services", {
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
        });
        success(`Servicio creado: ${res.data.id}`);
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
