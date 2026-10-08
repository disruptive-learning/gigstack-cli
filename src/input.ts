import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { confirm } from "./prompt.js";

export function withJsonInput(command: Command): Command {
  return command.option("--data <json>", "Objeto JSON (usa --file/--stdin para secretos)")
    .option("--file <path>", "Leer objeto JSON de archivo local")
    .option("--stdin", "Leer objeto JSON de stdin");
}

export async function readJsonInput(opts: { data?: string; file?: string; stdin?: boolean }): Promise<Record<string, any>> {
  if ([opts.data !== undefined, opts.file !== undefined, Boolean(opts.stdin)].filter(Boolean).length !== 1) {
    throw new Error("Proporciona exactamente uno de --data, --file o --stdin");
  }
  let text: string;
  if (opts.file) text = await readFile(opts.file, "utf8");
  else if (opts.stdin) {
    if (process.stdin.isTTY) throw new Error("--stdin requiere JSON por una tubería");
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    text = Buffer.concat(chunks).toString("utf8");
  } else text = opts.data!;
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error("Entrada JSON inválida"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("La entrada JSON debe ser un objeto");
  return body as Record<string, any>;
}

export async function requireConfirmation(yes: boolean | undefined, message: string): Promise<void> {
  if (yes) return;
  if (!(await confirm(message, false))) throw Object.assign(new Error("Operación cancelada"), { code: "cancelled" });
}

export const segment = (value: string): string => {
  if (!value.trim() || value === "." || value === ".." || /[\/\\\x00-\x1f]/.test(value)) throw new Error("Identificador inválido");
  return encodeURIComponent(value);
};
