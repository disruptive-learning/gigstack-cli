import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "gigstack");
const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json");

interface Credentials {
  profiles: Record<string, { apiKey: string; environment: string }>;
  activeProfile: string;
}

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
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
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function saveProfile(name: string, apiKey: string, environment: string) {
  const creds = readCredentials() || { profiles: {}, activeProfile: name };
  creds.profiles[name] = { apiKey, environment };
  creds.activeProfile = name;
  writeCredentials(creds);
}

export function removeProfile(name: string) {
  const creds = readCredentials();
  if (!creds) return;
  delete creds.profiles[name];
  if (creds.activeProfile === name) {
    creds.activeProfile = Object.keys(creds.profiles)[0] || "";
  }
  writeCredentials(creds);
}

export function switchProfile(name: string): boolean {
  const creds = readCredentials();
  if (!creds || !creds.profiles[name]) return false;
  creds.activeProfile = name;
  writeCredentials(creds);
  return true;
}

export function getActiveProfile(): { name: string; apiKey: string; environment: string } | null {
  const envKey = process.env.GIGSTACK_API_KEY;
  if (envKey) return { name: "env", apiKey: envKey, environment: "production" };

  const creds = readCredentials();
  if (!creds || !creds.activeProfile || !creds.profiles[creds.activeProfile]) return null;
  return { name: creds.activeProfile, ...creds.profiles[creds.activeProfile] };
}

export function listProfiles(): { name: string; active: boolean }[] {
  const creds = readCredentials();
  if (!creds) return [];
  return Object.keys(creds.profiles).map((name) => ({
    name,
    active: name === creds.activeProfile,
  }));
}
