import { getActiveProfile, getTeamFromKey } from "./config.js";
import pc from "picocolors";

const BASE_URL = "https://api.gigstack.io/v2";

export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    const detail = body?.error?.message || body?.error || "";
    const msg = body?.message || `API error ${status}`;
    super(detail ? `${msg}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : msg);
  }
}

export function getApiKey(override?: string): string {
  if (override) return override;
  const profile = getActiveProfile();
  if (!profile) {
    console.error(pc.red("No autenticado. Ejecuta: gigstack login"));
    process.exit(1);
  }
  return profile.apiKey;
}

export async function api(
  method: string,
  path: string,
  opts?: { body?: any; query?: Record<string, string>; apiKey?: string; team?: string }
) {
  const apiKey = getApiKey(opts?.apiKey);

  const url = new URL(`${BASE_URL}${path}`);
  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  if (opts?.team) url.searchParams.set("team", opts.team);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e: any) {
    if (e.code === "ENOTFOUND" || e.cause?.code === "ENOTFOUND") {
      throw new Error("Sin conexión a internet. Verifica tu red.");
    }
    throw new Error(`Error de conexión: ${e.message}`);
  }

  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }

  return data;
}

/**
 * Resolves the primary team for the current API key.
 * First checks if the JWT contains a team ID and tries GET /teams/{id}.
 * Falls back to the first team in GET /teams.
 */
export async function resolveTeam(apiKey?: string): Promise<any> {
  const key = apiKey || getApiKey();
  const jwtTeamId = getTeamFromKey(key);

  // Try direct fetch if JWT has a team
  if (jwtTeamId) {
    try {
      const res = await api("GET", `/teams/${jwtTeamId}`, { apiKey: key });
      if (res.data) return res.data;
    } catch {}
  }

  // Fallback to list
  const res = await api("GET", "/teams", { apiKey: key });
  const teams = res.data || [];
  if (jwtTeamId) {
    const match = teams.find((t: any) => t.id === jwtTeamId);
    if (match) return match;
  }
  return teams[0] || null;
}
