import { Command } from "commander";
import { randomUUID } from "node:crypto";
import pc from "picocolors";
import { ApiError, publicApi } from "../api.js";
import {
  findProfilesByTeam,
  getActiveProfile,
  getProfile,
  isSafeProfileName,
  saveProfile,
  updateProfileSandbox,, credentialsPath } from "../config.js";
import { AGENT_CLIENT, appUrl } from "../onboarding.js";
import { isJsonMode, printJson, sanitizeTerminal, success, warn } from "../output.js";
import { ask } from "../prompt.js";
import { apiBaseUrl, configureRuntime, runtimeOptions } from "../runtime.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const TEAM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CODE_RE = /^\d{6}$/;
export const DEFAULT_SANDBOX_PROFILE = "sandbox";

const NOT_ENABLED =
  "El registro de cuentas de prueba (sandbox) aún no está habilitado en este API (HTTP 404). No se creó nada. " +
  `Regístrate en ${appUrl("/register")} o inténtalo más tarde.`;

interface Failure { message: string; code?: string; status?: number; outcome?: string; idempotency_key?: string; retry?: string; hint?: string }

/** Prints a failure (JSON on stdout in --json mode) and sets a nonzero exit code. */
function fail(f: Failure): void {
  process.exitCode = 1;
  if (isJsonMode()) {
    printJson({ error: { message: f.message, ...(f.status ? { status: f.status } : {}), ...(f.code ? { code: f.code } : {}), ...(f.outcome ? { outcome: f.outcome } : {}), ...(f.idempotency_key ? { idempotency_key: f.idempotency_key } : {}), ...(f.retry ? { retry_command: f.retry } : {}) } });
    return;
  }
  console.error(pc.red(`✗ ${sanitizeTerminal(f.message)}`));
  if (f.hint) console.error(pc.dim(`  ${sanitizeTerminal(f.hint)}`));
  if (f.retry) console.error(pc.dim(`  Reintenta exactamente con: ${sanitizeTerminal(f.retry)}`));
}

const isoOrNull = (value: unknown): string | null =>
  typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : null;

const localDate = (ms: number | null) =>
  ms === null ? "7 días después del registro" : new Date(ms).toLocaleString("es-MX", { dateStyle: "long", timeStyle: "short" });

function readClaim(data: any) {
  const claim = data?.claim ?? {};
  return {
    sent_to: typeof claim.sent_to === "string" ? claim.sent_to : null,
    expires_at: typeof claim.expires_at === "number" ? claim.expires_at : null,
    expires_at_iso: isoOrNull(claim.expires_at),
    delivery: typeof claim.delivery === "string" ? claim.delivery : null,
  };
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Next steps after signup. With a saved profile: demo, claim, go live. Without one (a replay or a
 * pending claim whose key is not saved here) there is no key for the demo, and the claim names the team.
 */
function nextSteps(claim: ReturnType<typeof readClaim>, profile: string | null, teamId: string): string[] {
  const profileFlag = profile && profile !== DEFAULT_SANDBOX_PROFILE ? ` --profile ${profile}` : "";
  const claimCmd = profile ? `gigstack signup claim <código>${profileFlag}` : `gigstack signup claim <código> --team-id ${teamId}`;
  return [
    ...(profile ? [`Emite una factura de prueba: gigstack demo${profileFlag}`] : []),
    `Revisa tu correo${claim.sent_to ? ` (${claim.sent_to})` : ""}: te enviamos un código de 6 dígitos. Reclama tu cuenta antes del ${localDate(claim.expires_at)}${claim.expires_at_iso ? ` (${claim.expires_at_iso})` : ""} con: ${claimCmd}. Si no la reclamas, la cuenta de prueba expira y su llave se revoca.`,
    `Después de reclamarla, define tu contraseña con el enlace que te llegará por correo y activa producción en ${appUrl("/home")} para emitir CFDI reales.`,
  ];
}

function printSteps(steps: string[]) {
  console.log(pc.bold("\nSiguientes pasos:"));
  steps.forEach((step, i) => console.log(`  ${i + 1}. ${sanitizeTerminal(step)}`));
}

/** First free profile name based on `base`, for a second sandbox that must not overwrite the first. */
function freeProfileName(base: string): string {
  for (let i = 2; i < 100; i++) {
    const name = `${base.slice(0, 60)}-${i}`;
    if (!getProfile(name)) return name;
  }
  return `${base.slice(0, 50)}-${Date.now()}`;
}

async function promptValue(label: string, current: string | undefined, flag: string): Promise<string> {
  if (current?.trim()) return current.trim();
  if (!process.stdin.isTTY || isJsonMode()) {
    throw Object.assign(new Error(`Falta ${flag}. En modo no interactivo pasa --email y --name.`), { code: "missing_argument" });
  }
  return (await ask(label)).trim();
}

export function registerSignupCommands(program: Command) {
  const signup = program
    .command("signup")
    .description("Crear una cuenta de prueba (sandbox) gratis y guardar su llave de prueba como perfil")
    .option("--email <email>", "Tu correo (recibirás un código para reclamar la cuenta)")
    .option("--name <name>", "Tu nombre o el de tu negocio")
    .option("-p, --profile <name>", "Perfil donde guardar la llave de prueba", DEFAULT_SANDBOX_PROFILE)
    .option("--idempotency-key <key>", "Solo para reintentar una solicitud con resultado desconocido (usa la llave que se imprimió)")
    .addHelpText(
      "after",
      `
Crea una cuenta de gigstack en modo de prueba: sin tarjeta, las facturas no se envían al SAT.
La llave de prueba se muestra una sola vez y se guarda en el perfil indicado.
Después: gigstack demo  →  gigstack signup claim <código>  →  activa producción en ${appUrl("/home")}`,
    )
    .action(async (opts) => {
      try {
        await runSignup(opts);
      } catch (e: any) {
        fail({ message: e?.message ?? String(e), code: e?.code });
      }
    });

  signup
    .command("claim <code>")
    .description("Reclamar la cuenta de prueba con el código de 6 dígitos que llegó a tu correo")
    .option("-p, --profile <name>", "Perfil creado por gigstack signup (por defecto el activo, o \"sandbox\")")
    .option("--team-id <id>", "team_id de la cuenta de prueba (si no tienes el perfil)")
    .action(async (code, opts) => {
      try {
        // `signup` has its own --profile, and Commander lets the parent consume it after `claim`.
        const parentProfile = signup.getOptionValueSource("profile") === "cli" ? signup.opts().profile : undefined;
        await runClaim(code, { ...opts, profile: opts.profile ?? parentProfile });
      } catch (e: any) {
        fail({ message: e?.message ?? String(e), code: e?.code });
      }
    });
}

async function runSignup(opts: { email?: string; name?: string; profile: string; idempotencyKey?: string }) {
  if (!isSafeProfileName(opts.profile)) {
    return fail({ message: "Nombre de perfil inválido. Usa 1–64 caracteres [A-Za-z0-9_-].", code: "invalid_profile" });
  }
  // A real key must never be overwritten by a sandbox key: refuse before creating anything.
  const existing = getProfile(opts.profile);
  if (existing && !existing.sandbox) {
    return fail({
      message: `El perfil "${opts.profile}" ya existe y no es una cuenta de prueba creada con signup. No se creó nada.`,
      code: "profile_exists",
      hint: "Elige otro nombre con --profile <nombre>.",
    });
  }
  if (opts.idempotencyKey !== undefined && !IDEMPOTENCY_KEY_RE.test(opts.idempotencyKey)) {
    return fail({ message: "--idempotency-key debe tener 8–128 caracteres [A-Za-z0-9._:-]", code: "invalid_idempotency_key" });
  }

  const email = await promptValue("Correo", opts.email, "--email");
  const name = await promptValue("Nombre o negocio", opts.name, "--name");
  if (email.length > 254 || !EMAIL_RE.test(email)) return fail({ message: "Correo inválido.", code: "invalid_email" });
  if (!name || name.length > 200) return fail({ message: "El nombre es obligatorio (1–200 caracteres).", code: "invalid_name" });

  const key = opts.idempotencyKey ?? randomUUID();
  const explicitBase = runtimeOptions().baseUrl;
  const retry = `gigstack signup --email ${shellQuote(email)} --name ${shellQuote(name)}${opts.profile !== DEFAULT_SANDBOX_PROFILE ? ` --profile ${opts.profile}` : ""}${explicitBase ? ` --base-url ${shellQuote(explicitBase)}` : ""} --idempotency-key ${key}`;
  const baseUrl = apiBaseUrl();

  let res: any;
  try {
    res = await publicApi("POST", "/auth/sandbox", {
      body: { email, name, agent: { client: AGENT_CLIENT } },
      idempotencyKey: key,
      sideEffect: true,
    });
  } catch (e: any) {
    if (!(e instanceof ApiError)) {
      return fail({
        message: `No se pudo confirmar si la cuenta se creó (${e?.message ?? "error de red"}).`,
        code: e?.code ?? "outcome_unknown",
        outcome: "unknown",
        idempotency_key: key,
        retry,
        hint: "Reintenta solo con la misma Idempotency-Key, nunca con una nueva.",
      });
    }
    return handleSignupError(e, key, retry);
  }

  const data = res?.data ?? {};
  const teamId = typeof data.team_id === "string" ? data.team_id : "";
  const testKey = typeof data.api_key?.test === "string" ? data.api_key.test : null;
  const claim = readClaim(data);

  if (!testKey) {
    // 200: replay of an earlier call with this Idempotency-Key; the key was only in the first response.
    const saved = teamId ? findProfilesByTeam(teamId) : [];
    const profile = saved[0] ?? null;
    const steps = nextSteps(claim, profile, teamId);
    if (isJsonMode()) {
      return printJson({ status: "already_created", team_id: teamId, livemode: false, profile, api_key: { test: null }, claim, idempotency_key: key, next_steps: steps });
    }
    success(`La cuenta de prueba ya se había creado (team_id: ${teamId}).`);
    if (profile) console.log(pc.dim(`  Su llave de prueba está guardada en el perfil "${profile}".`));
    else warn("La llave de prueba solo se entrega en la primera respuesta y no está guardada en ningún perfil. Reclama la cuenta y crea una llave nueva en la app.");
    printSteps(steps);
    return;
  }

  // 201: save the key before printing anything else, so it is never lost.
  let profileName = opts.profile;
  const current = getProfile(profileName);
  if (current && current.teamId && current.teamId !== teamId) profileName = freeProfileName(opts.profile);
  saveProfile(profileName, testKey, "test", baseUrl, {
    teamId,
    sandbox: { email: claim.sent_to ?? email, claimExpiresAt: claim.expires_at, claimed: false },
  });

  const steps = nextSteps(claim, profileName, teamId);
  if (isJsonMode()) {
    return printJson({
      status: "created",
      team_id: teamId,
      billing_account_id: typeof data.billing_account_id === "string" ? data.billing_account_id : null,
      livemode: false,
      profile: profileName,
      api_key: { test: testKey },
      claim,
      test_issuer: data.test_issuer ?? null,
      idempotency_key: key,
      next_steps: steps,
    });
  }
  success("Cuenta de prueba creada (modo de prueba, sin costo).");
  console.log(`  ${pc.bold("Equipo")}   ${sanitizeTerminal(teamId)}`);
  console.log(`  ${pc.bold("Perfil")}   ${profileName} (activo) — llave de prueba guardada en ${credentialsPath()}`);
  if (process.env.GIGSTACK_API_KEY) warn(`GIGSTACK_API_KEY está definida y tiene prioridad sobre el perfil guardado; quítala o usa --profile ${profileName} en gigstack demo.`);
  if (profileName !== opts.profile) warn(`El perfil "${opts.profile}" ya tenía otra cuenta de prueba; esta se guardó como "${profileName}".`);
  if (data.test_issuer?.rfc) console.log(`  ${pc.bold("Emisor")}   ${sanitizeTerminal(data.test_issuer.rfc)} (emisor de prueba del SAT)`);
  if (claim.delivery === "failed") warn("No pudimos enviar el correo con el código. Ejecuta de nuevo gigstack signup con el mismo correo y nombre para recibir uno nuevo.");
  printSteps(steps);
}

function handleSignupError(e: ApiError, key: string, retry: string) {
  const status = e.status;
  const code = e.code;
  const body = e.body ?? {};
  const detail = e.message || "Sin detalle del error.";

  if (status === 409 && code === "sandbox_pending_claim") {
    const data = body.data ?? {};
    const teamId = typeof data.team_id === "string" ? data.team_id : "";
    const claim = readClaim(data);
    const saved = teamId ? findProfilesByTeam(teamId) : [];
    const profile = saved[0] ?? null;
    const steps = nextSteps(claim, profile, teamId);
    if (isJsonMode()) {
      return printJson({ status: "pending_claim", team_id: teamId, livemode: false, profile, api_key: { test: null }, claim, idempotency_key: key, next_steps: steps });
    }
    warn(`Este correo ya tiene una cuenta de prueba sin reclamar (team_id: ${teamId}). No se creó otra; te enviamos un código nuevo.`);
    if (profile) console.log(pc.dim(`  Su llave de prueba sigue en el perfil "${profile}".`));
    else console.log(pc.dim("  La llave de prueba solo se entregó en el primer registro; reclama la cuenta para administrar sus llaves en la app."));
    if (claim.delivery === "failed") warn("No pudimos enviar el correo con el código; inténtalo de nuevo en unos minutos.");
    printSteps(steps);
    return;
  }
  if (status === 404) return fail({ message: NOT_ENABLED, status, code: code ?? "not_found" });

  const base = { status, code, idempotency_key: key };
  switch (code) {
    case "email_already_exists":
      return fail({ ...base, message: "Este correo ya tiene una cuenta de gigstack, así que no se creó una de prueba.", hint: `Inicia sesión en ${appUrl()} (o usa "olvidé mi contraseña"). No reintentes con otro correo.` });
    case "email_not_allowed":
      return fail({ ...base, message: `${detail}.`, hint: "Usa un correo permanente que sí revises." });
    case "sandbox_claim_locked":
      return fail({ ...base, message: `${detail}.`, hint: `Puedes registrarte en ${appUrl("/register")}.` });
    case "rate_limit_exceeded":
      return fail({ ...base, message: `${detail} No se creó nada.`, hint: "Espera e inténtalo de nuevo más tarde." });
    case "idempotency_conflict":
      return fail({ ...base, message: `${detail}.`, hint: "Omite --idempotency-key para iniciar una solicitud nueva." });
    case "validation_failed":
    case "invalid_request_body":
    case "bad_request":
      return fail({ ...base, message: detail });
    case "idempotency_in_progress":
    case "sandbox_outcome_unknown":
    case "sandbox_state_unavailable":
    case "sandbox_unavailable":
      return fail({ ...base, outcome: code === "sandbox_unavailable" ? undefined : "unknown", message: `${detail}.`, retry, hint: "Reintenta solo con la misma Idempotency-Key, nunca con una nueva." });
    default:
      return status >= 500
        ? fail({ ...base, outcome: "unknown", message: `${detail}.`, retry, hint: "Reintenta solo con la misma Idempotency-Key, nunca con una nueva." })
        : fail({ ...base, message: detail });
  }
}

async function runClaim(rawCode: string, opts: { profile?: string; teamId?: string }) {
  const code = String(rawCode ?? "").trim();
  if (!CODE_RE.test(code)) return fail({ message: "El código debe tener 6 dígitos.", code: "invalid_code_format" });
  if (opts.profile !== undefined && !isSafeProfileName(opts.profile)) return fail({ message: "Nombre de perfil inválido.", code: "invalid_profile" });

  let profile = opts.profile !== undefined ? getProfile(opts.profile) : null;
  if (opts.profile !== undefined && !profile && !opts.teamId) {
    return fail({ message: `No existe el perfil "${opts.profile}".`, code: "profile_not_found", hint: "Pasa --team-id <id> con el team_id que imprimió gigstack signup." });
  }
  if (!profile && opts.profile === undefined && !opts.teamId) {
    const active = getActiveProfile();
    profile = active?.teamId ? getProfile(active.name) : getProfile(DEFAULT_SANDBOX_PROFILE);
  }
  const teamId = opts.teamId ?? profile?.teamId;
  if (!teamId) {
    return fail({ message: "No encontré el team_id de la cuenta de prueba.", code: "team_id_required", hint: "Pasa --team-id <id> (lo imprimió gigstack signup) o --profile <nombre>." });
  }
  if (!TEAM_ID_RE.test(teamId)) return fail({ message: "team_id inválido.", code: "invalid_team_id" });

  // The claim goes to the API the sandbox was created on, unless --base-url/env say otherwise.
  if (profile?.baseUrl && !runtimeOptions().baseUrl && !process.env.GIGSTACK_API_BASE_URL) {
    configureRuntime({ ...runtimeOptions(), baseUrl: profile.baseUrl });
  }

  let res: any;
  try {
    res = await publicApi("POST", "/auth/sandbox/claim", { body: { team_id: teamId, code }, sideEffect: true });
  } catch (e: any) {
    if (!(e instanceof ApiError)) {
      return fail({
        message: `No se pudo confirmar si la cuenta se reclamó (${e?.message ?? "error de red"}).`,
        code: e?.code ?? "outcome_unknown",
        outcome: "unknown",
        hint: `Reintenta con el mismo código. Si responde que el código no es válido, probablemente ya se reclamó: revisa tu correo para definir tu contraseña en ${appUrl()}.`,
      });
    }
    if (e.status === 404) return fail({ message: NOT_ENABLED, status: 404, code: e.code ?? "not_found" });
    if (e.code === "invalid_or_expired_code") {
      return fail({
        message: "El código no es válido, ya se usó o expiró.",
        status: e.status,
        code: e.code,
        hint: "Revisa el correo más reciente; no adivines el código. Para recibir uno nuevo, ejecuta otra vez gigstack signup con el mismo correo y nombre.",
      });
    }
    if (e.code === "rate_limit_exceeded") return fail({ message: e.message, status: e.status, code: e.code, hint: "Espera antes de volver a intentarlo." });
    return fail({ message: e.message, status: e.status, code: e.code });
  }

  const data = res?.data ?? {};
  for (const name of findProfilesByTeam(teamId)) updateProfileSandbox(name, { claimed: true, claimExpiresAt: null });
  const passwordEmail = typeof data.password_email === "string" ? data.password_email : null;
  const steps = [
    passwordEmail === "failed"
      ? `No pudimos enviarte el correo para definir tu contraseña; usa "olvidé mi contraseña" en ${appUrl()}.`
      : "Revisa tu correo y define tu contraseña con el enlace que te enviamos.",
    `Activa producción en ${appUrl("/home")} para emitir CFDI reales. Hasta entonces la cuenta sigue en modo de prueba.`,
  ];
  if (isJsonMode()) {
    return printJson({ claimed: true, team_id: teamId, password_email: passwordEmail, next: typeof data.next === "string" ? data.next : null, next_steps: steps });
  }
  success(`Cuenta ${teamId} reclamada.`);
  printSteps(steps);
}
