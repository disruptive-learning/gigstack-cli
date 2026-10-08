import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { api } from "../api.js";
import { printJson, printKeyValue, isJsonMode } from "../output.js";
import { withJsonInput, readJsonInput, requireConfirmation, segment } from "../input.js";

const base = "/invoices/download";
function show(res: any) { isJsonMode() ? printJson(res) : printKeyValue(res.data ?? res); }

export function registerSatControlCommands(sat: Command) {
  const credentials = sat.command("credentials").description("Conectar e.firma para Descarga Masiva; archivos locales y contraseña, distintos de CSD");
  credentials.command("fiel").description("Cargar e.firma .cer/.key por multipart; registro sujeto a validación SAT")
    .requiredOption("--cert-file <path>", "Certificado e.firma .cer")
    .requiredOption("--key-file <path>", "Llave privada .key")
    .requiredOption("--password-file <path>", "Contraseña en archivo local")
    .option("--phone <phone>", "Teléfono para registro, formato internacional")
    .action(async opts => {
      const [cert, key, password] = await Promise.all([readFile(opts.certFile), readFile(opts.keyFile), readFile(opts.passwordFile, "utf8")]);
      const form = new FormData();
      form.set("cert", new Blob([new Uint8Array(cert)]), "fiel.cer");
      form.set("key", new Blob([new Uint8Array(key)]), "fiel.key");
      form.set("password", password.replace(/\r?\n$/, ""));
      if (opts.phone) form.set("phone", opts.phone);
      show(await api("POST", `${base}/fiel`, { form }));
    });
  credentials.command("pfx").description("Conectar e.firma desde PFX/PKCS#12 y contraseña en archivos locales")
    .requiredOption("--pfx-file <path>", "Archivo PFX")
    .requiredOption("--password-file <path>", "Contraseña del PFX")
    .action(async opts => {
      const [pfx, password] = await Promise.all([readFile(opts.pfxFile), readFile(opts.passwordFile, "utf8")]);
      show(await api("POST", `${base}/pfx`, { body: { pfx: pfx.toString("base64"), pfx_password: password.replace(/\r?\n$/, "") } }));
    });
  withJsonInput(sat.command("register").description("Registrar RFC con e.firma guardada; contrato requiere sync_start_date y phone"))
    .action(async opts => show(await api("POST", `${base}/register`, { body: await readJsonInput(opts) })));
  withJsonInput(sat.command("request").description("Solicitar descarga SAT por fechas y filtros; puede generar cargos por XML"))
    .option("-y, --yes", "Confirmar solicitud de descarga")
    .action(async opts => {
      const body = await readJsonInput(opts);
      await requireConfirmation(opts.yes, "¿Solicitar esta descarga SAT, sujeta a cargos por XML?");
      show(await api("POST", `${base}/request`, { body }));
    });
  sat.command("request-status <requestId>").description("Consultar resultado de solicitud de descarga")
    .action(async id => show(await api("GET", `${base}/status/${segment(id)}`)));
  sat.command("package <packageId>").description("Leer paquete ZIP base64 de una solicitud completada, o guardar archivo nuevo")
    .option("--out <path>", "Guardar ZIP en archivo nuevo (no sobrescribe)")
    .action(async (id, opts) => {
      const res = await api("GET", `${base}/package/${segment(id)}`);
      if (!opts.out) return show(res);
      const content = res.data?.content;
      if (res.data?.encoding !== "base64" || typeof content !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
        throw new Error("El paquete no contiene ZIP base64 válido");
      }
      const bytes = Buffer.from(content, "base64");
      await writeFile(opts.out, bytes, { flag: "wx", mode: 0o600 });
      show({ data: { package_id: id, path: opts.out, bytes: bytes.length } });
    });
  sat.command("fetch-xml <uuid>").description("Obtener XML del SAT; este GET puede descargar y cobrar un crédito")
    .option("-y, --yes", "Confirmar posible cargo por descarga")
    .action(async (uuid, opts) => {
      const path = `${base}/invoice/${segment(uuid)}`;
      await requireConfirmation(opts.yes, "¿Obtener este XML del SAT, con posible cargo por descarga?");
      show(await api("GET", path, { sideEffect: true }));
    });

  const sync = sat.command("sync").description("Registro y sincronización SAT");
  sync.command("debug").description("Consultar diagnóstico de registro y proveedor")
    .action(async () => show(await api("GET", `${base}/debug`)));
  sync.command("progress").description("Consultar avance de sincronización histórica")
    .action(async () => show(await api("GET", `${base}/progress`)));
  sync.command("enable").description("Habilitar sincronización SAT con las credenciales guardadas")
    .option("-y, --yes", "Confirmar sincronización")
    .action(async opts => {
      await requireConfirmation(opts.yes, "¿Habilitar sincronización con el SAT?");
      show(await api("POST", `${base}/enable-sync`, { body: {} }));
    });
  sync.command("extend-to-maximum").description("Volver a registrar la ventana máxima del servidor (actualmente 71 meses)")
    .option("-y, --yes", "Confirmar extensión de ventana")
    .action(async opts => {
      await requireConfirmation(opts.yes, "¿Extender la sincronización histórica a la ventana máxima del servidor?");
      show(await api("PUT", `${base}/sync-period`, { body: {} }));
    });
  withJsonInput(sat.command("preview").description("Encolar consulta de metadatos sin descargar XML: start_date/end_date/directions"))
    .action(async opts => show(await api("POST", `${base}/preview`, { body: await readJsonInput(opts) })));
  withJsonInput(sat.command("import").description("Encolar XML seleccionados; uuids y confirm_cost_mxn explícito, sujeto a cargos"))
    .option("-y, --yes", "Confirmar costo proporcionado")
    .action(async opts => {
      const body = await readJsonInput(opts);
      if (!Array.isArray(body.uuids) || !body.uuids.length || body.uuids.length > 500 || !body.uuids.every((id: unknown) => typeof id === "string")) throw new Error("uuids debe contener entre 1 y 500 identificadores");
      if (typeof body.confirm_cost_mxn !== "number" || !Number.isFinite(body.confirm_cost_mxn) || body.confirm_cost_mxn < 0) throw new Error("Proporciona confirm_cost_mxn numérico; consulta el costo y confirma antes de importar");
      await requireConfirmation(opts.yes, `¿Importar ${body.uuids.length} XML por el costo confirmado de ${body.confirm_cost_mxn} MXN?`);
      show(await api("POST", `${base}/import`, { body }));
    });
  const jobs = sat.command("jobs").description("Trabajos de importación y sus ventanas de descarga");
  jobs.command("list").description("Consultar los 20 trabajos más recientes")
    .action(async () => show(await api("GET", `${base}/jobs`)));
  jobs.command("get <id>").action(async id => show(await api("GET", `${base}/jobs/${segment(id)}`)));
  jobs.command("cancel <id>").description("Detener un trabajo; no revierte descargas ya completadas")
    .option("-y, --yes", "Confirmar cancelación")
    .action(async (id, opts) => {
      const path = `${base}/jobs/${segment(id)}/cancel`;
      await requireConfirmation(opts.yes, `¿Detener el trabajo ${id}?`);
      show(await api("POST", path, { body: {} }));
    });
}
