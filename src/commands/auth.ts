import { Command } from "commander";
import pc from "picocolors";
import { saveProfile, removeProfile, switchProfile, getActiveProfile, listProfiles, isTestKey } from "../config.js";
import { api } from "../api.js";
import { success, error, printKeyValue } from "../output.js";
import { askHidden } from "../prompt.js";

export function registerAuthCommands(program: Command) {
  program
    .command("login")
    .description("Autenticarse con tu API key de gigstack")
    .option("-k, --api-key <key>", "API key (o se pedirá interactivamente)")
    .option("-p, --profile <name>", "Nombre del perfil", "default")
    .action(async (opts) => {
      let apiKey = opts.apiKey || process.env.GIGSTACK_API_KEY;
      if (!apiKey) {
        console.log(pc.dim("Obtén tu API key en: app.gigstack.pro/settings → API\n"));
        apiKey = await askHidden("API Key");
      }
      if (!apiKey) { error("API key requerida"); process.exit(1); }

      try {
        const res = await api("GET", "/teams", { apiKey });
        const teams = res.data || [];
        const team = teams[0];
        const isTest = isTestKey(apiKey);
        saveProfile(opts.profile, apiKey, isTest ? "test" : "production");
        success(`Autenticado como ${pc.bold(team?.legal_name || team?.brand?.alias || "equipo gigstack")}`);
        if (isTest) console.log(pc.yellow("  Modo prueba (test key)"));
        console.log(pc.dim(`  Perfil "${opts.profile}" guardado en ~/.config/gigstack/credentials.json`));
      } catch (e: any) {
        error(`Error de autenticación: ${e.message}`);
        process.exit(1);
      }
    });

  program
    .command("logout")
    .description("Eliminar credenciales")
    .option("-p, --profile <name>", "Perfil a eliminar", "default")
    .action((opts) => {
      removeProfile(opts.profile);
      success(`Perfil "${opts.profile}" eliminado`);
    });

  program
    .command("whoami")
    .description("Mostrar perfil y cuenta actual")
    .action(async () => {
      const profile = getActiveProfile();
      if (!profile) { error("No autenticado. Ejecuta: gigstack login"); process.exit(1); }

      try {
        const res = await api("GET", "/teams");
        const teams = res.data || [];
        const team = teams[0];
        printKeyValue({
          Perfil: profile.name,
          Modo: isTestKey(profile.apiKey) ? pc.yellow("test") : pc.green("producción"),
          RFC: team?.tax_id || pc.dim("no configurado"),
          Nombre: team?.legal_name || team?.brand?.alias || "—",
          SAT: team?.sat?.completed ? pc.green("conectado") : pc.red("no conectado"),
          "API Key": profile.apiKey.slice(0, 12) + "..." + profile.apiKey.slice(-4),
        });
      } catch (e: any) {
        error(e.message);
      }
    });

  program
    .command("switch <profile>")
    .description("Cambiar perfil activo")
    .action((name) => {
      if (switchProfile(name)) {
        success(`Perfil activo: ${name}`);
      } else {
        error(`Perfil "${name}" no encontrado`);
        const profiles = listProfiles();
        if (profiles.length) {
          console.log(pc.dim("Perfiles disponibles: " + profiles.map((p) => p.name).join(", ")));
        }
      }
    });

  program
    .command("profiles")
    .description("Listar perfiles guardados")
    .action(() => {
      const profiles = listProfiles();
      if (!profiles.length) { console.log(pc.dim("Sin perfiles. Ejecuta: gigstack login")); return; }
      for (const p of profiles) {
        console.log(`${p.active ? pc.green("●") : pc.dim("○")} ${p.name}`);
      }
    });
}
