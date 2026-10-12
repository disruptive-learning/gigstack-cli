import { getActiveProfile } from "./config.js";

/** Invocation context shared by every API call, including diagnostic helpers. */
export interface RuntimeOptions { team?: string; baseUrl?: string }
let options: RuntimeOptions = {};
export function configureRuntime(next: RuntimeOptions) { options = { ...next }; }
export function runtimeOptions(): RuntimeOptions { return { ...options }; }

export function apiBaseUrl(): string {
  const value = options.baseUrl ?? process.env.GIGSTACK_API_BASE_URL ?? getActiveProfile()?.baseUrl ?? "https://api.gigstack.io/v2";
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("GIGSTACK_API_BASE_URL/--base-url debe ser una URL absoluta"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.search || url.hash) {
    throw new Error("La URL del API debe usar HTTPS (HTTP solo en localhost), sin credenciales, query ni fragmento");
  }
  return url.toString().replace(/\/+$/, "");
}
