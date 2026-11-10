import { apiBaseUrl } from "./runtime.js";

declare const __PKG_VERSION__: string;

/** `agent.client` sent to POST /v2/auth/sandbox; the API accepts 1-64 chars of [A-Za-z0-9 ._:/@+-]. */
export const AGENT_CLIENT = `gigstack-cli/${typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "dev"}`;

export const PRICING_PAGE_URL = "https://gigstack.pro/precios";

/**
 * Web app origin for links. Follows GIGSTACK_APP_ORIGIN (the variable the webhook and portal
 * commands already use for non-production APIs); production otherwise.
 */
export function appUrl(path = ""): string {
  let origin = "https://app.gigstack.pro";
  const configured = process.env.GIGSTACK_APP_ORIGIN;
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) origin = url.origin;
    } catch {}
  }
  return `${origin}${path}`;
}

export interface PricingSummary {
  source: "live" | "fallback";
  currency: string;
  monthly_price: number;
  taxes_included: boolean;
  signup_credits: number | null;
  signup_credits_expire_in_days: number | null;
}

/** Snapshot of GET /v2/pricing (2026-11): used only when the live price list cannot be read. */
export const FALLBACK_PRICING: PricingSummary = {
  source: "fallback",
  currency: "MXN",
  monthly_price: 199,
  taxes_included: false,
  signup_credits: 11,
  signup_credits_expire_in_days: 30,
};

/** Public price list (no key). Never throws: any failure returns the fallback snapshot. */
export async function fetchPricing(timeoutMs = 5000): Promise<PricingSummary> {
  try {
    const res = await fetch(`${apiBaseUrl()}/pricing`, { redirect: "error", signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } });
    if (!res.ok) return FALLBACK_PRICING;
    const body: any = await res.json();
    const data = body?.data ?? body;
    const price = data?.features?.taxpayer?.monthly_price;
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) return FALLBACK_PRICING;
    const credits = data?.signup_credits?.credits;
    const expires = data?.signup_credits?.expires_in_days;
    return {
      source: "live",
      currency: typeof data?.currency === "string" && /^[A-Z]{3}$/.test(data.currency) ? data.currency : "MXN",
      monthly_price: price,
      taxes_included: data?.taxes_included === true,
      signup_credits: typeof credits === "number" && Number.isFinite(credits) && credits > 0 ? credits : null,
      signup_credits_expire_in_days: typeof expires === "number" && Number.isFinite(expires) && expires > 0 ? expires : null,
    };
  } catch {
    return FALLBACK_PRICING;
  }
}

const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * Go-live copy after a test invoice. Pricing copy rules (docs/growth/PRICING_COPY.md): credits
 * are MXN of usage, never documents; never "facturas gratis"; the price says "+ IVA"; credits are
 * granted when the account goes live, not at signup.
 */
export function goLiveMessage(p: PricingSummary): string {
  const tax = p.taxes_included ? "IVA incluido" : "+ IVA";
  const credits = p.signup_credits
    ? `; ${money(p.signup_credits)} créditos de bienvenida (1 crédito = 1 ${p.currency} de uso) al activar producción`
    : "";
  return (
    "Esta es una factura de prueba (sin validez fiscal). " +
    `Para emitir facturas reales activa producción en ${appUrl("/home")} — ` +
    `desde $${money(p.monthly_price)} ${p.currency} ${tax} al mes por RFC, más uso${credits}. ` +
    `Precios: ${PRICING_PAGE_URL}`
  );
}
