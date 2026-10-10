import { Command } from "commander";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { api } from "../api.js";
import { readJsonInput, requireConfirmation, teamTarget, withJsonInput } from "../input.js";
import { printJson } from "../output.js";
function fields(body: Record<string, any>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new Error("La solicitud contiene campos no admitidos");
}
export function registerBrandingCommands(program: Command) {
  const brand = program.command("branding").description("Marca y portal compartidos por empresa; identidad Firebase/MCP personal");
  brand.command("get <teamId>").action(async id => printJson(await api("GET", `${teamTarget(id)}/brand`)));
  withJsonInput(brand.command("update <teamId>").description("alias, primary_color, secondary_color, voice; null o cadena vacía borra, omitido conserva"))
    .option("-y, --yes", "Confirmar actualización compartida")
    .action(async (id, opts) => {
      const path = `${teamTarget(id)}/brand`, body = await readJsonInput(opts);
      fields(body, ["alias", "primary_color", "secondary_color", "voice"]);
      for (const [key, value] of Object.entries(body)) if (value !== null && (typeof value !== "string" || value.length > (key === "voice" ? 20000 : key === "alias" ? 200 : 40))) throw new Error(`Campo ${key} inválido`);
      await requireConfirmation(opts.yes, "¿Actualizar la marca compartida por todos los modos de esta empresa?");
      printJson(await api("PATCH", path, { body }));
    });
  const portal = brand.command("portal").description("Alias único; un cambio rompe los enlaces anteriores de tus clientes");
  portal.command("get <teamId>").action(async id => printJson(await api("GET", `${teamTarget(id)}/customer-portal`)));
  withJsonInput(portal.command("set <teamId>").description("slug; renombrar requiere expected_slug actual y confirm_existing_links_change:true explícito"))
    .option("-y, --yes", "Confirmar registro o cambio de enlaces")
    .action(async (id, opts) => {
      const path = `${teamTarget(id)}/customer-portal`, body = await readJsonInput(opts);
      fields(body, ["slug", "expected_slug", "confirm_existing_links_change"]);
      if (typeof body.slug !== "string" || !/^[A-Za-z0-9]{1,128}$/.test(body.slug)) throw new Error("slug debe tener 1-128 letras o dígitos");
      if (body.expected_slug !== undefined && body.expected_slug !== null && (typeof body.expected_slug !== "string" || body.expected_slug.length > 128)) throw new Error("expected_slug inválido");
      if (body.confirm_existing_links_change !== undefined && typeof body.confirm_existing_links_change !== "boolean") throw new Error("confirm_existing_links_change debe ser booleano");
      await requireConfirmation(opts.yes, "¿Registrar el alias o cambiar los enlaces existentes? Cambiar un alias exige confirmación separada en el JSON y permiso de administrador.");
      printJson(await api("PUT", path, { body }));
    });
  brand.command("analyze-voice <teamId>").description("Analizar sitio público usando el proveedor de IA; no guarda la voz automáticamente")
    .requiredOption("--url <url>", "Sitio HTTP(S) público").option("-y, --yes", "Confirmar lectura del sitio y uso del proveedor")
    .action(async (id, opts) => {
      const path = `${teamTarget(id)}/brand/analyze-voice`, url = new URL(opts.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || opts.url.length > 2048) throw new Error("URL pública HTTP(S) sin credenciales requerida");
      await requireConfirmation(opts.yes, "¿Analizar este sitio con el proveedor de IA? El resultado no modifica la voz guardada.");
      printJson(await api("POST", path, { body: { url: opts.url } }));
    });
  brand.command("upload-logo <teamId>").description("PNG/JPEG local, máximo 10MiB; afecta marca live/test; informa limpieza de archivos anteriores")
    .requiredOption("--file <path>", "Archivo PNG/JPEG local").option("-y, --yes", "Confirmar reemplazo del logo compartido")
    .action(async (id, opts) => {
      const path = `${teamTarget(id)}/brand/logo`, extension = extname(opts.file).toLowerCase();
      if (![".png", ".jpg", ".jpeg"].includes(extension)) throw new Error("El logo debe ser PNG/JPEG");
      const info = await stat(opts.file); if (!info.isFile() || info.size < 1 || info.size > 10 * 1024 * 1024) throw new Error("El logo debe ser un archivo de 1 byte a 10MiB");
      await requireConfirmation(opts.yes, "¿Reemplazar el logo de toda la empresa? Los objetos históricos pueden permanecer almacenados; consulta storage_cleanup.");
      const data = await readFile(opts.file); if (data.length > 10 * 1024 * 1024) throw new Error("El archivo cambió y supera 10MiB");
      const form = new FormData(); form.append("file", new Blob([data], { type: extension === ".png" ? "image/png" : "image/jpeg" }), basename(opts.file));
      printJson(await api("POST", path, { form }));
    });
  brand.command("remove-logo <teamId>").description("Quitar logo visible; borra solo objetos propios administrados, conserva archivos históricos")
    .option("-y, --yes", "Confirmar eliminación del logo compartido")
    .action(async (id, opts) => { const path = `${teamTarget(id)}/brand/logo`; await requireConfirmation(opts.yes, "¿Quitar el logo de toda la empresa?"); printJson(await api("DELETE", path, { body: {} })); });
}
