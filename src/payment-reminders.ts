import schemas from "./contracts/payment-reminder-request.schema.json";
export const reminderIdentifier = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(v);
export const reminderUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    v,
  );
const object = (v: any): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const revision = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
function valid(v: any, s: any): boolean {
  if (v === null && s.nullable === true) return true;
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
export function reminderInput(
  action: keyof typeof schemas,
  body: Record<string, any>,
) {
  if (!valid(body, schemas[action]))
    throw new Error(
      "Entrada de recordatorios inválida; conserva UUIDv4 y revisión antes de enviar",
    );
  return body;
}
export const reminderSchema = (action: keyof typeof schemas) => {
 const schema = structuredClone(schemas[action]);
 delete (schema.properties as Record<string,unknown>).expected_livemode;
 schema.required = schema.required.filter((name) => name !== 'expected_livemode');
 return schema;
};
const pick = (value: Record<string, any>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => k in value).map((k) => [k, value[k]]));
export function safeReminderConfig(
  raw: any,
  team: string,
  mode: boolean,
  payment: string,
) {
  if (
    !object(raw) ||
    raw.team_id !== team ||
    raw.livemode !== mode ||
    raw.payment_id !== payment ||
    !revision(raw.revision) ||
    !Array.isArray(raw.reminders) ||
    raw.effect_scope !== "payment_mode_reminders" ||
    typeof raw.legacy_defaults_eligible !== "boolean" ||
    !(
      raw.blocking_operation_id === null ||
      reminderUuid(raw.blocking_operation_id)
    )
  )
    throw new Error(
      "Configuración de recordatorios fuera del ámbito seleccionado",
    );
  if (typeof raw.status !== 'string' || ![raw.limitDaysToPay,raw.limitDateToPay].every((v) => v === null || (typeof v === 'number' && Number.isFinite(v))) || raw.reminders.length > 100) throw new Error('Estado de calendario inválido');
  return {
    ...pick(raw, [
      "payment_id",
      "team_id",
      "livemode",
      "revision",
      "status",
      "limitDaysToPay",
      "limitDateToPay",
      "effect_scope",
      "legacy_defaults_eligible",
      "blocking_operation_id",
    ]),
    reminders: raw.reminders.map((r: any) => {
      if (!object(r) || !reminderIdentifier(r.id))
        throw new Error("Recordatorio inválido");
      const core = pick(r,['id','type','when','duration','periodicity','custom_subject','custom_template']);
      if (!valid(core,schemas.configure.properties.reminders.items) || typeof r.sent !== 'boolean' || !Number.isSafeInteger(r.reminder_sended) || r.reminder_sended < 0 || typeof r.queue_state !== 'string' || !(r.generation === null || revision(r.generation)) || ![r.exec_timestamp,r.last_runned,r.last_execution,r.next_wakeup_at].every((v) => v === null || (typeof v === 'number' && Number.isFinite(v))) || !(r.active_occurrence === null || typeof r.active_occurrence === 'string')) throw new Error('Estado de recordatorio inválido');
      return pick(r, [
        "id",
        "type",
        "when",
        "duration",
        "periodicity",
        "custom_subject",
        "custom_template",
        "exec_timestamp",
        "sent",
        "reminder_sended",
        "last_runned",
        "last_execution",
        "generation",
        "queue_state",
        "next_wakeup_at",
        "active_occurrence",
      ]);
    }),
  };
}
export function safeReminderResult(
  raw: any,
  team: string,
  mode: boolean,
  payment: string,
  uuid: string,
) {
  const op = raw?.operation;
  if (
    !object(op) ||
    op.operation_id !== uuid ||
    op.payment_id !== payment ||
    op.team_id !== team ||
    op.livemode !== mode ||
    !["processing", "completed", "partial", "outcome_unknown"].includes(
      op.status,
    ) ||
    !Array.isArray(op.steps) ||
    !Array.isArray(op.affected_generations)
  )
    throw new Error(
      "Referencia de recordatorios fuera del ámbito seleccionado",
    );
  return {
    configuration: safeReminderConfig(raw.configuration, team, mode, payment),
    operation: {
      ...pick(op, [
        "operation_id",
        "payment_id",
        "team_id",
        "livemode",
        "status",
        "superseded_by",
        "effect_scope",
      ]),
      affected_generations: op.affected_generations.map((g: any) => {
        if (
          !object(g) ||
          !reminderIdentifier(g.reminder_id) ||
          !revision(g.generation)
        )
          throw new Error("Generación inválida");
        return pick(g, ["reminder_id", "generation"]);
      }),
      steps: op.steps.map((s: any) => {
        if (!object(s) || !reminderIdentifier(s.reminder_id) || !revision(s.generation) || !['create','delete','adopt'].includes(s.action) || !['pending','attempting','confirmed','failed','outcome_unknown'].includes(s.status) || !(s.error === undefined || s.error === null || (typeof s.error === 'string' && /^[a-z_]{1,100}$/.test(s.error)))) throw new Error("Paso inválido");
        return pick(s, [
          "reminder_id",
          "generation",
          "action",
          "status",
          "attempted_at",
          "error",
        ]);
      }),
    },
  };
}
export function safeReminderPrepared(
  raw: any,
  team: string,
  mode: boolean,
  payment: string,
  uuid: string,
) {
  const expected = `/account/payment-reminders/${encodeURIComponent(payment)}/recovery/${uuid}?team=${encodeURIComponent(team)}&livemode=${mode}`;
  if (
    !object(raw) ||
    raw.operation_id !== uuid ||
    raw.payment_id !== payment ||
    raw.team_id !== team ||
    raw.livemode !== mode ||
    raw.review_url !== expected ||
    raw.duplicate_email_possible !== true ||
    !revision(raw.review_version)
  )
    throw new Error("Revisión privada inválida");
  return pick(raw, [
    "operation_id",
    "supersedes_operation_id",
    "payment_id",
    "team_id",
    "livemode",
    "expected_revision",
    "review_version",
    "expires_at",
    "status",
    "duplicate_email_possible",
    "review_url",
  ]);
}
