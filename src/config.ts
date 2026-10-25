import { chmodSync, closeSync, existsSync, fchmodSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = process.env.GIGSTACK_CONFIG_DIR || join(homedir(), ".config", "gigstack");
const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json");

interface Credentials {
  profiles: Record<string, { apiKey: string; environment: string; baseUrl?: string }>;
  activeProfile: string;
}

// Profile names become both credential-store map keys and the active-profile
// selector, so they must be safe identifiers. Reject the charset outliers and
// the prototype-chain names (__proto__/constructor/prototype) that would corrupt
// the store or retarget requests via prototype pollution.
const PROFILE_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED_PROFILE_NAMES = new Set(["__proto__", "constructor", "prototype"]);
export function isSafeProfileName(name: string): boolean {
  return typeof name === "string" && PROFILE_NAME_RE.test(name) && !RESERVED_PROFILE_NAMES.has(name);
}
export function assertSafeProfileName(name: string): string {
  if (!isSafeProfileName(name)) {
    throw new Error("Nombre de perfil inválido. Usa 1–64 caracteres [A-Za-z0-9_-] y evita nombres reservados (__proto__, constructor, prototype).");
  }
  return name;
}

function hasProfile(profiles: Credentials["profiles"], name: string): boolean {
  return Object.prototype.hasOwnProperty.call(profiles, name);
}

function ensureConfigDir() {
  let info;
  try {
    info = lstatSync(CONFIG_DIR);
  } catch {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    return;
  }
  // Refuse to resolve the credential store through a symlinked config dir: an
  // attacker could point GIGSTACK_CONFIG_DIR at a directory they own.
  if (info.isSymbolicLink()) {
    throw new Error("La ruta de configuración de gigstack no puede ser un enlace simbólico.");
  }
  if (!info.isDirectory()) {
    throw new Error("La ruta de configuración de gigstack no es un directorio.");
  }
  // Re-tighten a pre-existing dir that is group/world-accessible.
  if ((info.mode & 0o077) !== 0) {
    try { chmodSync(CONFIG_DIR, 0o700); } catch {}
  }
}

function readCredentials(): Credentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function writeCredentials(creds: Credentials) {
  ensureConfigDir();
  const data = JSON.stringify(creds, null, 2);
  const staging = join(CONFIG_DIR, `.credentials.${process.pid}.tmp`);
  // "wx" (O_CREAT|O_EXCL) refuses to open through a pre-planted symlink, so the
  // key can never be written into an attacker-owned file.
  const fd = openSync(staging, "wx", 0o600);
  try {
    fchmodSync(fd, 0o600);
    writeFileSync(fd, data);
  } catch (error) {
    try { closeSync(fd); } catch {}
    try { unlinkSync(staging); } catch {}
    throw error;
  }
  closeSync(fd);
  try {
    // rename replaces the destination entry rather than following a symlink, and
    // preserves the staging file's 0600 mode (fixes a pre-existing 0644 store).
    renameSync(staging, CREDENTIALS_FILE);
  } catch (error) {
    try { unlinkSync(staging); } catch {}
    throw error;
  }
}

export function saveProfile(name: string, apiKey: string, environment: string, baseUrl?: string) {
  assertSafeProfileName(name);
  const creds = readCredentials() || { profiles: {}, activeProfile: name };
  creds.profiles[name] = { apiKey, environment, ...(baseUrl ? { baseUrl } : {}) };
  creds.activeProfile = name;
  writeCredentials(creds);
}

export function removeProfile(name: string) {
  if (!isSafeProfileName(name)) return;
  const creds = readCredentials();
  if (!creds) return;
  if (hasProfile(creds.profiles, name)) delete creds.profiles[name];
  if (creds.activeProfile === name) {
    creds.activeProfile = Object.keys(creds.profiles)[0] || "";
  }
  writeCredentials(creds);
}

export function switchProfile(name: string): boolean {
  if (!isSafeProfileName(name)) return false;
  const creds = readCredentials();
  if (!creds || !hasProfile(creds.profiles, name)) return false;
  creds.activeProfile = name;
  writeCredentials(creds);
  return true;
}

export function getActiveProfile(): { name: string; apiKey: string; environment: string; baseUrl?: string } | null {
  const envKey = process.env.GIGSTACK_API_KEY;
  if (envKey) return { name: "env", apiKey: envKey, environment: "production" };

  const creds = readCredentials();
  if (!creds || !creds.activeProfile || !hasProfile(creds.profiles, creds.activeProfile)) return null;
  return { name: creds.activeProfile, ...creds.profiles[creds.activeProfile] };
}

export function parseJwtPayload(apiKey: string): Record<string, any> | null {
  try {
    const parts = apiKey.split(".");
    if (parts.length === 3) {
      return JSON.parse(Buffer.from(parts[1], "base64").toString());
    }
  } catch {}
  return null;
}

export function isTestKey(apiKey: string): boolean {
  if (apiKey.startsWith("sk_test")) return true;
  const payload = parseJwtPayload(apiKey);
  if (payload) {
    if (payload.livemode === false) return true;
    if (payload.key_id?.includes("test")) return true;
  }
  return false;
}

export function getTeamFromKey(apiKey: string): string | null {
  const payload = parseJwtPayload(apiKey);
  return payload?.team || null;
}

export function listProfiles(): { name: string; active: boolean }[] {
  const creds = readCredentials();
  if (!creds) return [];
  return Object.keys(creds.profiles).map((name) => ({
    name,
    active: name === creds.activeProfile,
  }));
}
