import schemas from "./contracts/stripe-connection-request.schema.json";
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export const stripeUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
function valid(v: any, s: any): boolean {
  if (s.enum && !s.enum.includes(v)) return false;
  if (s.type === "object")
    return (
      !!v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      (s.required || []).every((k: string) => k in v) &&
      Object.keys(v).every(
        (k) => s.properties[k] && valid(v[k], s.properties[k]),
      )
    );
  if (s.type === "boolean") return typeof v === "boolean";
  if (s.type === "string")
    return (
      typeof v === "string" &&
      v.length >= (s.minLength || 0) &&
      v.length <= (s.maxLength ?? Infinity) &&
      (!s.pattern || new RegExp(s.pattern).test(v))
    );
  if (s.type === "number" || s.type === "integer")
    return (
      Number.isFinite(v) &&
      (s.type !== "integer" || Number.isSafeInteger(v)) &&
      v >= (s.minimum ?? -Infinity) &&
      v <= (s.maximum ?? Infinity)
    );
  return false;
}
export function stripeSchema(action: string) {
  if (
    ![
      "create",
      "disconnect",
      "terminal",
      "standard_create",
      "standard_refresh",
    ].includes(action)
  )
    throw Error("Solo esquemas públicos de Stripe");
  return (schemas as any)[action];
}
export function stripeInput(action: string, input: unknown) {
  if (!valid(input, stripeSchema(action)))
    throw Error(
      "Entrada Stripe fuera del contrato público; no acepta claves, códigos OAuth ni estados de autorización",
    );
  return input as Record<string, unknown>;
}
const generation = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
export function safeStripe(
  value: any,
  team: string,
  mode: boolean,
  operation?: string,
): Record<string, unknown> {
  if (
    !value ||
    value.team_id !== team ||
    value.livemode !== mode ||
    (operation && value.operation_id !== operation) ||
    !generation(value.generation ?? value.expected_generation)
  )
    throw Error("Respuesta Stripe fuera del equipo, modo u operación");
  const out: Record<string, unknown> = { team_id: team, livemode: mode };
  if (value.operation_id !== undefined) {
    if (
      !stripeUuid(value.operation_id) ||
      ![
        "pending",
        "awaiting_oauth",
        "in_progress",
        "completed",
        "outcome_unknown",
        "cancelled",
        "expired",
        "closed_unconfirmed",
      ].includes(value.status)
    )
      throw Error("Recibo Stripe inválido");
    out.operation_id = value.operation_id;
    out.status = value.status;
    if (value.expected_generation !== undefined) {
      if (!generation(value.expected_generation))
        throw Error("Generación inválida");
      out.expected_generation = value.expected_generation;
    }
    out.generation = value.generation ?? null;
    if (value.method !== undefined) {
      if (
        ![
          "oauth",
          "manual_key",
          "connect_webhooks",
          "account_onboarding",
          "platform_account_create",
        ].includes(value.method)
      )
        throw Error("Método inválido");
      out.method = value.method;
    }
    if (value.provider_account_id !== undefined) {
      if (
        typeof value.provider_account_id !== "string" ||
        !/^acct_[A-Za-z0-9]+$/.test(value.provider_account_id)
      )
        throw Error("Cuenta de proveedor inválida");
      out.provider_account_id = value.provider_account_id;
    }
    if (value.requester) {
      const r = value.requester;
      if (
        !["firebase", "mcp", "api", "oauth"].includes(r.credential_kind) ||
        !id(r.source_team_id) ||
        (r.credential_id !== null && !id(r.credential_id)) ||
        (r.person_id !== null && !id(r.person_id))
      )
        throw Error("Solicitante inválido");
      out.requester = {
        credential_kind: r.credential_kind,
        source_team_id: r.source_team_id,
        credential_id: r.credential_id,
        person_id: r.person_id,
      };
    }
    if (value.target_operation_id !== undefined) {
      if (!stripeUuid(value.target_operation_id))
        throw Error("Operación objetivo inválida");
      out.target_operation_id = value.target_operation_id;
    }
    for (const k of [
      "local_credentials_removed",
      "provider_effects_reconciled",
    ])
      if (value[k] !== undefined) {
        if (typeof value[k] !== "boolean") throw Error("Recibo inválido");
        out[k] = value[k];
      }
  } else {
    if (
      typeof value.connected !== "boolean" ||
      !(
        value.active_operation_id === null ||
        stripeUuid(value.active_operation_id)
      )
    )
      throw Error("Estado Stripe inválido");
    out.generation = value.generation;
    out.connected = value.connected;
    out.active_operation_id = value.active_operation_id;
    if (
      value.method !== null &&
      ![
        "oauth",
        "manual_key",
        "connect_webhooks",
        "account_onboarding",
        "platform_standard",
      ].includes(value.method)
    )
      throw Error("Método inválido");
    out.method = value.method;
    if (
      value.platform_account !== undefined &&
      value.platform_account !== null
    ) {
      if (
        value.method !== "platform_standard" ||
        !value.connected ||
        value.account_id !== value.platform_account.account_id
      )
        throw Error("Activación fuera de la cuenta actual");
      out.platform_account = safePlatformAccount(value.platform_account);
    } else out.platform_account = null;
    for (const k of ["account_id", "connect_account_id"]) {
      if (!(value[k] === null || id(value[k])))
        throw Error("Cuenta Stripe inválida");
      out[k] = value[k];
    }
    for (const k of [
      "managed",
      "connect_webhooks_configured",
      "transfer_webhooks_configured",
      "encrypted_credentials_present",
    ]) {
      if (typeof value[k] !== "boolean") throw Error("Estado inválido");
      out[k] = value[k];
    }
  }
  if (
    !["not_performed", "observed_deauthorized"].includes(
      value.provider_revocation,
    ) ||
    value.provider_webhook_removal !== "not_performed"
  )
    throw Error("Estado del proveedor inválido");
  out.provider_revocation = value.provider_revocation;
  out.provider_webhook_removal = value.provider_webhook_removal;
  if (value.billing_account_id !== undefined) {
    if (!id(value.billing_account_id))
      throw Error("Cuenta de facturación inválida");
    out.billing_account_id = value.billing_account_id;
  }
  if (value.browser_handoff_url !== undefined) {
    const u = new URL(value.browser_handoff_url);
    if (
      u.username ||
      u.password ||
      u.hash ||
      !(
        u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(u.hostname))
      ) ||
      u.pathname !== `/account/stripe-connection/${operation}` ||
      u.searchParams.get("team") !== team ||
      u.searchParams.get("livemode") !== String(mode) ||
      [...u.searchParams.keys()].some((k) => !["team", "livemode"].includes(k))
    )
      throw Error("Enlace privado inválido");
    out.browser_handoff_url = u.href;
  }
  return out;
}

function safePlatformAccount(value: any) {
  if (
    !value ||
    typeof value.account_id !== "string" ||
    !/^acct_[A-Za-z0-9]+$/.test(value.account_id) ||
    value.type !== "standard" ||
    ["details_submitted", "charges_enabled", "payouts_enabled"].some(
      (key) => typeof value[key] !== "boolean",
    ) ||
    !["onboarding_required", "details_submitted", "charges_enabled"].includes(
      value.status,
    )
  )
    throw Error("Activación Stripe inválida");
  return {
    account_id: value.account_id,
    type: "standard",
    details_submitted: value.details_submitted,
    charges_enabled: value.charges_enabled,
    payouts_enabled: value.payouts_enabled,
    status: value.status,
  };
}
export function safeStripeActivation(
  value: any,
  team: string,
  mode: boolean,
  accountId: string,
  expectedGeneration: number,
) {
  if (
    !value ||
    value.team_id !== team ||
    value.livemode !== mode ||
    value.account_id !== accountId ||
    value.generation !== expectedGeneration ||
    !generation(value.generation) ||
    !id(value.billing_account_id)
  )
    throw Error("Activación fuera del equipo, modo, cuenta o generación");
  return {
    team_id: team,
    billing_account_id: value.billing_account_id,
    livemode: mode,
    generation: expectedGeneration,
    ...safePlatformAccount(value),
  };
}
