import { Command } from "commander";
import { api } from "../api.js";
import { readJsonInput, requireConfirmation, teamTarget, withJsonInput } from "../input.js";
import { printJson } from "../output.js";
import contracts from "../schemas/integration-settings.json";

type Field = { type: string | string[]; pattern?: string; maxLength?: number };
type Schema = { type: string; additionalProperties: boolean; properties: Record<string, Field> };
function providerId(value: string): string {
  if (!contracts.providers.includes(value)) throw new Error("Proveedor no reconocido; consulta integrations catalog");
  return value;
}
function validateSettings(body: Record<string, unknown>, schema: Schema) {
  for (const [key, value] of Object.entries(body)) {
    const field = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
    if (!field) throw new Error(`Campo no permitido: ${key}`);
    const types = Array.isArray(field.type) ? field.type : [field.type];
    if (!types.includes(value === null ? "null" : typeof value)) throw new Error(`Tipo inválido para ${key}`);
    if (typeof value === "string" && ((field.maxLength !== undefined && value.length > field.maxLength) || (field.pattern && !new RegExp(field.pattern).test(value)))) throw new Error(`Valor inválido para ${key}`);
  }
}
export function registerIntegrationCommands(program: Command) {
  const integrations = program.command("integrations").description("Catálogo y ajustes no secretos; estado almacenado no implica conexión remota confirmada");
  integrations.command("catalog <teamId>").description("Proveedores, disponibilidad, alcance y acciones respaldadas por el API")
    .action(async id => printJson(await api("GET", `${teamTarget(id)}/integrations/catalog`)));
  integrations.command("get <teamId> <provider>").description("Leer proyección segura del proveedor y ajustes persistidos")
    .action(async (id, provider) => printJson(await api("GET", `${teamTarget(id)}/integrations/${providerId(provider)}`)));
  for (const [provider, rawSchema] of Object.entries(contracts.settings)) {
    const schema = rawSchema as Schema;
    const command = integrations.command(provider).description(`Ajustes de ${provider}; no conecta, guarda secretos ni cambia completed`);
    command.command("schema").description("JSON Schema local de los ajustes admitidos")
      .action(() => printJson(schema));
    withJsonInput(command.command("settings <teamId>").description("Actualizar solo campos presentes; alcance compartido por toda la empresa"))
      .option("-y, --yes", "Confirmar cambio de ajustes compartidos")
      .action(async (id, opts) => {
        const path = `${teamTarget(id)}/integrations/${provider}/settings`;
        const body = await readJsonInput(opts);
        validateSettings(body, schema);
        await requireConfirmation(opts.yes, `¿Actualizar ajustes compartidos de ${provider} para ${id}?`);
        printJson(await api("PATCH", path, { body }));
      });
  }
}
