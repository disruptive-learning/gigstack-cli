import { getActiveProfile } from "./config.js";
import pc from "picocolors";

const BASE_URL = "https://api.gigstack.io/v2";

export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.message || `API error ${status}`);
  }
}

export async function api(
  method: string,
  path: string,
  opts?: { body?: any; query?: Record<string, string>; apiKey?: string; team?: string }
) {
  const profile = opts?.apiKey ? { apiKey: opts.apiKey } : getActiveProfile();
  if (!profile) {
    console.error(pc.red("No autenticado. Ejecuta: gigstack login"));
    process.exit(1);
  }

  const url = new URL(`${BASE_URL}${path}`);
  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  if (opts?.team) url.searchParams.set("team", opts.team);

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${profile.apiKey}`,
      "Content-Type": "application/json",
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }

  return data;
}
