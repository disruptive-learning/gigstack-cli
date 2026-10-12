/** Validate and allowlist the authoritative Airtable result DTO before printing. */
type Shape =
  | "string"
  | "number"
  | "boolean"
  | { nullable: Shape }
  | { optional: Shape }
  | { enum: readonly unknown[] }
  | { array: Shape }
  | { record: Shape }
  | { fields: Record<string, Shape> };
const object = (fields: Record<string, Shape>): Shape => ({ fields });
const nullable = (value: Shape): Shape => ({ nullable: value });
const optional = (value: Shape): Shape => ({ optional: value });
const enumeration = (...values: unknown[]): Shape => ({ enum: values });
const string: Shape = "string",
  number: Shape = "number",
  boolean: Shape = "boolean";
function parse(value: unknown, shape: Shape): any {
  const invalid = () => {
    throw Object.assign(
      new Error(
        "Respuesta Airtable inválida; no se confirmó la operación. Consulta el mismo UUID antes de otra acción.",
      ),
      { code: "invalid_airtable_response" },
    );
  };
  if (typeof shape === "string") {
    if (
      typeof value !== shape ||
      (shape === "number" &&
        (!Number.isSafeInteger(value) || Number(value) < 0))
    )
      return invalid();
    return value;
  }
  if ("nullable" in shape)
    return value === null ? null : parse(value, shape.nullable);
  if ("optional" in shape)
    return value === undefined ? undefined : parse(value, shape.optional);
  if ("enum" in shape) return shape.enum.includes(value) ? value : invalid();
  if ("array" in shape)
    return Array.isArray(value)
      ? value.map((item) => parse(item, shape.array))
      : invalid();
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const record = value as Record<string, unknown>;
  if ("record" in shape)
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => {
        if (["__proto__", "constructor", "prototype"].includes(key))
          return invalid();
        return [key, parse(item, shape.record)];
      }),
    );
  return Object.fromEntries(
    Object.entries(shape.fields)
      .map(([key, child]) => [key, parse(record[key], child)])
      .filter(([, item]) => item !== undefined),
  );
}
const text = nullable(string),
  time = nullable(number),
  identity = enumeration("same", "different", "unverified");
const paging = { has_more: boolean, next_cursor: text };
const webhook = object({
  id: string,
  base_id: text,
  table_id: text,
  table_name: text,
  field_map: { record: string },
  mapping_valid: boolean,
  mapping_config: object({
    currencyDefault: optional(string),
    paymentFormDefault: optional(string),
    statusDefault: optional(string),
    defaultClientEmail: optional(string),
  }),
  livemode: nullable(boolean),
  status: enumeration("active", "expired", "disabled", "unknown"),
  created_at: time,
  expires_at: time,
  last_notification_at: time,
  last_error_at: time,
});
const operation = object({
  id: string,
  team_id: string,
  action: enumeration("register", "unregister", "disconnect"),
  livemode: boolean,
  effect_scope: enumeration("mode", "shared_connection"),
  status: enumeration("processing", "completed", "failed", "outcome_unknown"),
  created_at: number,
  updated_at: number,
  snapshot_complete: boolean,
  target_count: number,
  processed_count: number,
  local_disabled_count: number,
  remote_deleted_count: number,
  unknown_count: number,
  error_code: text,
  webhook_id: text,
  recovery_operation_id: text,
  cleanup_operation_id: text,
  recovery_session_id: text,
  provider_environment: enumeration("production"),
  oauth_credentials_retained: enumeration(true),
  continuation_required: boolean,
  partial_cleanup: boolean,
  targets: object({
    ...paging,
    data: {
      array: object({
        id: string,
        base_id: text,
        local_disabled: boolean,
        remote_status: enumeration("not_attempted", "unknown", "deleted"),
      }),
    },
  }),
  webhook: optional(webhook),
});
const page = {
  ...paging,
  provider_environment: enumeration("production"),
  effect_scope: enumeration("shared_connection"),
};
const schemas: Record<string, Shape> = {
  bases: object({
    ...page,
    data: {
      array: object({ id: string, name: string, permission_level: string }),
    },
  }),
  tables: object({
    ...page,
    data: {
      array: object({
        id: string,
        name: string,
        primary_field_id: text,
        fields: { array: object({ id: string, name: string, type: string }) },
      }),
    },
  }),
  remote: object({
    ...page,
    data: {
      array: object({
        id: string,
        notifications_enabled: boolean,
        enabled: boolean,
        expires_at: time,
        local_match: boolean,
      }),
    },
  }),
  webhooks: object({
    ...paging,
    provider_environment: enumeration("production"),
    scope: enumeration("mode", "shared_connection"),
    livemode: nullable(boolean),
    can_manage: boolean,
    can_recover_registration: boolean,
    blocking_operation_id: text,
    connection: object({
      connected: boolean,
      effect_scope: enumeration("shared_connection"),
      oauth_credentials_retained: enumeration(true),
      restricted: boolean,
      recovery_session_id: text,
      identity_verification: nullable(identity),
    }),
    data: { array: webhook },
  }),
  register: operation,
  unregister: operation,
  disconnect: operation,
  operation,
  reconcile: operation,
};
export function airtableOutput(
  action: string,
  value: unknown,
): Record<string, any> {
  return parse(value, schemas[action]);
}
export function airtableTimestamp(value: unknown): number | undefined {
  return value === undefined ? undefined : parse(value, number);
}
