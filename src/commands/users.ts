import { Command } from "commander";
import { api } from "../api.js";
import { withListOpts, buildListQuery } from "../list-opts.js";
import { withJsonInput, readJsonInput, requireConfirmation, segment } from "../input.js";
import { printJson, printKeyValue, isJsonMode } from "../output.js";

function show(res: any) { isJsonMode() ? printJson(res) : printKeyValue(res.data ?? res); }

export function registerUserCommands(program: Command) {
  const users = program.command("users").description("Usuarios de la cuenta; escrituras requieren admin, no equivale a perfil personal");
  withListOpts(users.command("list").description("Listar usuarios accesibles"))
    .action(async opts => show(await api("GET", "/users", { query: buildListQuery(opts) })));
  users.command("get <id>").description("Consultar usuario accesible")
    .action(async id => show(await api("GET", `/users/${segment(id)}`)));
  withJsonInput(users.command("create").description("Crear usuario administrado: email, first_name, last_name, phone, address, auto_join y role"))
    .action(async opts => {
      const body = await readJsonInput(opts);
      if (body.role !== undefined && !["admin", "editor", "viewer"].includes(body.role)) throw new Error("role debe ser admin, editor o viewer");
      show(await api("POST", "/users", { body }));
    });
  withJsonInput(users.command("update <id>").description("Actualizar perfil de un usuario como admin; no cambia email ni membresías reservadas"))
    .action(async (id, opts) => show(await api("PUT", `/users/${segment(id)}`, { body: await readJsonInput(opts) })));
  users.command("reset-password <id>").description("Enviar correo de restablecimiento al usuario; requiere admin")
    .action(async id => show(await api("POST", `/users/reset-password/${segment(id)}`, { body: {} })));
  users.command("login-link <id>").description("Generar acceso para un usuario API administrado exclusivamente por esta cuenta; salida sensible")
    .option("-y, --yes", "Confirmar creación del enlace de acceso")
    .action(async (id, opts) => {
      segment(id);
      await requireConfirmation(opts.yes, `¿Crear un enlace que inicia sesión como el usuario administrado ${id}?`);
      show(await api("POST", "/users/login-link", { body: { user_id: id } }));
    });
  users.command("delete <id>").description("Eliminar usuario administrado según las restricciones del servidor")
    .option("-y, --yes", "Confirmar eliminación del usuario")
    .action(async (id, opts) => {
      const path = `/users/${segment(id)}`;
      await requireConfirmation(opts.yes, `¿Eliminar al usuario ${id}?`);
      show(await api("DELETE", path));
    });
}
