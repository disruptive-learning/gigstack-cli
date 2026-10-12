import { Command } from "commander";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { api } from "../api.js";
import { printJson } from "../output.js";
import { readJsonInput, requireConfirmation, segment, withJsonInput } from "../input.js";

const documentTypes = ["contract", "delivery_proof", "payment_proof", "communication"];
const supportTypes = [...documentTypes, "payment_confirmation", "subscription_info"];
const entityTypes = ["invoice", "payment", "receipt", "client"];
const statuses = ["pending_review", "valid", "requires_update", "expired", "rejected"];
const mime: Record<string, string> = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const MAX_FILE = 10 * 1024 * 1024;
function allowedFields(body: Record<string, any>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new Error("Campos no admitidos. El análisis IA se solicita con documents analyze, no con analyzeWithAI");
}
function uploadOptions(command: Command) {
  return command.requiredOption("--file <path>", "Archivo local PDF/PNG/JPG/JPEG/WEBP, máximo 10 MiB")
    .requiredOption("--document-type <type>", "Clasificación del documento")
    .option("--name <name>", "Nombre visible; por defecto nombre del archivo")
    .option("--description <text>", "Descripción")
    .option("-y, --yes", "Confirmar almacenamiento del archivo en el equipo/modo seleccionado");
}
async function upload(path: string, opts: any, types: string[]) {
  if (!types.includes(opts.documentType)) throw new Error(`document-type debe ser ${types.join(", ")}`);
  const contentType = mime[extname(opts.file).toLowerCase()];
  if (!contentType) throw new Error("Solo se admiten PDF, PNG, JPG, JPEG y WEBP");
  const info = await stat(opts.file);
  if (!info.isFile() || info.size < 1 || info.size > MAX_FILE) throw new Error("El archivo debe contener datos y pesar como máximo 10 MiB");
  await requireConfirmation(opts.yes, "¿Guardar este documento en el equipo y modo seleccionados? No se analizará con IA automáticamente.");
  const bytes = await readFile(opts.file);
  if (!bytes.length || bytes.length > MAX_FILE) throw new Error("El archivo cambió de tamaño; máximo 10 MiB");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), basename(opts.file));
  form.append("documentType", opts.documentType);
  if (opts.name !== undefined) form.append("name", opts.name);
  if (opts.description !== undefined) form.append("description", opts.description);
  printJson(await api("POST", path, { form }));
}
export function registerSupportDocumentCommands(group: Command, resource: "clients" | "payments" | "invoices") {
  const docs = group.command("support-documents").description("Documentos vinculados al recurso del equipo y modo seleccionados");
  docs.command("list <id>").description("Conservar todos los metadatos/enlaces privados devueltos; esta ruta no ofrece cursor")
    .action(async id => printJson(await api("GET", `/${resource}/${segment(id)}/support-documents`)));
  uploadOptions(docs.command("upload <id>").description(`Subir archivo y vincularlo; tipos: ${supportTypes.join(", ")}`))
    .action(async (id, opts) => upload(`/${resource}/${segment(id)}/support-documents`, opts, supportTypes));
}
export function registerDocumentCommands(program: Command) {
  const docs = program.command("documents").description("Documentos de cumplimiento: archivos, metadatos, vínculos y análisis explícito");
  docs.command("list").description("Página de data.data; itera data.next_cursor hasta has_more=false incluso si la página está vacía")
    .option("--limit <n>", "Filas examinadas (1-100)", "50")
    .option("--cursor <cursor>", "Cursor opaco ligado a equipo, modo y filtros")
    .option("--document-type <type>", "Tipo de documento")
    .option("--compliance-status <status>", "Estado de cumplimiento")
    .option("--entity-type <type>", "invoice, payment, receipt o client")
    .option("--entity-id <id>", "ID del recurso vinculado")
    .action(async opts => {
      if (!/^\d+$/.test(opts.limit) || Number(opts.limit) < 1 || Number(opts.limit) > 100) throw new Error("limit debe estar entre 1 y 100");
      if (opts.documentType && !supportTypes.includes(opts.documentType)) throw new Error("Tipo de documento inválido");
      if (opts.complianceStatus && !statuses.includes(opts.complianceStatus)) throw new Error("Estado de cumplimiento inválido");
      if (opts.entityType && !entityTypes.includes(opts.entityType)) throw new Error("Tipo de entidad inválido");
      if (opts.entityId) segment(opts.entityId);
      const query: Record<string, string> = { limit: opts.limit };
      for (const [field, value] of Object.entries({ cursor: opts.cursor, document_type: opts.documentType, compliance_status: opts.complianceStatus, entity_type: opts.entityType, entity_id: opts.entityId })) if (value !== undefined) query[field] = value as string;
      printJson(await api("GET", "/documents", { query }));
    });
  docs.command("get <id>").action(async id => printJson(await api("GET", `/documents/${segment(id)}`)));
  uploadOptions(docs.command("upload").description(`Subir archivo independiente; tipos: ${documentTypes.join(", ")}`))
    .action(async opts => upload("/documents", opts, documentTypes));
  withJsonInput(docs.command("create").description("Registrar archivo ya existente en Storage del equipo/modo; usa camelCase fileUrl/storagePath/fileName/documentType"))
    .option("-y, --yes", "Confirmar registro de documento")
    .action(async opts => {
      const body = await readJsonInput(opts);
      allowedFields(body, ["documentType", "name", "description", "fileUrl", "storagePath", "fileName", "fileSize", "mimeType", "linkedEntities", "validFrom", "validUntil", "tags", "metadata"]);
      if (!documentTypes.includes(body.documentType)) throw new Error("Tipo de documento inválido");
      for (const field of ["name", "fileUrl", "storagePath", "fileName"]) if (typeof body[field] !== "string" || !body[field]) throw new Error(`${field} es obligatorio`);
      if (!/^teams\/[A-Za-z0-9_-]+\/(live|test)\/support-documents\/.+/.test(body.storagePath)) throw new Error("Usa multipart upload o una ruta teams/ID/live|test/support-documents del modo seleccionado; legacy sat_documents es solo navegador");
      await requireConfirmation(opts.yes, "¿Registrar este archivo ya guardado? El servidor comprobará equipo, modo y URL del bucket autorizado.");
      printJson(await api("POST", "/documents", { body }));
    });
  withJsonInput(docs.command("update <id>").description("Actualizar nombre, descripción, cumplimiento, vigencia, tags o metadata; campos camelCase"))
    .option("-y, --yes", "Confirmar edición")
    .action(async (id, opts) => {
      const path = `/documents/${segment(id)}`, body = await readJsonInput(opts);
      allowedFields(body, ["name", "description", "complianceStatus", "complianceNotes", "validFrom", "validUntil", "tags", "metadata"]);
      if (body.complianceStatus !== undefined && body.complianceStatus !== null && !statuses.includes(body.complianceStatus)) throw new Error("Estado de cumplimiento inválido");
      await requireConfirmation(opts.yes, "¿Actualizar los metadatos de este documento?");
      printJson(await api("PATCH", path, { body }));
    });
  for (const action of ["link", "unlink"]) docs.command(`${action} <id>`)
    .requiredOption("--entity-type <type>", "invoice, payment, receipt o client")
    .requiredOption("--entity-id <id>", "ID del recurso en el mismo equipo/modo")
    .option("-y, --yes", "Confirmar cambio de vínculo")
    .action(async (id, opts) => {
      const path = `/documents/${segment(id)}/link`; segment(opts.entityId);
      if (!entityTypes.includes(opts.entityType)) throw new Error("Tipo de entidad inválido");
      await requireConfirmation(opts.yes, action === "link" ? "¿Vincular este documento al recurso?" : "¿Quitar este vínculo sin eliminar el documento?");
      printJson(await api(action === "link" ? "POST" : "DELETE", path, { body: { entityType: opts.entityType, entityId: opts.entityId } }));
    });
  docs.command("delete <id>").description("Eliminar lógicamente el documento; no afirma borrar el objeto en Storage")
    .option("-y, --yes", "Confirmar eliminación")
    .action(async (id, opts) => {
      const path = `/documents/${segment(id)}`;
      await requireConfirmation(opts.yes, "¿Eliminar lógicamente este documento?");
      printJson(await api("DELETE", path));
    });
  docs.command("analyze <id>").description("Enviar documento PDF/imagen a análisis IA y guardar extracción; acción explícita")
    .option("-y, --yes", "Confirmar análisis IA del contenido")
    .action(async (id, opts) => {
      const path = `/documents/${segment(id)}/analyze`;
      await requireConfirmation(opts.yes, "¿Analizar el contenido de este documento con IA y guardar la extracción?");
      printJson(await api("POST", path, { body: {} }));
    });
}
