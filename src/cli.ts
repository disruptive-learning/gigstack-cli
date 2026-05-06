import { Command } from "commander";
import pc from "picocolors";
import { setJsonMode } from "./output.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerClientCommands } from "./commands/clients.js";
import { registerInvoiceCommands } from "./commands/invoices.js";
import { registerPaymentCommands } from "./commands/payments.js";
import { registerServiceCommands } from "./commands/services.js";
import { registerWebhookCommands } from "./commands/webhooks.js";
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

declare const __PKG_VERSION__: string;

const program = new Command();

program
  .name("gigstack")
  .description("gigstack CLI — facturación electrónica desde tu terminal")
  .version(__PKG_VERSION__)
  .option("--json", "Salida en formato JSON")
  .option("--team <id>", "Team ID para operaciones multi-equipo")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.json) setJsonMode(true);
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
  ${pc.dim("$")} gigstack payments list                   Listar pagos
  ${pc.dim("$")} gigstack services list                   Listar servicios
  ${pc.dim("$")} gigstack export invoices --from 2026-01  Exportar facturas a CSV
  ${pc.dim("$")} gigstack export payments --format json   Exportar pagos a JSON
  ${pc.dim("$")} gigstack explain <id>                    Explicar cualquier recurso

${pc.bold("Docs:")} https://docs.gigstack.io
`);

program.parse();
