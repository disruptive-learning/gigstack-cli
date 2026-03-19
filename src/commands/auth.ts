import { Command } from "commander";
import pc from "picocolors";
import { saveProfile, removeProfile, switchProfile, getActiveProfile, listProfiles } from "../config.js";
import { api } from "../api.js";
import { success, error, printKeyValue } from "../output.js";
import { createInterface } from "node:readline";

function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) process.stdout.write(question);
    else rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
    if (hidden) {
      process.stdin.setRawMode?.(true);
      let input = "";
      const onData = (ch: Buffer) => {
        const c = ch.toString();
        if (c === "\n" || c === "\r") {
          process.stdin.setRawMode?.(false);
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(input.trim());
        } else if (c === "\u007f") {
          input = input.slice(0, -1);
        } else {
          input += c;
        }
      };
      process.stdin.on("data", onData);
    }
  });
}

export function registerAuthCommands(program: Command) {
  program
    .command("login")
    .description("Autenticarse con tu API key de gigstack")
    .option("-k, --api-key <key>", "API key (o se pedirá interactivamente)")
    .option("-p, --profile <name>", "Nombre del perfil", "default")
    .action(async (opts) => {
      let apiKey = opts.apiKey || process.env.GIGSTACK_API_KEY;
      if (!apiKey) {
        apiKey = await prompt("API Key: ", true);
      }
      if (!apiKey) { error("API key requerida"); process.exit(1); }

      try {
        const res = await api("GET", "/teams", { apiKey });
        const teams = res.data || [];
        const team = teams[0];
        saveProfile(opts.profile, apiKey, "production");
        success(`Autenticado como ${pc.bold(team?.legal_name || team?.name || "equipo gigstack")}`);
        console.log(pc.dim(`Perfil "${opts.profile}" guardado en ~/.config/gigstack/credentials.json`));
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
          RFC: team?.tax_id || "—",
          Nombre: team?.legal_name || team?.name || "—",
          "API Key": profile.apiKey.slice(0, 8) + "..." + profile.apiKey.slice(-4),
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
