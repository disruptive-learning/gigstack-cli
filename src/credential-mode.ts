import { getApiKey } from "./api.js";
import { parseJwtPayload } from "./config.js";
/** Assertion only: the API independently verifies the credential and current mode. */
export function credentialMode(expected?: string): boolean {
  const mode = parseJwtPayload(getApiKey())?.livemode;
  if (expected !== undefined && !["live", "test"].includes(expected))
    throw new Error("expected-mode debe ser live o test");
  if (typeof mode === "boolean") {
    if (expected !== undefined && (expected === "live") !== mode)
      throw new Error(
        "El modo confirmado no coincide con la credencial seleccionada",
      );
    return mode;
  }
  if (expected !== undefined) return expected === "live";
  throw new Error(
    "La credencial no declara modo. Usa --expected-mode live|test como afirmación explícita; el API verifica el contexto y nunca acepta un cambio de modo implícito.",
  );
}
