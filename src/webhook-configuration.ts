import schemas from "./schemas/webhook-configuration-request.schema.json";
import { apiBaseUrl } from "./runtime.js";
const object = (v: any) => v && typeof v === "object" && !Array.isArray(v);
const id = (v: any) =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export const configUuid = (v: any) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    v,
  );
export const configRevision = (v: any) =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const fields = (value: any, names: string[]) =>
  Object.fromEntries(
    names.filter((k) => Object.hasOwn(value, k)).map((k) => [k, value[k]]),
  );
const nullableText = (v: any) => v === null || typeof v === "string";
export function savedWebhook(value: any): Record<string, any> {
  if (
    !object(value) ||
    !id(value.id) ||
    typeof value.url !== "string" ||
    !Array.isArray(value.events) ||
    value.events.some(
      (e: any) => !schemas.create.properties.events.items.enum.includes(e),
    ) ||
    !["active", "inactive"].includes(value.status) ||
    !nullableText(value.description ?? null) ||
    typeof value.owner !== "string" ||
    !Number.isFinite(value.created_at) ||
    !["v1", "v2", null].includes(value.version) ||
    ![null, "gigstack_connect"].includes(value.type) ||
    !configRevision(value.revision) ||
    value.effect_scope !== "shared_team_webhooks"
  )
    throw new Error("Metadatos de webhook inválidos");
  const sec = value.security,
    sign = value.signing;
  if (
    !object(sec) ||
    !Array.isArray(sec.header_names) ||
    sec.header_names.some((n: any) => typeof n !== "string") ||
    typeof sec.configured !== "boolean" ||
    !["not_configured", "configured", "pending", "failed"].includes(
      sec.status,
    ) ||
    !object(sign) ||
    typeof sign.enabled !== "boolean" ||
    typeof sign.configured !== "boolean" ||
    !["disabled", "configured", "pending", "failed"].includes(sign.status)
  )
    throw new Error("Metadatos de seguridad inválidos");
  return {
    ...fields(value, [
      "id",
      "url",
      "events",
      "status",
      "description",
      "owner",
      "created_at",
      "version",
      "type",
      "revision",
      "effect_scope",
    ]),
    security: fields(sec, ["header_names", "configured", "status"]),
    signing: fields(sign, ["enabled", "configured", "status"]),
  };
}
const codes = [
  "team_not_found",
  "invalid_webhook_configuration",
  "original_credential_scope_changed",
  "webhook_plan_required",
  "webhook_revision_conflict",
  "webhook_configuration_forbidden",
  "master_team_required",
  "original_credential_required",
  "original_credential_configuration_required",
  "webhook_secret_write_unconfirmed",
];
export function configurationReceipt(
  value: any,
  team: string,
  uuid: string,
  action?: "create" | "update",
  endpoint?: string,
) {
  const op = value?.operation;
  if (
    !object(op) ||
    !configUuid(op.operation_id) ||
    op.operation_id !== uuid ||
    op.team_id !== team ||
    !id(op.webhook_id) ||
    (endpoint && op.webhook_id !== endpoint) ||
    !["create", "update"].includes(op.action) ||
    (action && op.action !== action) ||
    !["processing", "completed", "outcome_unknown", "conflict"].includes(
      op.status,
    ) ||
    !Number.isFinite(op.created_at) ||
    op.effect_scope !== "shared_team_webhooks" ||
    !Number.isSafeInteger(op.secret_attempts) ||
    op.secret_attempts < 0 ||
    !(op.error === null || codes.includes(op.error)) ||
    op.credential_delivery !== "not_replayed"
  )
    throw new Error("Recibo de configuración inválido; consulta el mismo UUID");
  const webhook = value.data === null ? null : savedWebhook(value.data);
  if (
    (webhook && webhook.id !== op.webhook_id) ||
    (action && op.status === "completed" && !webhook)
  )
    throw new Error(
      "El recibo no confirma el endpoint actual; consulta el mismo UUID",
    );
  return {
    data: webhook,
    operation: fields(op, [
      "operation_id",
      "team_id",
      "webhook_id",
      "action",
      "status",
      "created_at",
      "effect_scope",
      "secret_attempts",
      "error",
      "credential_delivery",
    ]),
  };
}
function valid(v: any, s: any): boolean {
  if (!s) return false;
  if (s.enum && !s.enum.includes(v)) return false;
  if (v === null) return Array.isArray(s.type) && s.type.includes("null");
  const type = Array.isArray(s.type)
    ? s.type.find((t: string) => t !== "null")
    : s.type;
  if (type === "string")
    return (
      typeof v === "string" &&
      v.length >= (s.minLength ?? 0) &&
      v.length <= (s.maxLength ?? Infinity) &&
      (!s.pattern || new RegExp(s.pattern).test(v))
    );
  if (type === "boolean") return typeof v === "boolean";
  if (type === "array")
    return (
      Array.isArray(v) &&
      v.length <= (s.maxItems ?? Infinity) &&
      v.every((x) => valid(x, s.items))
    );
  if (type === "object")
    return (
      object(v) &&
      (s.required ?? []).every((k: string) => Object.hasOwn(v, k)) &&
      Object.keys(v).every(
        (k) => Object.hasOwn(s.properties, k) && valid(v[k], s.properties[k]),
      )
    );
  return false;
}
export function configurationInput(
  action: "create" | "update" | "delete",
  body: Record<string, any>,
) {
  if (
    Object.hasOwn(body, "security") ||
    Object.hasOwn(body, "signing") ||
    !valid(body, schemas[action])
  )
    throw new Error(
      "Entrada de configuración inválida; headers y firma requieren el navegador privado",
    );
  if (action !== "delete" && !configUuid(body.operation_id))
    throw new Error("operation_id UUIDv4 persistido es obligatorio");
  if (action !== "create" && !configRevision(body.expected_revision))
    throw new Error("expected_revision del GET actual es obligatorio");
  if (action === "create" && body.status !== "inactive" && !body.events?.length)
    throw new Error("Un webhook activo requiere eventos");
  if (body.url) {
    const url = new URL(body.url);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error("URL de webhook inválida");
  }
  return body;
}
export function configurationSchema(action: string) {
  if (!Object.hasOwn(schemas, action)) throw new Error("Acción desconocida");
  const s = structuredClone(schemas[action as keyof typeof schemas]) as any;
  delete s.properties.security;
  delete s.properties.signing;
  s.required = [
    ...new Set([
      ...(s.required ?? []),
      ...(action === "delete" ? [] : ["operation_id"]),
      ...(action === "create" ? [] : ["expected_revision"]),
    ]),
  ];
  return s;
}
export function configurationHandoff(
  raw: any,
  team: string,
  endpoint: string,
  intent: string,
) {
  const webhook = savedWebhook(raw?.data),
    access = raw?.configuration_access;
  if (
    !["headers", "signing"].includes(intent) ||
    !object(access) ||
    access.can_manage !== true ||
    access.can_configure !== true ||
    access.team_id !== team ||
    access.webhook_id !== endpoint ||
    !id(access.actor_id) ||
    access.revision !== webhook.revision ||
    webhook.id !== endpoint
  )
    throw new Error("Acceso actual para configurar webhook no confirmado");
  const apiOrigin = new URL(apiBaseUrl()),
    configured = process.env.GIGSTACK_APP_ORIGIN;
  const value =
    configured ??
    (apiOrigin.origin === "https://api.gigstack.io"
      ? "https://app.gigstack.pro"
      : undefined);
  if (!value)
    throw new Error(
      "Configura GIGSTACK_APP_ORIGIN explícitamente para el API no productivo",
    );
  const origin = new URL(value),
    local = (u: URL) =>
      ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (apiOrigin.origin === "https://api.gigstack.io"
      ? origin.origin !== "https://app.gigstack.pro"
      : origin.origin !== "https://staging.gigstack.pro" &&
        !(
          local(origin) &&
          local(apiOrigin) &&
          ["http:", "https:"].includes(origin.protocol)
        ))
  )
    throw new Error("Origen del navegador no confiable");
  const url = new URL(
    `/account/webhooks/${encodeURIComponent(endpoint)}`,
    origin,
  );
  url.searchParams.set("team", team);
  url.searchParams.set("intent", intent);
  return {
    webhook,
    intent,
    review_url: url.toString(),
    effect_scope: "shared_team_webhooks",
  };
}
