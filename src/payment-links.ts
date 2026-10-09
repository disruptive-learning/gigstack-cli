import schemas from "./schemas/payment-link-request.schema.json";
export type LinkAction = keyof typeof schemas;
const object = (v: any): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const linkId = (v: unknown): v is string =>
  typeof v === "string" && /^plink[A-Za-z0-9_-]{1,155}$/.test(v);
const uuid = (v: unknown) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    v,
  );
const revision = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
function valid(v: any, s: any): boolean {
  if (s.oneOf)
    return (
      s.oneOf.filter((x: any) => valid(v, x)).length === 1 &&
      (s.minimum === undefined || Number(v) >= s.minimum) &&
      (s.maximum === undefined || Number(v) <= s.maximum)
    );
  if (s.anyOf) return s.anyOf.some((x: any) => valid(v, x));
  if (s.enum && !s.enum.includes(v)) return false;
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (v === null) return types.includes("null");
  const type = types.find((x: string) => x !== "null");
  if (type === "string")
    return (
      typeof v === "string" &&
      v.length >= (s.minLength ?? 0) &&
      v.length <= (s.maxLength ?? Infinity) &&
      (!s.pattern || new RegExp(s.pattern).test(v))
    );
  if (type === "number" || type === "integer")
    return (
      typeof v === "number" &&
      Number.isFinite(v) &&
      (type !== "integer" || Number.isSafeInteger(v)) &&
      v >= (s.minimum ?? -Infinity) &&
      v <= (s.maximum ?? Infinity)
    );
  if (type === "boolean") return typeof v === "boolean";
  if (type === "array")
    return (
      Array.isArray(v) &&
      v.length >= (s.minItems ?? 0) &&
      v.length <= (s.maxItems ?? Infinity) &&
      v.every((x) => valid(x, s.items))
    );
  if (type === "object")
    return (
      object(v) &&
      (s.required ?? []).every((k: string) => Object.hasOwn(v, k)) &&
      Object.keys(v).every(
        (k) =>
          !["__proto__", "prototype", "constructor"].includes(k) &&
          (Object.hasOwn(s.properties ?? {}, k)
            ? valid(v[k], s.properties[k])
            : s.additionalProperties === true),
      )
    );
  return false;
}
export function linkInput(action: LinkAction, body: Record<string, any>) {
  if (
    !valid(body, schemas[action]) ||
    !uuid(body.operation_id) ||
    (action !== "create" && !revision(body.expected_revision)) ||
    (action === "update" &&
      Object.keys(body).every((k) =>
        ["operation_id", "expected_livemode", "expected_revision"].includes(k),
      ))
  )
    throw new Error(
      "Solicitud de enlace inválida; UUID persistido y revisión actual son obligatorios",
    );
  return body;
}
const configFields = Object.keys(schemas.create.properties).filter(
  (k) => !["operation_id", "expected_livemode"].includes(k),
);
export function safeLink(raw: any, team: string, mode: boolean, id?: string) {
  if (
    !object(raw) ||
    !linkId(raw.id) ||
    raw.team_id !== team ||
    raw.livemode !== mode ||
    (id && raw.id !== id) ||
    !(raw.status === null || typeof raw.status === "string") ||
    !revision(raw.revision) ||
    raw.effect_scope !== "team_mode_payment_link"
  )
    throw new Error("Enlace de pago con alcance o revisión inválidos");
  for (const k of ["amount", "total", "created_at", "updated_at", "deleted_at"])
    if (
      !(
        raw[k] === null ||
        (typeof raw[k] === "number" && Number.isFinite(raw[k]))
      )
    )
      throw new Error("Metadatos de enlace inválidos");
  for (const k of ["url", "short_url", "owner"])
    if (!(raw[k] === null || typeof raw[k] === "string"))
      throw new Error("Metadatos de enlace inválidos");
  for (const k of configFields)
    if (
      Object.hasOwn(raw, k) &&
      !valid(raw[k], (schemas.create.properties as any)[k])
    )
      throw new Error("Configuración de enlace inválida");
  return Object.fromEntries(
    [
      ...configFields,
      "id",
      "team_id",
      "livemode",
      "status",
      "amount",
      "total",
      "url",
      "short_url",
      "owner",
      "created_at",
      "updated_at",
      "deleted_at",
      "revision",
      "effect_scope",
    ]
      .filter((k) => Object.hasOwn(raw, k))
      .map((k) => [k, raw[k]]),
  );
}
export function linkReceipt(
  raw: any,
  team: string,
  mode: boolean,
  operationId: string,
  action?: LinkAction,
  id?: string,
) {
  const o = raw?.operation;
  if (
    !object(o) ||
    o.operation_id !== operationId ||
    !uuid(o.operation_id) ||
    o.team_id !== team ||
    o.livemode !== mode ||
    !["create", "update", "delete"].includes(o.action) ||
    (action && o.action !== action) ||
    !linkId(o.payment_link_id) ||
    (id && o.payment_link_id !== id) ||
    o.status !== "completed" ||
    !Number.isFinite(o.completed_at) ||
    !revision(o.revision) ||
    o.effect_scope !== "team_mode_payment_link" ||
    (action && raw.data === null)
  )
    throw new Error(
      "Recibo inválido; consulta el mismo UUID sin repetir la escritura",
    );
  return {
    data:
      raw.data === null
        ? null
        : safeLink(raw.data, team, mode, o.payment_link_id),
    operation: Object.fromEntries(
      [
        "operation_id",
        "team_id",
        "livemode",
        "action",
        "payment_link_id",
        "status",
        "completed_at",
        "revision",
        "effect_scope",
      ].map((k) => [k, o[k]]),
    ),
  };
}
export function linkSchema(action: string) {
  if (!Object.hasOwn(schemas, action)) throw new Error("Acción inválida");
  const s: any = structuredClone(schemas[action as LinkAction]);
  delete s.properties.expected_livemode;
  s.required = s.required.filter((k: string) => k !== "expected_livemode");
  return s;
}
