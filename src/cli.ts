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

const program = new Command();

program
  .name("gigstack")
  .description("gigstack CLI — facturación electrónica desde tu terminal")
  .version("0.1.0")
  .option("--json", "Salida en formato JSON")
  .option("--team <id>", "Team ID para operaciones multi-equipo")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.json) setJsonMode(true);
  });

registerAuthCommands(program);
registerClientCommands(program);
registerInvoiceCommands(program);
registerPaymentCommands(program);
registerServiceCommands(program);
registerWebhookCommands(program);
registerTeamCommands(program);
registerReceiptCommands(program);

program.addHelpText("after", `
${pc.bold("Ejemplos:")}
  ${pc.dim("$")} gigstack login                          Autenticarse
  ${pc.dim("$")} gigstack whoami                          Ver cuenta actual
  ${pc.dim("$")} gigstack clients list                    Listar clientes
  ${pc.dim("$")} gigstack clients search "ACME"           Buscar cliente
  ${pc.dim("$")} gigstack invoices list                   Listar facturas
  ${pc.dim("$")} gigstack invoices list --json             Salida JSON
  ${pc.dim("$")} gigstack payments list                   Listar pagos
  ${pc.dim("$")} gigstack services list                   Listar servicios
  ${pc.dim("$")} gigstack webhooks list                   Ver webhooks

${pc.bold("Docs:")} https://docs.gigstack.io
`);

program.parse();
