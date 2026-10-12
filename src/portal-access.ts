export type PortalFamily = "customer" | "invoices";
const id = /^[A-Za-z0-9_-]{1,128}$/;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function portalUuid(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value))
    throw new Error("Guarda operation_id UUIDv4 antes de enviar");
  return value;
}
export function safePortalOperation(
  value: unknown,
  family: PortalFamily,
  team: string,
  mode: boolean,
  operationId: string,
) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Operación de portal inválida");
  const data = value as Record<string, any>;
  const scopes =
    family === "customer"
      ? ["customer:read", "customer:update", "files:download", "session:renew"]
      : ["invoices:read"];
  const effects =
    family === "customer"
      ? [
          "customer_data_read",
          "customer_data_update",
          "invoice_receipt_payment_read",
          "file_download_or_render",
          "session_validation",
        ]
      : ["invoice_read", "invoice_file_download"];
  const timestamp = (v: unknown) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  if (
    data.operation_id !== portalUuid(operationId) ||
    data.family !== family ||
    data.team_id !== team ||
    !id.test(team) ||
    data.livemode !== mode ||
    data.secret_available !== false ||
    ![
      "prepared",
      "outcome_unknown",
      "completed",
      "cancelled",
      "revoked",
    ].includes(data.status) ||
    !timestamp(data.created_at) ||
    !timestamp(data.preparation_expires_at) ||
    !(data.expires_at === null || timestamp(data.expires_at)) ||
    !(
      data.replaces_operation_id === null ||
      (typeof data.replaces_operation_id === "string" &&
        uuid.test(data.replaces_operation_id))
    ) ||
    !["read_current_operation", "first_response_secret_not_replayed"].includes(
      data.recovery,
    ) ||
    JSON.stringify(data.scopes) !== JSON.stringify(scopes) ||
    JSON.stringify(data.effects) !== JSON.stringify(effects) ||
    (family === "customer"
      ? typeof data.client_id !== "string" ||
        !id.test(data.client_id) ||
        data.access_lifetime_seconds !== 432000 ||
        data.exchanged_session_lifetime_seconds !== 259200
      : data.client_id !== null ||
        !Number.isSafeInteger(data.access_lifetime_seconds) ||
        data.access_lifetime_seconds < 1 ||
        data.access_lifetime_seconds > 86400 ||
        data.exchanged_session_lifetime_seconds !== null)
  )
    throw new Error("Identidad o alcance de portal cambió");
  if (
    !data.browser_handoff ||
    data.browser_handoff.kind !== "private_browser_review" ||
    typeof data.browser_handoff.url !== "string"
  )
    throw new Error("Enlace privado inválido");
  const url = new URL(data.browser_handoff.url);
  if (
    url.username ||
    url.password ||
    url.hash ||
    !(
      [
        "https://app.gigstack.pro",
        "https://alphav2-staging.web.app",
        "https://alphav2-staging.firebaseapp.com",
      ].includes(url.origin) ||
      (["localhost", "127.0.0.1"].includes(url.hostname) &&
        ["http:", "https:"].includes(url.protocol))
    ) ||
    url.pathname !== `/account/portal-access/${family}/${operationId}` ||
    url.searchParams.getAll("team").length !== 1 ||
    url.searchParams.get("team") !== team ||
    [...url.searchParams.keys()].some((k) => k !== "team")
  )
    throw new Error("Enlace privado inválido");
  return Object.fromEntries(
    [
      "operation_id",
      "family",
      "team_id",
      "client_id",
      "replaces_operation_id",
      "livemode",
      "status",
      "created_at",
      "preparation_expires_at",
      "expires_at",
      "access_lifetime_seconds",
      "exchanged_session_lifetime_seconds",
      "scopes",
      "effects",
      "secret_available",
      "recovery",
    ]
      .map((k) => [k, data[k]])
      .concat([
        [
          "browser_handoff",
          { kind: "private_browser_review", url: url.toString() },
        ],
      ]),
  );
}
