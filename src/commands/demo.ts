import { Command } from "commander";
import { describeDemoError, runDemoInvoice } from "../demo.js";
import { error } from "../output.js";

export function registerDemoCommand(program: Command) {
  program
    .command("demo")
    .description("Emitir una factura de PRUEBA a PUBLICO EN GENERAL (solo con llave de prueba) y ver cómo activar producción")
    .option("-p, --profile <name>", "Perfil de prueba a usar (por defecto el activo)")
    .action(async (opts) => {
      try { await runDemoInvoice({ profile: opts.profile }); }
      catch (e) { error(describeDemoError(e)); }
    });
}
