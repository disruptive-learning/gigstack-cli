import { Command } from "commander";
import pc from "picocolors";
import { api } from "../api.js";
import { getActiveProfile, listProfiles, isTestKey } from "../config.js";
import { formatDate } from "../output.js";

function pass(msg: string) { console.log(pc.green(`  ✓ ${msg}`)); }
function fail(msg: string) { console.log(pc.red(`  ✗ ${msg}`)); }
function info(msg: string) { console.log(pc.dim(`    ${msg}`)); }
function warn(msg: string) { console.log(pc.yellow(`  ! ${msg}`)); }

export function registerDoctorCommand(program: Command) {
  program
    .command("doctor")
    .description("Diagnóstico del CLI: verifica auth, conexión, SAT y configuración")
    .action(async () => {
      console.log(pc.bold("\ngigstack doctor\n"));
      let allGood = true;

      // 1. Check Node version
      const nodeVersion = process.version;
      const major = parseInt(nodeVersion.slice(1));
      if (major >= 18) {
        pass(`Node.js ${nodeVersion}`);
      } else {
        fail(`Node.js ${nodeVersion} — se requiere v18+`);
        allGood = false;
      }

      // 2. Check credentials
      console.log();
      const profile = getActiveProfile();
      if (!profile) {
        fail("No hay credenciales configuradas");
        info("Ejecuta: gigstack login");
        allGood = false;
        return printSummary(allGood);
      }

      const profiles = listProfiles();
      pass(`Perfil activo: ${pc.bold(profile.name)}`);
      if (profiles.length > 1) {
        info(`${profiles.length} perfiles configurados`);
      }

      // Detect key type
      if (isTestKey(profile.apiKey)) {
        warn("Usando API key de prueba (test mode)");
      } else {
        pass("Usando API key de producción (live mode)");
      }

      // 3. Check API connectivity
      console.log();
      try {
        const start = Date.now();
        const res = await api("GET", "/teams");
        const latency = Date.now() - start;
        pass(`Conexión a API: ${latency}ms`);

        const teams = res.data || [];
        if (teams.length === 0) {
          fail("No se encontraron equipos");
          allGood = false;
        } else {
          const team = teams[0];
          pass(`Equipo: ${pc.bold(team.legal_name || team.brand?.alias || team.name || "—")}`);

          // RFC
          if (team.tax_id) {
            pass(`RFC: ${team.tax_id}`);
          } else {
            warn("RFC no configurado");
          }

          // SAT connection
          console.log();
          if (team.sat?.completed) {
            pass("SAT conectado");
            if (team.sat.csd_expires_at) {
              const expires = formatDate(team.sat.csd_expires_at);
              const expiresDate = new Date(team.sat.csd_expires_at > 1e12 ? team.sat.csd_expires_at : team.sat.csd_expires_at * 1000);
              const daysLeft = Math.floor((expiresDate.getTime() - Date.now()) / 86400000);
              if (daysLeft < 30) {
                warn(`CSD expira en ${daysLeft} días (${expires})`);
                allGood = false;
              } else {
                pass(`CSD válido hasta ${expires} (${daysLeft} días)`);
              }
            }
            if (team.sat.connected_at) {
              info(`Conectado: ${formatDate(team.sat.connected_at)}`);
            }
          } else {
            fail("SAT no conectado — no podrás timbrar facturas");
            info("Conecta tu CSD en app.gigstack.pro/settings");
            allGood = false;
          }

          // Integrations summary
          console.log();
          const integrations = team.integrations || {};
          const connected = Object.entries(integrations)
            .filter(([_, v]: any) => v?.completed)
            .map(([k]) => k);
          if (connected.length > 0) {
            pass(`Integraciones: ${connected.join(", ")}`);
          } else {
            info("Sin integraciones conectadas");
          }

          // Check key endpoints
          console.log();
          const endpoints = [
            { name: "Clientes", path: "/clients", query: { limit: "1" } },
            { name: "Facturas", path: "/invoices/income", query: { limit: "1" } },
            { name: "Pagos", path: "/payments", query: { limit: "1" } },
            { name: "Servicios", path: "/services", query: { limit: "1" } },
            { name: "Webhooks", path: "/webhooks" },
            { name: "Recibos", path: "/receipts", query: { limit: "1" } },
          ];

          for (const ep of endpoints) {
            try {
              await api("GET", ep.path, { query: ep.query as any });
              pass(`${ep.name} (${ep.path})`);
            } catch (e: any) {
              fail(`${ep.name} (${ep.path}): ${e.message}`);
              allGood = false;
            }
          }
        }
      } catch (e: any) {
        fail(`Error de conexión: ${e.message}`);
        allGood = false;
      }

      printSummary(allGood);
    });
}

function printSummary(allGood: boolean) {
  console.log();
  if (allGood) {
    console.log(pc.green(pc.bold("Todo en orden. Tu CLI está listo.")));
  } else {
    console.log(pc.yellow(pc.bold("Algunos problemas detectados. Revisa los items marcados arriba.")));
  }
  console.log();
}
