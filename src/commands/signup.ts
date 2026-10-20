import { randomUUID } from "node:crypto";
import { Command } from "commander";
import pc from "picocolors";
import { ApiError, publicApi } from "../api.js";
import { listProfiles, saveProfile } from "../config.js";
import { error, isJsonMode, printJson, success, warn } from "../output.js";
import { ask, confirm } from "../prompt.js";
import { apiBaseUrl, runtimeOptions } from "../runtime.js";

declare const __PKG_VERSION__: string;

const NOT_ENABLED = "La creación de cuentas sandbox para agentes aún no está habilitada en el API (HTTP 404). No se creó nada; regístrate en https://app.gigstack.pro.";
const TEAM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const interactive = () => Boolean(process.stdin.isTTY) && !isJsonMode();

function expiry(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function claimSteps(teamId: string, claim: any): string[] {
  return [
    `Revisa ${claim?.sent_to ?? "tu correo"}: llegó un código de 6 dígitos. Reclama la cuenta antes de ${expiry(claim?.expires_at) ?? "7 días"} con: gigstack signup claim --team ${teamId} --code <código>`,
    "Hasta reclamarla, la clave de prueba solo opera datos de prueba (clientes, servicios, pagos, recibos, facturas de prueba, catálogos SAT).",
    "Para facturar en vivo: reclama la cuenta, define tu contraseña desde el correo que recibirás e inicia sesión en https://app.gigstack.pro para salir a producción.",
  ];
}

/** Failure output that keeps the idempotency key and any safe API data (team_id, claim). */
function fail(e: any, extra: Record<string, unknown> = {}) {
  const status = e instanceof ApiError ? e.status : undefined;
  if (status === 404) {
    error(Object.assign(new Error(NOT_ENABLED), { status: 404, code: "not_enabled" }));
    return;
  }
  if (isJsonMode()) {
    process.exitCode = 1;
    printJson({ error: { message: e?.message ?? String(e), ...(status ? { status } : {}), ...(e?.code ? { code: e.code } : {}), ...(e?.outcome ? { outcome: e.outcome } : {}) }, ...extra });
    return;
  }
  error(e);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) console.error(pc.dim(`  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`));
}

export function registerSignupCommands(program: Command) {
  const signup = program
    .command("signup")
    .description("Crear una cuenta sandbox (solo modo prueba, gratis) para una persona, sin iniciar sesión")
    .option("--sandbox", "Crear una cuenta sandbox de prueba (único modo disponible)")
    .option("--email <email>", "Correo de la persona (el suyo; recibirá el código para reclamar la cuenta)")
    .option("--name <name>", "Nombre de la persona o del negocio")
    .option("-p, --profile <name>", "Perfil donde guardar la clave de prueba", "sandbox")
    .option("--save", "Guardar la clave de prueba en el perfil sin preguntar (predeterminado sin terminal interactiva)")
    .option("--no-save", "No guardar la clave; mostrarla una sola vez")
    .option("--idempotency-key <key>", "Solo para reintentar una solicitud con resultado incierto (usa la clave que se reportó)")
    .action(async (opts) => {
      if (!opts.sandbox) { error("Solo se admite gigstack signup --sandbox --email <correo> --name <nombre>"); return; }
      const email = typeof opts.email === "string" ? opts.email.trim() : "";
      const name = typeof opts.name === "string" ? opts.name.trim() : "";
      if (!email || !name) { error("--email y --name son requeridos"); return; }

      // The key is returned exactly once, so where it goes is settled before the request.
      const profile: string = opts.profile;
      const mayStore = opts.save !== false;
      if (mayStore && listProfiles().some((p) => p.name === profile)) {
        error(Object.assign(new Error(`El perfil "${profile}" ya existe. Usa --profile <otro-nombre> o --no-save. No se envió ninguna solicitud.`), { code: "profile_exists" }));
        return;
      }

      const idempotencyKey: string = opts.idempotencyKey ?? randomUUID();
      const baseUrl = apiBaseUrl();
      let res: { status: number; body: any };
      try {
        res = await publicApi("/auth/sandbox", { email, name, agent: { client: `gigstack-cli/${__PKG_VERSION__}` } }, { idempotencyKey });
      } catch (e: any) {
        const data = e instanceof ApiError ? e.body?.data : undefined;
        if (e instanceof ApiError && e.code === "sandbox_pending_claim") {
          const teamId = data?.team_id;
          if (isJsonMode()) {
            process.exitCode = 1;
            printJson({ error: { message: e.message, status: e.status, code: e.code }, team_id: teamId ?? null, claim: data?.claim ?? null, next_steps: claimSteps(teamId, data?.claim) });
            return;
          }
          warn(`Este correo ya tiene una cuenta sandbox sin reclamar (team ${teamId}). No se creó otra; enviamos un nuevo código.`);
          for (const step of claimSteps(teamId, data?.claim)) console.log(pc.dim(`  - ${step}`));
          process.exitCode = 1;
          return;
        }
        const retry = !(e instanceof ApiError) || e.status >= 500 || ["sandbox_outcome_unknown", "idempotency_in_progress"].includes(e.code ?? "");
        const hint = e instanceof ApiError && e.code === "email_already_exists" ? { hint: "Este correo ya tiene cuenta en gigstack: inicia sesión en https://app.gigstack.pro" } : {};
        fail(e, { ...(retry ? { idempotency_key: idempotencyKey, retry: `Reintenta solo con --idempotency-key ${idempotencyKey}, nunca con una nueva` } : {}), ...hint, ...(data?.team_id ? { team_id: data.team_id } : {}) });
        return;
      }

      const data = res.body?.data ?? {};
      const teamId: string = data.team_id;
      const testKey: string | null = typeof data.api_key?.test === "string" ? data.api_key.test : null;
      const steps = claimSteps(teamId, data.claim);
      let saved = false;
      if (testKey && mayStore) {
        const store = opts.save === true || !interactive() ? true : await confirm(`¿Guardar la clave de prueba en el perfil "${profile}"?`, true);
        if (store) { saveProfile(profile, testKey, "test", baseUrl); saved = true; }
      }

      if (isJsonMode()) {
        return printJson({
          status: res.status === 201 ? "created" : "already_created",
          team_id: teamId,
          billing_account_id: data.billing_account_id ?? null,
          livemode: false,
          profile: saved ? profile : null,
          ...(testKey && !saved ? { api_key: { test: testKey } } : {}),
          claim: data.claim ?? null,
          idempotency_key: idempotencyKey,
          next_steps: steps,
        });
      }
      success(res.status === 201 ? `Cuenta sandbox creada (solo modo prueba, gratis). Team: ${pc.bold(teamId)}` : `La cuenta sandbox ya se había creado con esta clave de idempotencia. Team: ${pc.bold(teamId)}`);
      if (saved) {
        console.log(pc.dim(`  Clave de prueba guardada en el perfil "${profile}" (ahora es el perfil activo; vuelve con gigstack switch <perfil>)`));
        if (process.env.GIGSTACK_API_KEY) warn("GIGSTACK_API_KEY está definida y tiene prioridad sobre el perfil guardado");
      } else if (testKey) {
        console.log(`  Clave de prueba (se muestra una sola vez): ${testKey}`);
      } else {
        console.log(pc.dim("  La clave solo se entrega en la primera respuesta; no se vuelve a mostrar."));
      }
      for (const step of steps) console.log(pc.dim(`  - ${step}`));
    });

  signup
    .command("claim")
    .description("Reclamar una cuenta sandbox con el código recibido por correo (usa --team <id>)")
    .option("--code <code>", "Código de 6 dígitos recibido por correo")
    .action(async (opts) => {
      const teamId = runtimeOptions().team;
      if (!teamId || !TEAM_ID_RE.test(teamId)) { error("--team <id> es requerido (el team_id que devolvió gigstack signup --sandbox)"); return; }
      let code: string = typeof opts.code === "string" ? opts.code.trim() : "";
      if (!code && interactive()) code = (await ask("Código de 6 dígitos")).trim();
      if (!/^\d{6}$/.test(code)) { error("--code debe ser el código de 6 dígitos recibido por correo"); return; }
      try {
        const res = await publicApi("/auth/sandbox/claim", { team_id: teamId, code });
        const data = res.body?.data ?? {};
        if (isJsonMode()) return printJson(data);
        success(`Cuenta ${teamId} reclamada`);
        console.log(pc.dim(`  ${data.next ?? "Revisa tu correo para definir tu contraseña y sal a producción desde la app"}`));
        if (data.password_email === "failed") warn("No se pudo enviar el correo para definir contraseña; usa 'olvidé mi contraseña' en https://app.gigstack.pro");
      } catch (e: any) {
        if (e instanceof ApiError && e.code === "invalid_or_expired_code") {
          fail(e, { hint: "Código incorrecto, usado o vencido. Para recibir uno nuevo ejecuta de nuevo gigstack signup --sandbox con el mismo correo y nombre." });
          return;
        }
        fail(e);
      }
    });
}
