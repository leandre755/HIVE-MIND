import { resolve, join } from 'node:path';
import {
  safeExistsSync,
  safeReadFileSync,
  safeWriteFileSync,
  safeRemoveDirectorySync,
} from '../utils/safeFs.js';

const ROOT_DIR = process.cwd();
const ENV_PATH = resolve(ROOT_DIR, '.env');
const WA_SESSION_DIR = resolve(ROOT_DIR, 'session');

export interface AccountConnectionStatus {
  whatsapp: boolean;
  telegram: boolean;
  discord: boolean;
}

export interface VerificationResult {
  valid: boolean;
  username?: string;
  error?: string;
}

/**
 * Nettoie une chaîne pour empêcher toute injection de nouvelle ligne dans .env.
 */
function sanitizeEnvString(val: string): string {
  return val.replace(/[\r\n]/g, '').trim();
}

/**
 * Extrait la valeur nettoyée d'une ligne KEY=VALUE.
 */
function parseEnvLine(line: string, targetKey: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) return null;

  const k = trimmed.slice(0, eqIdx).trim();
  if (k !== targetKey) return null;

  let val = trimmed.slice(eqIdx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return val;
}

/**
 * Parcourt le fichier .env pour trouver la valeur d'une clé.
 */
function readKeyFromEnvFile(key: string): string {
  if (!safeExistsSync(ENV_PATH)) return '';
  try {
    const content = safeReadFileSync(ENV_PATH, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const val = parseEnvLine(line, key);
      if (val !== null) return val;
    }
  } catch {
    // Fichier ilisible
  }
  return '';
}

/**
 * Lit une variable dans process.env ou dans .env.
 */
function getEnvValue(key: string): string {
  const envVal = Reflect.get(process.env, key);
  if (typeof envVal === 'string' && envVal.length > 0) {
    return envVal;
  }
  return readKeyFromEnvFile(key);
}

/**
 * Filtre les lignes du .env en remplaçant ou supprimant la clé ciblée.
 */
function processEnvLines(
  lines: string[],
  key: string,
  sanitizedValue: string | null,
): { newLines: string[]; found: boolean } {
  let found = false;
  const newLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      newLines.push(line);
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1 && trimmed.slice(0, eqIdx).trim() === key) {
      found = true;
      if (sanitizedValue !== null && sanitizedValue.length > 0) {
        newLines.push(`${key}=${sanitizedValue}`);
      }
      continue;
    }
    newLines.push(line);
  }

  return { newLines, found };
}

/**
 * Met à jour ou supprime une variable dans le fichier .env et dans process.env.
 * Sanitise strictement la clé et la valeur pour empêcher l'injection de nouvelles lignes.
 */
export function updateEnvVariable(rawKey: string, rawValue: string | null): void {
  const key = sanitizeEnvString(rawKey);
  const value = rawValue !== null ? sanitizeEnvString(rawValue) : null;

  let lines: string[] = [];
  if (safeExistsSync(ENV_PATH)) {
    try {
      lines = safeReadFileSync(ENV_PATH, 'utf-8').split('\n');
    } catch {
      lines = [];
    }
  }

  const { newLines, found } = processEnvLines(lines, key, value);

  if (!found && value !== null && value.length > 0) {
    newLines.push(`${key}=${value}`);
  }

  safeWriteFileSync(ENV_PATH, newLines.join('\n'));

  if (value === null || value.length === 0) {
    Reflect.deleteProperty(process.env, key);
  } else {
    Reflect.set(process.env, key, value);
  }
}

/**
 * Vérification réseau réelle du token Bot Telegram auprès des serveurs Telegram (avec timeout de 8s).
 */
export async function verifyTelegramBotToken(token: string): Promise<VerificationResult> {
  const cleanToken = sanitizeEnvString(token);
  if (!cleanToken || cleanToken.length < 10) {
    return { valid: false, error: 'Format de token invalide' };
  }
  try {
    const signal = AbortSignal.timeout(8000);
    const res = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`, { signal });
    if (!res.ok) {
      return { valid: false, error: `Erreur HTTP ${res.status} de l'API Telegram` };
    }
    const data = (await res.json()) as { ok?: boolean; result?: { username?: string } };
    if (data.ok && data.result?.username) {
      return { valid: true, username: `@${data.result.username}` };
    }
    return { valid: false, error: 'Réponse Telegram invalide' };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Vérification réseau réelle du jeton Discord auprès des serveurs Discord (avec timeout de 8s).
 */
export async function verifyDiscordToken(token: string): Promise<VerificationResult> {
  const cleanToken = sanitizeEnvString(token);
  if (!cleanToken || cleanToken.length < 20) {
    return { valid: false, error: 'Format de token invalide' };
  }
  try {
    const signal = AbortSignal.timeout(8000);
    const res = await fetch('https://discord.com/api/v9/users/@me', {
      headers: { Authorization: cleanToken },
      signal,
    });
    if (!res.ok) {
      return { valid: false, error: `Erreur HTTP ${res.status} (Token non autorisé)` };
    }
    const data = (await res.json()) as { username?: string; discriminator?: string };
    if (data.username) {
      const fullUser =
        data.discriminator && data.discriminator !== '0'
          ? `${data.username}#${data.discriminator}`
          : data.username;
      return { valid: true, username: fullUser };
    }
    return { valid: false, error: 'Réponse Discord invalide' };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Vérifie si WhatsApp est réellement connecté (session existante et enregistrée auprès de WhatsApp).
 * Exige STRICTEMENT registered === true et me.id pour éliminer les faux positifs lors de la génération du code de couplage.
 */
export function isWhatsAppConnected(): boolean {
  const credsPath = join(WA_SESSION_DIR, 'creds.json');
  if (!safeExistsSync(credsPath)) return false;
  try {
    const content = safeReadFileSync(credsPath, 'utf-8');
    const parsed = JSON.parse(content) as { registered?: boolean; me?: { id?: string } };
    return Boolean(parsed.registered === true && parsed.me?.id);
  } catch {
    return false;
  }
}

export function isTelegramConnected(): boolean {
  const botToken = getEnvValue('TELEGRAM_BOT_TOKEN');
  const userSession = getEnvValue('TELEGRAM_SESSION');
  return Boolean(botToken || userSession);
}

export function isDiscordConnected(): boolean {
  const token = getEnvValue('DISCORD_TOKEN');
  return Boolean(token);
}

export function getAccountStatus(): AccountConnectionStatus {
  return {
    whatsapp: isWhatsAppConnected(),
    telegram: isTelegramConnected(),
    discord: isDiscordConnected(),
  };
}

export function areAllAccountsConnected(): boolean {
  const status = getAccountStatus();
  return status.whatsapp && status.telegram && status.discord;
}

export function disconnectWhatsApp(): void {
  if (safeExistsSync(WA_SESSION_DIR)) {
    try {
      safeRemoveDirectorySync(WA_SESSION_DIR);
    } catch (e: unknown) {
      console.error(
        '[AuthSessionManager] Erreur lors de la suppression du dossier session WhatsApp:',
        e instanceof Error ? e.message : String(e),
      );
    }
  }
}

export function disconnectTelegram(): void {
  updateEnvVariable('TELEGRAM_BOT_TOKEN', null);
  updateEnvVariable('TELEGRAM_SESSION', null);
}

export function disconnectDiscord(): void {
  updateEnvVariable('DISCORD_TOKEN', null);
}
