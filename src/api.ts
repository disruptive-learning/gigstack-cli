import { getActiveProfile, getTeamFromKey } from "./config.js";
import { apiBaseUrl, runtimeOptions } from "./runtime.js";


export class ApiError extends Error {
  readonly code?: string;
  constructor(public status: number, public body: any) {
    const errObj = body?.error;
    const msg = errObj?.message || (typeof errObj === "string" ? errObj : undefined) || body?.message || `API error ${status}`;
    const details = errObj?.details;
    const detailStr = details
      ? (Array.isArray(details) ? details.join(", ") : String(details))
      : "";
    super(detailStr ? `${msg}: ${detailStr}` : msg);
    this.code = typeof errObj?.code === "string" ? errObj.code : typeof errObj === "string" && /^[a-z][a-z0-9_]+$/.test(errObj) ? errObj : undefined;
  }
}

export function getApiKey(override?: string): string {
  if (override) return override;
  const profile = getActiveProfile();
  if (!profile) {
    throw new Error("No autenticado. Ejecuta: gigstack login");
  }
  return profile.apiKey;
}

export async function api(
  method: string,
  path: string,
  opts?: { body?: any; form?: FormData; sideEffect?: boolean; idempotencyKey?: string; query?: Record<string, string>; apiKey?: string; team?: string }
) {
  const apiKey = getApiKey(opts?.apiKey);
  if (opts?.idempotencyKey !== undefined && !/^[A-Za-z0-9._:-]{8,128}$/.test(opts.idempotencyKey)) throw new Error("Idempotency key must be 8–128 letters, digits or ._:-");

  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Ruta de API inválida");
  const url = new URL(`${apiBaseUrl()}${path}`);
  const team = opts?.team ?? runtimeOptions().team ?? process.env.GIGSTACK_TEAM;
  const suppliedTeams = [team, opts?.query?.team, opts?.body?.team].filter(Boolean);
  if (new Set(suppliedTeams).size > 1) throw new Error("El equipo del body/query no coincide con --team");
  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  if (team) url.searchParams.set("team", team);
  const timeout = Number(process.env.GIGSTACK_API_TIMEOUT_MS ?? 30000);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 300000) throw new Error("GIGSTACK_API_TIMEOUT_MS debe estar entre 1 y 300000");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
        ...(opts?.form ? {} : { "Content-Type": "application/json" }),
      },
      body: opts?.form ?? (opts?.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch (e: any) {
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      const write = opts?.sideEffect || !["GET", "HEAD"].includes(method.toUpperCase());
      throw Object.assign(new Error(write
        ? "Tiempo de espera agotado; el resultado de la operación es desconocido. Consulta el estado antes de repetirla."
        : "Tiempo de espera agotado al consultar el API."), { code: "request_timeout", outcome: write ? "unknown" : "not_received" });
    }
    if (e.code === "ENOTFOUND" || e.cause?.code === "ENOTFOUND") {
      throw new Error("Sin conexión a internet. Verifica tu red.");
    }
    throw new Error(`Error de conexión: ${e.message}`);
  }

  let text: string;
  try { text = await res.text(); }
  catch {
    throw Object.assign(new Error("No se recibió la respuesta completa. Consulta el estado antes de repetir una operación."), { code: "incomplete_response", outcome: !opts?.sideEffect && ["GET", "HEAD"].includes(method.toUpperCase()) ? "not_received" : "unknown" });
  }
  let data: any;
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new ApiError(res.status, { error: { code: "invalid_response", message: "El API devolvió una respuesta no JSON" } }); }

  if (!res.ok || data?.success === false) {
    throw new ApiError(res.status, data);
  }

  return data;
}

/**
 * Resolves the primary team for the current API key.
 * First checks if the JWT contains a team ID and tries GET /teams/{id}.
 * A supplied --team is authoritative. An ambiguous team list requires selection.
 */
export async function resolveTeam(apiKey?: string): Promise<any> {
  const key = apiKey || getApiKey();
  const explicitTeam = runtimeOptions().team ?? process.env.GIGSTACK_TEAM;
  if (explicitTeam) {
    const res = await api("GET", `/teams/${encodeURIComponent(explicitTeam)}`, { apiKey: key, team: explicitTeam });
    return res.data ?? null;
  }
  const jwtTeamId = getTeamFromKey(key);

  // Try direct fetch if JWT has a team
  if (jwtTeamId) {
    try {
      const res = await api("GET", `/teams/${encodeURIComponent(jwtTeamId)}`, { apiKey: key });
      if (res.data) return res.data;
    } catch (e) { if (!(e instanceof ApiError) || e.status !== 404) throw e; }
  }

  // Fallback to list
  const res = await api("GET", "/teams", { apiKey: key });
  const teams = res.data || [];
  if (jwtTeamId) {
    const match = teams.find((t: any) => t.id === jwtTeamId);
    if (match) return match;
  }
  if (teams.length > 1) throw new Error("Hay varios equipos disponibles. Selecciona uno con --team <id>.");
  return teams[0] || null;
}
