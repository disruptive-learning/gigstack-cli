import { Command } from "commander";
import pc from "picocolors";
import { setJsonMode, error, finishOutput } from "./output.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerClientCommands } from "./commands/clients.js";
import { registerInvoiceCommands } from "./commands/invoices.js";
import { registerPaymentCommands } from "./commands/payments.js";
import { registerServiceCommands } from "./commands/services.js";
import { registerWebhookCommands } from "./commands/webhooks.js";
import { registerDocumentCommands } from "./commands/documents.js";
import { registerEmailDomainCommands } from "./commands/email-domain.js";
import { registerBrandingCommands } from "./commands/branding.js";
import { registerBillingCommands } from "./commands/billing.js";
import { registerIntegrationCommands } from "./commands/integrations.js";
import { registerCredentialCommands } from "./commands/credentials.js";
import { registerSelfCommands } from "./commands/self.js";
import { registerAutomationCommands } from "./commands/automation.js";
import { registerUserCommands } from "./commands/users.js";
import { registerTeamCommands } from "./commands/teams.js";
import { registerReceiptCommands } from "./commands/receipts.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerPayCommand } from "./commands/pay.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerContextCommand } from "./commands/context.js";
import { registerCompletionsCommand } from "./commands/completions.js";
import { registerExportCommand } from "./commands/export.js";
import { registerExplainCommand } from "./commands/explain.js";
import { registerForecastCommand } from "./commands/forecast.js";

import { configureRuntime, apiBaseUrl } from "./runtime.js";

declare const __PKG_VERSION__: string;

const program = new Command();
setJsonMode(process.argv.includes("--json"));

program
  .name("gigstack")
  .description("gigstack CLI — facturación electrónica desde tu terminal")
  .version(__PKG_VERSION__)
  .option("--json", "Salida en formato JSON")
  .option("--team <id>", "Team ID para operaciones multi-equipo")
  .option("--base-url <url>", "URL base del API, incluyendo /v2 (o GIGSTACK_API_BASE_URL)")
  .exitOverride()
  .configureOutput({ writeErr: () => {} })
  .hook("preAction", (_thisCommand, actionCommand) => {
    const opts = actionCommand.optsWithGlobals();
    setJsonMode(Boolean(opts.json));
    configureRuntime({ team: opts.team, baseUrl: opts.baseUrl });
    apiBaseUrl();
  });

registerAuthCommands(program);
registerContextCommand(program);
registerStatusCommand(program);
registerDoctorCommand(program);
registerPayCommand(program);
registerClientCommands(program);
registerInvoiceCommands(program);
registerPaymentCommands(program);
registerServiceCommands(program);
registerWebhookCommands(program);
registerTeamCommands(program);
registerUserCommands(program);
registerAutomationCommands(program);
registerCredentialCommands(program);
registerIntegrationCommands(program);
registerBillingCommands(program);
registerBrandingCommands(program);
registerEmailDomainCommands(program);
registerDocumentCommands(program);
registerSelfCommands(program);
registerReceiptCommands(program);
registerCompletionsCommand(program);
registerExportCommand(program);
registerExplainCommand(program);
registerForecastCommand(program);

program.addHelpText("after", `
${pc.bold("Ejemplos:")}
  ${pc.dim("$")} gigstack login                          Autenticarse
  ${pc.dim("$")} gigstack context payments               Entender pagos (para agentes)
  ${pc.dim("$")} gigstack status                         Resumen rápido del equipo
  ${pc.dim("$")} gigstack doctor                         Diagnóstico completo
  ${pc.dim("$")} gigstack pay                             Registrar pago + autofactura
  ${pc.dim("$")} gigstack whoami                          Ver cuenta actual
  ${pc.dim("$")} gigstack clients list                    Listar clientes
  ${pc.dim("$")} gigstack clients create                  Crear cliente (interactivo)
  ${pc.dim("$")} gigstack invoices list                   Listar facturas
  ${pc.dim("$")} gigstack invoices create                 Crear factura (interactivo)
  ${pc.dim("$")} gigstack invoices list --json             Salida JSON
  ${pc.dim("$")} gigstack invoices sat status             Estado de Descarga Masiva SAT
  ${pc.dim("$")} gigstack invoices sat list --from 30d    Facturas recibidas del SAT
  ${pc.dim("$")} gigstack invoices sat activate           Contratar Descarga Masiva SAT
  ${pc.dim("$")} gigstack payments list                   Listar pagos
  ${pc.dim("$")} gigstack services list                   Listar servicios
  ${pc.dim("$")} gigstack export invoices --from 2026-01  Exportar facturas a CSV
  ${pc.dim("$")} gigstack export payments --format json   Exportar pagos a JSON
  ${pc.dim("$")} gigstack explain <id>                    Explicar cualquier recurso

${pc.bold("Docs:")} https://docs.gigstack.io
`);

try {
  await program.parseAsync();
  finishOutput();
} catch (e: any) {
  if (e.exitCode !== 0) error(e);
}
