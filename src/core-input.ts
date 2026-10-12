import type { Command } from "commander";
import { api } from "./api.js";
import { readJsonInput, requireConfirmation, withJsonInput } from "./input.js";
import { printJson } from "./output.js";

export const hasJsonInput = (opts: any): boolean => opts.data !== undefined || opts.file !== undefined || opts.stdin === true;
/** Full bodies are sent unchanged to the named endpoint's authoritative validator. */
export async function completeBody(opts: any, command: Command): Promise<Record<string, any>> {
  const allowed = new Set(["data", "file", "stdin", "yes", "team", "json", "baseUrl"]);
  for (const key of Object.keys(command.opts())) {
    if (!allowed.has(key) && command.getOptionValueSource(key) === "cli") {
      throw new Error("Use JSON input or field flags, not both; the JSON body is sent unchanged");
    }
  }
  return readJsonInput(opts);
}
export async function sendCompleteBody(command: Command, opts: any, method: string, path: string): Promise<void> {
  const body = await completeBody(opts, command);
  await requireConfirmation(opts.yes, "Apply this request in the selected team and credential mode? It may issue documents, charge or send email according to the supplied fields.");
  printJson(await api(method, path, { body, team: opts.team }));
}
export function withCompleteBody(command: Command): Command {
  return withJsonInput(command).option("-y, --yes", "Confirm the request and its supplied automation/delivery choices");
}
