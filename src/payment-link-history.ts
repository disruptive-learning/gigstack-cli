import {
  publicHistoricalDocument,
  projectHistoricalContract,
} from "./history-contract.js";
import contracts from "./history-response.schema.json";
export type HistoricalDocument = {
  resource_type: "invoices" | "receipts";
  resource_id: string;
  team_id: string;
  livemode: boolean;
  storage_project_id: string;
  file_status: {
    pdf: "available" | "unavailable";
    xml: "available" | "unavailable";
  };
  document: Record<string, any> & {
    id: string;
    files: { pdf: string | null; xml: string | null };
  };
};
export type HistoricalFile = {
  resource_type: "invoices" | "receipts";
  resource_id: string;
  team_id: string;
  livemode: boolean;
  storage_project_id: string;
  available: boolean;
  file: {
    kind: "pdf" | "xml";
    filename: string;
    type: "application/pdf" | "application/xml";
    content: string;
    size_bytes: number;
  } | null;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const identifiers = (v: unknown) =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(v);
function scope(
  value: unknown,
  team: string,
  mode: boolean,
  kind: string,
  id: string,
) {
  if (
    !object(value) ||
    !["invoices", "receipts"].includes(kind) ||
    !identifiers(id) ||
    value.resource_type !== kind ||
    value.resource_id !== id ||
    value.team_id !== team ||
    value.livemode !== mode ||
    typeof value.storage_project_id !== "string" ||
    !/^[a-z][a-z0-9-]{4,62}$/.test(value.storage_project_id)
  )
    throw new Error("Historical document scope mismatch");
  return value;
}
function fileUrl(
  value: unknown,
  team: string,
  project: string,
  extension: "pdf" | "xml",
) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 4096)
    throw new Error("Historical document file URL invalid");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error("Historical document file URL invalid");
  let path: string;
  const buckets = [`${project}.appspot.com`, `${project}.firebasestorage.app`];
  if (url.hostname === "storage.googleapis.com") {
    const parts = url.pathname.slice(1).split("/");
    if (!buckets.includes(parts.shift() ?? ""))
      throw new Error("Historical document file URL invalid");
    path = decodeURIComponent(parts.join("/"));
  } else if (url.hostname === "firebasestorage.googleapis.com") {
    const match = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname);
    if (!match || !buckets.includes(match[1]))
      throw new Error("Historical document file URL invalid");
    path = decodeURIComponent(match[2]);
  } else throw new Error("Historical document file URL invalid");
  if (
    !path.startsWith(`teams/${team}/files/`) ||
    path.split("/").some((part) => part === "." || part === "..") ||
    !path.endsWith(`.${extension}`)
  )
    throw new Error("Historical document file URL invalid");
  return url.toString();
}
export function safeHistoricalDocument(
  value: unknown,
  team: string,
  mode: boolean,
  kind: string,
  id: string,
): HistoricalDocument {
  const raw = scope(value, team, mode, kind, id);
  const document = publicHistoricalDocument(
    raw.document,
    kind as "invoices" | "receipts",
  );
  if (
    document.id !== id ||
    document.team !== team ||
    document.livemode !== mode ||
    !object(document.files)
  )
    throw new Error("Historical document scope mismatch");
  document.files = {
    pdf: fileUrl(
      document.files.pdf,
      team,
      String(raw.storage_project_id),
      "pdf",
    ),
    xml: fileUrl(
      document.files.xml,
      team,
      String(raw.storage_project_id),
      "xml",
    ),
  };
  const statuses = raw.file_status;
  if (
    !object(statuses) ||
    !["available", "unavailable"].includes(String(statuses.pdf)) ||
    !["available", "unavailable"].includes(String(statuses.xml))
  )
    throw new Error("Historical document file status invalid");
  return {
    resource_type: kind as "invoices" | "receipts",
    resource_id: id,
    team_id: team,
    livemode: mode,
    storage_project_id: String(raw.storage_project_id),
    file_status: {
      pdf: statuses.pdf as "available" | "unavailable",
      xml: statuses.xml as "available" | "unavailable",
    },
    document: document as HistoricalDocument["document"],
  };
}
export function safeHistoricalFile(
  value: unknown,
  team: string,
  mode: boolean,
  kind: string,
  id: string,
  fileKind: "pdf" | "xml",
): HistoricalFile {
  const raw = scope(value, team, mode, kind, id);
  const result = projectHistoricalContract(
    raw,
    contracts.fileEnvelope,
  ) as HistoricalFile;
  if (result.available !== (result.file !== null))
    throw new Error("Historical file availability mismatch");
  if (
    result.file &&
    (result.file.kind !== fileKind ||
      result.file.filename !== `${id}.${fileKind}` ||
      result.file.type !==
        (fileKind === "pdf" ? "application/pdf" : "application/xml") ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        result.file.content,
      ) ||
      result.file.size_bytes !==
        Math.floor((result.file.content.length * 3) / 4) -
          (result.file.content.endsWith("==")
            ? 2
            : result.file.content.endsWith("=")
              ? 1
              : 0))
  )
    throw new Error("Historical file identity or byte shape mismatch");
  return result;
}
