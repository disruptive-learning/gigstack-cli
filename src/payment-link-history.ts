export type HistoricalDocument = {
  resource_type: "invoices" | "receipts";
  resource_id: string;
  team_id: string;
  livemode: boolean;
  document: Record<string, any> & {
    id: string;
    files: { pdf: string | null; xml: string | null };
  };
};
const identifiers = (v: unknown) =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(v);
export function safeHistoricalDocument(
  value: any,
  team: string,
  mode: boolean,
  kind: string,
  id: string,
): HistoricalDocument {
  const row = value?.document;
  if (
    !["invoices", "receipts"].includes(kind) ||
    !identifiers(id) ||
    value?.resource_type !== kind ||
    value.resource_id !== id ||
    value.team_id !== team ||
    value.livemode !== mode ||
    !row ||
    row.id !== id ||
    row.team !== team ||
    row.livemode !== mode
  )
    throw new Error("Historical document scope mismatch");
  const document: HistoricalDocument["document"] = {
    id,
    files: { pdf: null, xml: null },
  };
  const scalar = (v: any) =>
    v === null ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    (typeof v === "number" && Number.isFinite(v));
  for (const key of [
    "uuid",
    "status",
    "currency",
    "exchange_rate",
    "total",
    "subtotal",
    "discount",
    "taxes",
    "withholding_taxes",
    "created_at",
    "date",
    "series",
    "folio_number",
    "invoice_type",
    "use",
    "payment_form",
    "payment_method",
    "from",
    "team",
    "livemode",
    "owner",
    "valid_until",
    "last_balance",
    "installments",
    "total_refunded",
    "automatic_invoice_error",
  ])
    if (Object.hasOwn(row, key) && scalar(row[key])) document[key] = row[key];
  if (
    row.client &&
    typeof row.client === "object" &&
    !Array.isArray(row.client)
  ) {
    document.client = {};
    for (const key of [
      "id",
      "name",
      "legal_name",
      "rfc",
      "tax_system",
      "email",
      "address",
      "zip",
    ])
      if (Object.hasOwn(row.client, key) && scalar(row.client[key]))
        document.client[key] = row.client[key];
  } else document.client = null;
  document.items = Array.isArray(row.items)
    ? row.items
        .filter(
          (item: any) =>
            item && typeof item === "object" && !Array.isArray(item),
        )
        .map((item: any) =>
          Object.fromEntries(
            [
              "id",
              "description",
              "name",
              "quantity",
              "unit_price",
              "price",
              "discount",
              "sku",
              "product_key",
              "unit_key",
              "unit_name",
              "taxability",
            ]
              .filter((key) => Object.hasOwn(item, key) && scalar(item[key]))
              .map((key) => [key, item[key]]),
          ),
        )
    : [];
  for (const extension of ["pdf", "xml"] as const) {
    const value = row.files?.[extension];
    if (value === null || value === undefined) continue;
    if (typeof value !== "string" || value.length > 4096)
      throw new Error("Historical document file URL invalid");
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Historical document file URL invalid");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !["storage.googleapis.com", "firebasestorage.googleapis.com"].includes(
        url.hostname,
      )
    )
      throw new Error("Historical document file URL invalid");
    let path: string;
    if (url.hostname === "storage.googleapis.com") {
      const parts = url.pathname.slice(1).split("/");
      if (
        !/^gigstackpro(?:dev)?\.(?:appspot\.com|firebasestorage\.app)$/.test(
          parts.shift() ?? "",
        )
      )
        throw new Error("Historical document file URL invalid");
      path = decodeURIComponent(parts.join("/"));
    } else {
      const match =
        /^\/v0\/b\/(gigstackpro(?:dev)?\.(?:appspot\.com|firebasestorage\.app))\/o\/(.+)$/.exec(
          url.pathname,
        );
      if (!match) throw new Error("Historical document file URL invalid");
      path = decodeURIComponent(match[2]);
    }
    if (
      !path.startsWith(`teams/${team}/files/`) ||
      path.split("/").some((part) => part === "." || part === "..") ||
      !path.endsWith(`.${extension}`)
    )
      throw new Error("Historical document file URL invalid");
    document.files[extension] = url.toString();
  }
  return {
    resource_type: kind as "invoices" | "receipts",
    resource_id: id,
    team_id: team,
    livemode: mode,
    document,
  };
}
