import webhookConfiguration from "./schemas/webhook-configuration-request.schema.json";
export const deliveryEvents =
  webhookConfiguration.create.properties.events.items.enum;
export const deliveryStatuses = [
  "pending",
  "processing",
  "retrying",
  "succeeded",
  "failed",
  "unknown",
];
const errorCategories = [
  "http_response",
  "network_or_timeout",
  "manual_authority_changed",
  "resource_scope_changed",
  "malformed",
  "protocol",
  "userinfo",
  "private_host",
  "dns",
  "redirect",
];
const object = (v: any) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: any) =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(v);
const number = (v: any) =>
  v === null || (typeof v === "number" && Number.isFinite(v));
const pick = (v: any, keys: string[]) =>
  Object.fromEntries(
    keys.filter((k) => Object.hasOwn(v, k)).map((k) => [k, v[k]]),
  );
const shapeKeys = new Set(
  "data items id type status code message error errors success amount total currency tax_id legal_name address country zip state city street name email phone metadata payment invoice client receipt services event livemode team webhook folio resource_id pagination has_more next_cursor limit query description quantity unit_price taxes discount response request body headers token password credentials certificate secret".split(
    " ",
  ),
);
function shape(value: any, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (value === null) return null;
  if (typeof value === "string")
    return /^\[(?:string|number|boolean|bigint|symbol|function|REDACTED|TRUNCATED)\]$/.test(
      value,
    )
      ? value
      : "[REDACTED]";
  if (!object(value)) return "[REDACTED]";
  if (
    value.type === "array" &&
    Number.isSafeInteger(value.length) &&
    value.length >= 0 &&
    Array.isArray(value.items)
  )
    return {
      type: "array",
      length: value.length,
      items: value.items.slice(0, 5).map((v: any) => shape(v, depth + 1)),
      truncated: value.truncated === true || value.items.length > 5,
    };
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 40)
      .map(([key, v]) => [
        shapeKeys.has(key) ? key : "[REDACTED_KEY]",
        /secret|password|token|authorization|cookie|headers|credential|apikey|private|certificate|pfx|fiel|csd/i.test(
          key,
        )
          ? "[REDACTED]"
          : shape(v, depth + 1),
      ]),
  );
}
function row(value: any, kind: string, detail: boolean) {
  if (
    !object(value) ||
    !id(value.id) ||
    !number(value.timestamp) ||
    typeof value.livemode !== "boolean" ||
    value.redaction !== "metadata_and_body_shape"
  )
    throw new Error("Metadatos de log inválidos");
  let keys = ["id", "timestamp", "livemode", "redaction"];
  if (kind === "api") {
    if (
      !(
        value.method === null ||
        ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].includes(
          value.method,
        )
      ) ||
      !(
        value.endpoint === null ||
        (typeof value.endpoint === "string" &&
          /^\/[A-Za-z0-9_/:.-]{0,2048}$/.test(value.endpoint))
      ) ||
      !number(value.status_code)
    )
      throw new Error("Metadatos API inválidos");
    keys.push("method", "endpoint", "status_code");
  } else {
    if (
      !number(value.updated_at) ||
      !(value.webhook_id === null || id(value.webhook_id)) ||
      !(value.event === null || deliveryEvents.includes(value.event)) ||
      !deliveryStatuses.includes(value.status) ||
      !number(value.response_code) ||
      typeof value.retry_requested !== "boolean"
    )
      throw new Error("Metadatos de entrega inválidos");
    if (
      (Object.hasOwn(value, "resource_id") &&
        !(value.resource_id === null || id(value.resource_id))) ||
      (Object.hasOwn(value, "attempts") &&
        !(
          value.attempts === null ||
          (Number.isSafeInteger(value.attempts) && value.attempts >= 0)
        )) ||
      (Object.hasOwn(value, "latency_ms") &&
        !(
          value.latency_ms === null ||
          (typeof value.latency_ms === "number" &&
            Number.isFinite(value.latency_ms) &&
            value.latency_ms >= 0)
        )) ||
      (Object.hasOwn(value, "error_category") &&
        !(
          value.error_category === null ||
          errorCategories.includes(value.error_category)
        ))
    )
      throw new Error("Detalle de entrega inválido");
    keys.push(
      "updated_at",
      "webhook_id",
      "event",
      "status",
      "response_code",
      "retry_requested",
      "resource_id",
      "attempts",
      "latency_ms",
      "error_category",
    );
  }
  const result = pick(value, keys);
  if (detail)
    for (const key of kind === "api"
      ? ["request_shape", "query_shape", "response_shape"]
      : ["payload_shape", "response_shape"])
      result[key] = shape(value[key]);
  return result;
}
export function logProjection(raw: any, kind: string, detail = false) {
  if (!object(raw)) throw new Error("Respuesta de logs inválida");
  if (detail) return { success: true, data: row(raw.data, kind, true) };
  if (
    !Array.isArray(raw.data) ||
    typeof raw.has_more !== "boolean" ||
    !(raw.next_cursor === null || typeof raw.next_cursor === "string") ||
    !Number.isSafeInteger(raw.scanned_count) ||
    raw.scanned_count < 0 ||
    typeof raw.livemode !== "boolean"
  )
    throw new Error("Página de logs inválida");
  return {
    success: true,
    data: raw.data.map((v: any) => row(v, kind, false)),
    has_more: raw.has_more,
    next_cursor: raw.next_cursor,
    scanned_count: raw.scanned_count,
    livemode: raw.livemode,
  };
}
