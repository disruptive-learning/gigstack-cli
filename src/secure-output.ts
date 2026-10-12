import { open, rm } from "node:fs/promises";
import { resolve } from "node:path";

/** Reserve a private, new file before issuing a one-time credential. Never overwrite or echo secrets. */
export async function saveCredential<T>(path: string, issue: () => Promise<T>): Promise<{ result: T; path: string }> {
  const target = resolve(path);
  const file = await open(target, "wx", 0o600);
  let saved = false;
  let issued = false;
  try {
    const result = await issue();
    issued = true;
    await file.writeFile(JSON.stringify(result, null, 2) + "\n", "utf8");
    saved = true;
    return { result, path: target };
  } catch (error) {
    if (issued) throw Object.assign(new Error("Credenciales emitidas, pero no se pudieron guardar. Revisa su estado antes de rotarlas nuevamente."), { code: "credential_save_failed", outcome: "issued" });
    throw error;
  } finally {
    await file.close();
    if (!saved) await rm(target, { force: true });
  }
}
