import { randomInt, randomBytes } from 'crypto';

/**
 * Délai async
 * @param ms Millisecondes à attendre
 */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Délai aléatoire entre min et max
 * @param min
 * @param max
 */
export const randomDelay = (min: number, max: number): Promise<void> => {
  const ms = randomInt(min, Math.max(min + 1, max));
  return delay(ms);
};

export interface DelayRange {
  min: number;
  max: number;
}

/**
 * Parse un délai du format "1000-3000" en {min, max}
 * @param delayStr
 */
export const parseDelayRange = (delayStr: string | null | undefined): DelayRange => {
  const DEFAULT_MIN = 1000;
  const DEFAULT_MAX = 2000;

  if (!delayStr) return { min: DEFAULT_MIN, max: DEFAULT_MAX };

  const [min, max] = delayStr.split('-').map(Number);
  return {
    min: min || DEFAULT_MIN,
    max: max || min || DEFAULT_MAX,
  };
};

/**
 * Tronque un texte à une longueur max
 * @param text
 * @param maxLength
 */
export const truncate = (text: string | null | undefined, maxLength: number = 100): string => {
  if (!text || text.length <= maxLength) return text || '';
  return text.substring(0, maxLength - 3) + '...';
};

/**
 * Extrait le numéro de téléphone d'un JID
 * @param jid
 */
export const jidToPhone = (jid: string | null | undefined): string => {
  return jid?.split('@')[0] || '';
};

/**
 * Convertit un numéro en JID
 * @param phone
 */
export const phoneToJid = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '');
  return `${cleaned}@s.whatsapp.net`;
};

/**
 * Vérifie si un JID est un groupe
 * @param jid
 */
export const isGroupJid = (jid: string | null | undefined): boolean => {
  return jid?.endsWith('@g.us') || false;
};

/**
 * Échape les caractères spéciaux pour regex
 * @param str
 */
export const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Génère un ID unique
 */
export const generateId = (): string => {
  return `${Date.now()}_${randomBytes(4).toString('hex')}`;
};

/**
 * Formate une date en français
 * @param date
 */
export const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

/**
 * Parse un texte pour extraire les mentions
 * @param text
 */
export const extractMentions = (text: string | null | undefined): string[] => {
  if (!text) return [];
  const mentions: string[] = [];
  const regex = /@(\d+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    mentions.push(`${match[1]}@s.whatsapp.net`);
  }
  return mentions;
};

/**
 * Détermine si un message doit être stocké dans la mémoire sémantique
 * @param text Le contenu du message
 * @param role 'user' ou 'assistant'
 * @returns
 */
export const isStorable = (text: string | null | undefined, role: string): boolean => {
  if (!text || typeof text !== 'string') return false;
  const cleanText = text.trim();

  // 1. Exclure les commandes (commençant par !, /, .)
  const COMMAND_PREFIXES = ['!', '/', '.', '?'];
  if (COMMAND_PREFIXES.some((prefix) => cleanText.startsWith(prefix))) return false;

  // 2. Exclure les messages trop courts (peu de valeur sémantique)
  const MIN_STORABLE_LENGTH = 5;
  if (cleanText.length < MIN_STORABLE_LENGTH) return false;

  // 3. Exclure les messages d'erreur types ou techniques
  const NOISE_PATTERNS = [
    /🤖 Démarrage/i,
    /❌ Erreur/i,
    /Oups, j'ai bugué/i,
    /Veuillez patienter/i,
    /Scannez le QR Code/i,
  ];
  if (NOISE_PATTERNS.some((pattern) => pattern.test(cleanText))) return false;

  // 4. Exclure les messages de l'assistant qui sont des refus
  if (
    role === 'assistant' &&
    (cleanText.includes('Désolé') || cleanText.includes('Je ne peux pas'))
  ) {
    return false;
  }

  return true;
};

function convertMarkdownLinks(text: string): string {
  let result = '';
  let pos = 0;
  while (pos < text.length) {
    const openBracket = text.indexOf('[', pos);
    if (openBracket === -1) {
      result += text.slice(pos);
      break;
    }
    const closeBracket = text.indexOf(']', openBracket + 1);
    if (closeBracket === -1 || text.charAt(closeBracket + 1) !== '(') {
      result += text.slice(pos, openBracket + 1);
      pos = openBracket + 1;
      continue;
    }
    const closeParen = text.indexOf(')', closeBracket + 2);
    if (closeParen === -1) {
      result += text.slice(pos, openBracket + 1);
      pos = openBracket + 1;
      continue;
    }
    const linkText = text.slice(openBracket + 1, closeBracket);
    const linkUrl = text.slice(closeBracket + 2, closeParen);
    if (!linkText.includes('\n') && !linkUrl.includes('\n')) {
      result += text.slice(pos, openBracket) + `${linkText} (${linkUrl})`;
      pos = closeParen + 1;
    } else {
      result += text.slice(pos, openBracket + 1);
      pos = openBracket + 1;
    }
  }
  return result;
}

/**
 * Formate le texte markdown pour WhatsApp
 * @param text
 */
export const formatForWhatsApp = (text: string | null | undefined): string => {
  if (!text) return '';

  // 1. Convertir les liens Markdown [Texte](URL) en "Texte (URL)"
  let formatted = convertMarkdownLinks(text);

  // 2. Convertir les TITRES Markdown (# Titre) en (**TITRE EN MAJUSCULES**) pour que le Bold processing (5) le gère
  formatted = formatted.replace(/^#+\s*(.*)/gm, (_, title: string) => {
    return `**${title.toUpperCase().trim()}**`;
  });

  // Guard: Si le texte est très long, on limite les remplacements complexes
  const MAX_COMPLEX_FORMAT_LENGTH = 5000;
  if (formatted.length > MAX_COMPLEX_FORMAT_LENGTH) {
    return formatted.replace(/\*\*(.*?)\*\*/g, '*$1*');
  }

  // 3. Convertir le GRAS+ITALIQUE (***text*** ou ___text___) en WhatsApp (*_text_*)
  formatted = formatted.replace(/\*\*\*([^*]+)\*\*\*/g, '*_$1_*');
  formatted = formatted.replace(/___([^_]+)___/g, '*_$1_*');

  // 4. Convertir l'ITALIQUE Markdown simple (*text*) en WhatsApp (_text_)
  // Regex : un seul astérisque, pas d'espace juste après ni juste avant
  formatted = formatted.replace(/(?<!\*)\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)/g, '_$1_');

  // 5. Convertir le GRAS Markdown (**text**) en WhatsApp (*text*)
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '*$1*');

  // 6. Convertir l'italique Markdown alternatif (__text__) en WhatsApp (_text_)
  formatted = formatted.replace(/__([^_]+)__/g, '_$1_');

  // 7. Convertir le barré (~~text~~) en WhatsApp (~text~)
  formatted = formatted.replace(/~~([^~]+)~~/g, '~$1~');

  // 8. Nettoyer les blocs de code (WhatsApp supporte ```code``` nativement, on s'assure juste de la propreté)
  formatted = formatted.replace(
    /```(\w*)\n(.*?)```/gs,
    (_, _lang, code) => `\`\`\`\n${code.trim()}\n\`\`\``,
  );

  // 9. Listes et Citations : WhatsApp supporte nativement -, *, 1. et >
  // On nettoie juste les espaces superflus en début de ligne pour garantir la détection par WhatsApp
  formatted = formatted.replace(/^[ \t]+([-*]|\d+\.|>)\s/gm, '$1 ');

  // 10. Nettoyer les sauts de ligne excessifs
  formatted = formatted.replace(/\n{3,}/g, '\n\n');

  return formatted.trim();
};

const SENSITIVE_VARS_REGEX =
  /(?:API_KEY|SECRET|PASSWORD|TOKEN|SUPABASE_KEY|OPENAI_API_KEY)=[\w.-]+/gi;

/**
 * Nettoie le texte pour WhatsApp en retirant les informations sensibles
 * (chemins de fichiers locaux, commandes système, etc.)
 * @param text
 */
export const sanitizeForWhatsApp = (text: string | null | undefined): string => {
  if (!text) return '';

  let sanitized = text;

  // 1. Masquer les chemins de fichiers (ex: /home/user/...)
  sanitized = sanitized.replace(/\/home\/[a-zA-Z0-9._-]+\//g, '~/');

  // 2. Masquer les variables d'environnement sensibles
  sanitized = sanitized.replace(SENSITIVE_VARS_REGEX, (match) => {
    const [varName] = match.split('=');
    return `${varName}=********`;
  });

  return sanitized;
};

export default {
  delay,
  randomDelay,
  parseDelayRange,
  truncate,
  jidToPhone,
  phoneToJid,
  isGroupJid,
  escapeRegex,
  generateId,
  formatDate,
  extractMentions,
  isStorable,
  formatForWhatsApp,
};
