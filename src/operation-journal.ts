import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

export const operationId = (value: string): string => {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new Error("operation-id debe ser un UUID v4 estable para esta operación");
  return value.toLowerCase();
};
export interface OperationReference { id: string; team_id: string; journal_file: string }
interface JournalInput { id: string; teamId: string; method: string; path: string; baseUrl: string; body: unknown; billingAccountId: string; providerEnvironment: string }
const stable = (value: unknown) => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
/** Durable pre-request metadata only: never persist fiscal bodies, credentials or hosted handoff URLs. */
export async function prepareOperationJournal(filePath: string, input: JournalInput): Promise<{ existing: boolean; reference: OperationReference }> {
  const target = resolve(filePath);
  const expected = { version: 1, operation_id: input.id, team_id: input.teamId, method: input.method, path: input.path, api_base_url: input.baseUrl, billing_account_id: input.billingAccountId, provider_environment: input.providerEnvironment, request_sha256: createHash("sha256").update(stable(input.body)).digest("hex") };
  const reference = { id: input.id, team_id: input.teamId, journal_file: target };
  let file;
  try { file = await open(target, "wx", 0o600); }
  catch (error: any) {
    if (error.code !== "EEXIST") throw error;
    const existing = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await existing.stat();
      if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) !== 0) throw new Error("El diario debe ser un archivo privado 0600 válido");
      let saved: any;
      try { saved = JSON.parse(await existing.readFile("utf8")); } catch { throw new Error("El diario está incompleto; consulta el operation-id antes de crear otro"); }
      if (Object.keys(saved).length !== Object.keys(expected).length || Object.entries(expected).some(([key,value]) => saved[key] !== value)) throw new Error("El diario pertenece a otra operación, equipo, API o contenido. No se enviaron cambios");
      return { existing: true, reference };
    } finally { await existing.close(); }
  }
  try { await file.writeFile(JSON.stringify(expected, null, 2) + "\n", "utf8"); await file.sync(); }
  finally { await file.close(); }
  const directory = await open(dirname(target), "r");
  try { await directory.sync(); } finally { await directory.close(); }
  return { existing: false, reference };
}
