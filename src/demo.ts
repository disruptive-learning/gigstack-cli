import pc from "picocolors";
import { api, ApiError, getApiKey } from "./api.js";
import { getActiveProfile, getProfile, getTeamFromKey, isSafeProfileName, isTestKey } from "./config.js";
import { segment } from "./input.js";
import { fetchPricing, goLiveMessage } from "./onboarding.js";
import { formatMoney, isJsonMode, printJson, sanitizeTerminal, spin, success, warn } from "./output.js";
import { apiBaseUrl, configureRuntime, runtimeOptions } from "./runtime.js";

export const DEMO_SERVICE_SKU = "GIGSTACK-DEMO";
export const GENERAL_PUBLIC = { legal_name: "PUBLICO EN GENERAL", tax_id: "XAXX010101000", tax_system: "616", use: "S01" } as const;

/** Current month and year in Mexico City (SAT InformacionGlobal is checked against the issue date there). */
export function mexicoPeriod(now = new Date()): { months: string; year: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { months: get("month"), year: Number(get("year")) };
}

/**
 * Body of the demo invoice. CFDI 4.0: a receiver XAXX010101000 named "PUBLICO EN GENERAL" must be a
 * factura global (InformacionGlobal), so the API requires `global`; uso S01, régimen 616 and the
 * issuer's zip as DomicilioFiscalReceptor (the API forces these too). Concept per SAT's global
 * invoice guide: ClaveProdServ 01010101, ClaveUnidad ACT, "Venta".
 *
 * Client and service are matched with the API's `search` (`auto_create`), so every run reuses one
 * stored PUBLICO EN GENERAL client and one GIGSTACK-DEMO service instead of creating duplicates.
 */
export function demoInvoiceBody(opts: { zip?: string | null; now?: Date } = {}) {
  const period = mexicoPeriod(opts.now);
  return {
    automation_type: "none",
    client: {
      search: { on_key: "tax_id", on_value: GENERAL_PUBLIC.tax_id, auto_create: true, safety_check: false },
      ...GENERAL_PUBLIC,
      address: { ...(opts.zip ? { zip: opts.zip } : {}), country: "MEX" },
    },
    items: [
      {
        search: { on_key: "sku", on_value: DEMO_SERVICE_SKU, auto_create: true, safety_check: false },
        sku: DEMO_SERVICE_SKU,
        description: "Venta",
        quantity: 1,
        unit_price: 100,
        product_key: "01010101",
        unit_key: "ACT",
        unit_name: "Actividad",
        taxes: [{ type: "IVA", rate: 0.16, factor: "Tasa", withholding: false }],
      },
    ],
    global: { periodicity: "04", months: period.months, year: period.year },
    use: GENERAL_PUBLIC.use,
    payment_form: "01",
    payment_method: "PUE",
    currency: "MXN",
    send_email: false,
  };
}

/**
 * Issues one TEST invoice to PUBLICO EN GENERAL and prints how to go live. Shared by
 * `gigstack demo` and `gigstack invoices create --demo`. Refuses any credential that is not a
 * test key before sending a request.
 */
export async function runDemoInvoice(opts: { profile?: string; team?: string } = {}): Promise<void> {
  let apiKey: string | undefined;
  let profileTeam: string | undefined;
  if (opts.profile !== undefined) {
    if (!isSafeProfileName(opts.profile)) throw Object.assign(new Error("Nombre de perfil inválido."), { code: "invalid_profile" });
    const profile = getProfile(opts.profile);
    if (!profile) throw Object.assign(new Error(`No existe el perfil "${opts.profile}". Crea una cuenta de prueba con: gigstack signup`), { code: "profile_not_found" });
    if (profile.baseUrl && !runtimeOptions().baseUrl && !process.env.GIGSTACK_API_BASE_URL) configureRuntime({ ...runtimeOptions(), baseUrl: profile.baseUrl });
    const bound = new URL(profile.baseUrl ?? "https://api.gigstack.io/v2").origin;
    if (new URL(apiBaseUrl()).origin !== bound) {
      throw Object.assign(new Error("El origen del API no coincide con el perfil guardado. No se envió la credencial."), { code: "credential_origin_mismatch" });
    }
    apiKey = profile.apiKey;
    profileTeam = profile.teamId;
  } else {
    apiKey = getApiKey();
    profileTeam = process.env.GIGSTACK_API_KEY ? undefined : getActiveProfile()?.teamId;
  }

  if (!isTestKey(apiKey)) {
    throw Object.assign(
      new Error("La factura demo solo se emite con una llave de prueba (sk_test_…). La credencial seleccionada es de producción o no declara su modo; no se envió nada. Usa gigstack signup o un perfil de prueba."),
      { code: "live_key_refused" },
    );
  }

  const team = opts.team ?? runtimeOptions().team ?? process.env.GIGSTACK_TEAM;
  const teamId = team ?? profileTeam ?? getTeamFromKey(apiKey) ?? undefined;
  // Best effort: the issuer's zip for the receiver address. An unclaimed sandbox may read only its own team.
  let zip: string | null = null;
  if (teamId) {
    try {
      const res = await api("GET", `/teams/${segment(teamId)}`, { apiKey, team });
      zip = typeof res?.data?.address?.zip === "string" && res.data.address.zip ? res.data.address.zip : null;
      if (res?.data?.sat?.completed === false) warn("El equipo no tiene CSD configurado; el timbrado de prueba puede fallar.");
    } catch {}
  }

  const body = demoInvoiceBody({ zip });
  const [res, pricing] = await Promise.all([
    spin("Timbrando factura de prueba…", () => api("POST", "/invoices/income", { body, apiKey, team, sideEffect: true })),
    fetchPricing(),
  ]);
  const inv = res?.data ?? {};
  const uuid: string = inv.uuid ?? inv.id ?? "";
  const base = apiBaseUrl();
  const files = uuid
    ? {
        pdf: `${base}/invoices/${encodeURIComponent(uuid)}/files?file_type=pdf`,
        xml: `${base}/invoices/${encodeURIComponent(uuid)}/files?file_type=xml`,
        note: "Requieren tu API key (Authorization: Bearer) y devuelven el archivo en base64.",
        download_command: `gigstack invoices download ${uuid}`,
      }
    : null;
  const message = goLiveMessage(pricing);

  if (inv.livemode === true) warn("El API respondió livemode: true. Revisa la credencial: la demo solo debe usarse en modo de prueba.");

  if (isJsonMode()) {
    return printJson({
      invoice: {
        uuid,
        series: inv.series ?? null,
        folio_number: inv.folio_number ?? null,
        status: inv.status ?? null,
        livemode: inv.livemode ?? false,
        currency: inv.currency ?? "MXN",
        subtotal: inv.subtotal ?? null,
        taxes: inv.taxes ?? null,
        total: inv.total ?? null,
        receiver: { legal_name: GENERAL_PUBLIC.legal_name, tax_id: GENERAL_PUBLIC.tax_id },
        global: inv.global ?? body.global,
      },
      files,
      pricing,
      next_steps: message,
    });
  }

  success("Factura de prueba timbrada");
  const rows: Record<string, string> = {
    UUID: uuid || "—",
    "Serie/Folio": `${inv.series ?? "—"}-${inv.folio_number ?? "—"}`,
    Receptor: `${GENERAL_PUBLIC.legal_name} (${GENERAL_PUBLIC.tax_id}) — factura global ${body.global.months}/${body.global.year}`,
    Total: formatMoney(inv.total, inv.currency ?? "MXN"),
  };
  if (files) {
    rows.PDF = files.pdf;
    rows.XML = files.xml;
    rows.Descargar = files.download_command;
  }
  const width = Math.max(...Object.keys(rows).map((k) => k.length));
  for (const [k, v] of Object.entries(rows)) console.log(`  ${pc.bold(k.padEnd(width))}  ${sanitizeTerminal(v)}`);
  if (files) console.log(pc.dim(`  ${files.note}`));
  console.log(`\n${pc.yellow(message)}`);
}

export function describeDemoError(e: unknown): unknown {
  if (e instanceof ApiError && e.code === "sandbox_unclaimed") {
    return Object.assign(new Error(`${e.message} Reclama la cuenta con: gigstack signup claim <código>`), { status: e.status, code: e.code });
  }
  return e;
}
