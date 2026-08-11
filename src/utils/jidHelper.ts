/**
 * utils/jidHelper.ts
 * Module utilitaire centralisé pour la gestion des JID/LID WhatsApp
 * Single Source of Truth pour tous les matchings d'identifiants
 */

export type JidType = 'phone' | 'lid' | 'group' | 'unknown';

/**
 * Formats WhatsApp:
 * - JID: 22569456432@s.whatsapp.net (numéro de téléphone)
 * - LID: 90366833332436@lid (identifiant interne WhatsApp)
 */

/**
 * Extrait la partie numérique d'un JID ou LID
 * @param jid Format: xxx@s.whatsapp.net, xxx@lid, ou xxx:yyy@...
 * @returns Partie numérique uniquement
 */
export function extractNumericId(jid: string | null | undefined): string {
  if (!jid) return '';
  // Supprimer tout après @ et avant : (pour les device IDs)
  return jid.split('@')[0].split(':')[0];
}

/**
 * Normalise un JID vers le format standard s.whatsapp.net
 * @param jid
 * @returns
 */
export function normalizeJid(jid: string | null | undefined): string {
  if (!jid) return '';
  const num = extractNumericId(jid);
  return num ? `${num}@s.whatsapp.net` : '';
}

/**
 * Vérifie si deux JID/LID correspondent au même utilisateur
 * Compare les parties numériques avec tolérance pour les sous-chaînes
 */
export function jidMatch(
  jid1: string | null | undefined,
  jid2: string | null | undefined,
): boolean {
  if (!jid1 || !jid2) return false;

  const num1 = extractNumericId(jid1);
  const num2 = extractNumericId(jid2);

  if (!num1 || !num2) return false;

  // Match exact
  if (num1 === num2) return true;

  // Match par inclusion (pour les LID qui peuvent être des sous-parties)
  if (num1.includes(num2) || num2.includes(num1)) return true;

  return false;
}

/**
 * Trouve un match dans une Map de JID
 */
export function findInJidMap<T>(
  searchJid: string | null | undefined,
  jidMap: Map<string, T>,
): { key: string; value: T } | null {
  if (!searchJid || !jidMap) return null;

  // Essai 1: Match exact (rapide)
  if (jidMap.has(searchJid)) {
    return { key: searchJid, value: jidMap.get(searchJid)! };
  }

  // Essai 2: Match par numéro
  for (const [key, value] of jidMap) {
    if (jidMatch(searchJid, key)) {
      return { key, value };
    }
  }

  return null;
}

/**
 * Trouve un match dans un tableau d'objets contenant des JID
 */
export function findInJidArray<T extends Record<string, unknown>>(
  searchJid: string | null | undefined,
  array: T[],
  jidField: keyof T = 'jid' as keyof T,
): T | null {
  if (!searchJid || !array) return null;

  for (const item of array) {
    if (jidMatch(searchJid, Reflect.get(item, jidField as string) as string)) {
      return item;
    }
  }

  return null;
}

/**
 * Vérifie si un JID est dans une liste (Set ou Array de JID)
 */
export function jidInList(
  jid: string | null | undefined,
  jidList: string[] | Set<string>,
): boolean {
  if (!jid || !jidList) return false;

  const list = Array.isArray(jidList) ? jidList : Array.from(jidList);
  return list.some((item) => jidMatch(jid, item));
}

/**
 * Identifie le type de JID
 */
export function getJidType(jid: string | null | undefined): JidType {
  if (!jid) return 'unknown';
  if (jid.endsWith('@g.us')) return 'group';
  if (jid.endsWith('@lid')) return 'lid';
  if (jid.endsWith('@s.whatsapp.net')) return 'phone';
  return 'unknown';
}

/**
 * Formate un JID pour l'affichage utilisateur (sans exposer le JID brut)
 */
export function formatForDisplay(
  jid: string | null | undefined,
  name: string | null = null,
): string {
  if (name && name !== 'Inconnu') {
    return name;
  }
  // Fallback: afficher le numéro masqué
  const num = extractNumericId(jid);
  if (num.length > 6) {
    return `+${num.substring(0, 3)}***${num.substring(num.length - 3)}`;
  }
  return num || 'Inconnu';
}

export default {
  extractNumericId,
  normalizeJid,
  jidMatch,
  findInJidMap,
  findInJidArray,
  jidInList,
  getJidType,
  formatForDisplay,
};
