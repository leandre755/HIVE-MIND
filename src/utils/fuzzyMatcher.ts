/**
 * utils/fuzzyMatcher.ts
 * Utilitaire de recherche floue pour les mentions WhatsApp
 */

export interface Member {
  name: string;
  jid: string;
  phoneNumber?: string;
}

export interface MatchResult {
  match: Member | null;
  score: number;
  exact: boolean;
}

export interface ResolvedMentions {
  text: string;
  mentions: string[];
  resolved: Member[];
}

/**
 * Calcule la distance de Levenshtein entre deux chaînes
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const aLen = a.length;
  const bLen = b.length;
  const rowSize = aLen + 1;
  const dp = new Int32Array(rowSize * (bLen + 1));

  for (let i = 0; i <= bLen; i++) {
    Reflect.set(dp, i * rowSize, i);
  }
  for (let j = 0; j <= aLen; j++) {
    Reflect.set(dp, j, j);
  }

  for (let i = 1; i <= bLen; i++) {
    const prevRow = (i - 1) * rowSize;
    const curRow = i * rowSize;
    const bChar = b.charAt(i - 1);

    for (let j = 1; j <= aLen; j++) {
      const cost = a.charAt(j - 1) === bChar ? 0 : 1;
      const sub = (Reflect.get(dp, prevRow + j - 1) as number) + cost;
      const ins = (Reflect.get(dp, curRow + j - 1) as number) + 1;
      const del = (Reflect.get(dp, prevRow + j) as number) + 1;
      Reflect.set(dp, curRow + j, Math.min(sub, ins, del));
    }
  }

  return Reflect.get(dp, bLen * rowSize + aLen) as number;
}

/**
 * Normalise une chaîne pour la comparaison
 */
function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Enlève les accents
    .replace(/[^a-z0-9]/g, ''); // Garde que alphanum
}

/**
 * Vérifie si query est un préfixe ou diminutif de target
 */
function isPrefixOrNickname(query: string, target: string): boolean {
  const q = normalize(query);
  const t = normalize(target);

  if (t.startsWith(q)) return true;

  const MIN_SYLLABLE_LEN = 2;
  const SIMILARITY_THRESHOLD = 0.6;

  if (q.length >= MIN_SYLLABLE_LEN && t.startsWith(q.substring(0, 2))) {
    const similarity =
      1 - levenshteinDistance(q, t.substring(0, q.length + 2)) / Math.max(q.length, 3);
    if (similarity > SIMILARITY_THRESHOLD) return true;
  }

  return false;
}

function matchByNumericQuery(query: string, candidates: Member[]): MatchResult | null {
  for (const candidate of candidates) {
    if (candidate.phoneNumber) {
      const cleanPhone = candidate.phoneNumber.split('@')[0];
      if (cleanPhone === query || cleanPhone.startsWith(query)) {
        return { match: candidate, score: 1, exact: true };
      }
    }

    if (!candidate.jid) continue;
    const idPart = candidate.jid.split('@')[0];
    const isLid = candidate.jid.endsWith('@lid');

    if (!isLid && (idPart === query || idPart.startsWith(query))) {
      return { match: candidate, score: 1, exact: true };
    }
  }
  return null;
}

function evaluateNameParts(
  normalizedQuery: string,
  candidate: Member,
  currentBestScore: number,
  currentBestMatch: Member | null,
): { match: Member | null; score: number; exact: boolean } {
  let bestScore = currentBestScore;
  let bestMatch = currentBestMatch;

  const nameParts = (candidate.name || '').split(/\s+/);
  for (const part of nameParts) {
    const normalizedPart = normalize(part);
    if (normalizedPart === normalizedQuery) {
      return { match: candidate, score: 1, exact: true };
    }
    if (isPrefixOrNickname(normalizedQuery, normalizedPart)) {
      if (0.85 > bestScore) {
        bestScore = 0.85;
        bestMatch = candidate;
      }
    }
  }

  return { match: bestMatch, score: bestScore, exact: false };
}

function evaluateCandidateName(
  normalizedQuery: string,
  candidate: Member,
  currentBestScore: number,
): { match: Member | null; score: number; exact: boolean } {
  if (!candidate.name) return { match: null, score: 0, exact: false };

  const normalizedName = normalize(candidate.name);

  if (normalizedName === normalizedQuery) {
    return { match: candidate, score: 1, exact: true };
  }

  let bestScore = currentBestScore;
  let bestMatch: Member | null = null;

  if (isPrefixOrNickname(normalizedQuery, normalizedName)) {
    const prefixScore = 0.9 - (normalizedQuery.length / normalizedName.length) * 0.1;
    if (prefixScore > bestScore) {
      bestScore = prefixScore;
      bestMatch = candidate;
    }
  } else if (normalizedName.includes(normalizedQuery)) {
    const partScore = 0.7 + (normalizedQuery.length / normalizedName.length) * 0.15;
    if (partScore > bestScore) {
      bestScore = partScore;
      bestMatch = candidate;
    }
  }

  const distance = levenshteinDistance(normalizedQuery, normalizedName);
  const maxLen = Math.max(normalizedQuery.length, normalizedName.length);
  const similarity = 1 - distance / maxLen;

  if (similarity > bestScore) {
    bestScore = similarity;
    bestMatch = candidate;
  }

  return evaluateNameParts(normalizedQuery, candidate, bestScore, bestMatch);
}

/**
 * Trouve le meilleur match pour une query parmi une liste de candidats
 */
export function findBestMatch(
  query: string,
  candidates: Member[],
  threshold: number = 0.65,
): MatchResult {
  if (!query || !candidates || candidates.length === 0) {
    return { match: null, score: 0, exact: false };
  }

  if (/^\d+$/.test(query)) {
    return matchByNumericQuery(query, candidates) ?? { match: null, score: 0, exact: false };
  }

  const normalizedQuery = normalize(query);
  let bestMatch: Member | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const res = evaluateCandidateName(normalizedQuery, candidate, bestScore);
    if (res.exact) return res;
    if (res.score > bestScore) {
      bestScore = res.score;
      bestMatch = res.match;
    }
  }

  if (bestScore >= threshold) {
    return { match: bestMatch, score: bestScore, exact: false };
  }

  return { match: null, score: bestScore, exact: false };
}

/**
 * Extrait toutes les mentions @Nom d'un texte
 */
export function extractMentions(text: string | null | undefined): string[] {
  if (!text) return [];

  const regex = /@([\p{L}\p{N}]+)/gu;
  const mentions: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    mentions.push(match[1]);
  }

  return mentions;
}

function replaceNameWithMention(
  text: string,
  name: string,
  replacement: string,
): { newText: string; matched: boolean } {
  const lowerText = text.toLowerCase();
  const lowerName = name.toLowerCase();
  let pos = 0;
  let matched = false;
  let result = '';

  while (pos < text.length) {
    const idx = lowerText.indexOf(lowerName, pos);
    if (idx === -1) {
      result += text.slice(pos);
      break;
    }
    const charBefore = idx > 0 ? text.charAt(idx - 1) : ' ';
    const charAfter = idx + name.length < text.length ? text.charAt(idx + name.length) : ' ';
    const isWordStart = !/\w/.test(charBefore);
    const isWordEnd = !/\w/.test(charAfter);

    if (isWordStart && isWordEnd) {
      result += text.slice(pos, idx) + replacement;
      pos = idx + name.length;
      matched = true;
    } else {
      result += text.slice(pos, idx + name.length);
      pos = idx + name.length;
    }
  }

  return { newText: result, matched };
}

/**
 * Résout les mentions dans un texte en les remplaçant par des JIDs WhatsApp
 */
export function resolveMentionsInText(
  text: string | null | undefined,
  members: Member[],
): ResolvedMentions {
  if (!text || !members || members.length === 0) {
    return { text: text || '', mentions: [], resolved: [] };
  }

  const mentionNames = extractMentions(text);
  if (mentionNames.length === 0) {
    return { text, mentions: [], resolved: [] };
  }

  const resolvedJids: string[] = [];
  const resolvedMembers: Member[] = [];
  let processedText = text;

  for (const mentionName of mentionNames) {
    const { match, score } = findBestMatch(mentionName, members);

    if (match) {
      console.log(
        `[FuzzyMatcher] "@${mentionName}" → "${match.name}" (score: ${score.toFixed(2)})`,
      );

      if (!resolvedJids.includes(match.jid)) {
        resolvedJids.push(match.jid);
        resolvedMembers.push(match);
      }

      const phoneNumber = match.jid.split('@')[0];
      const { newText } = replaceNameWithMention(
        processedText,
        `@${mentionName}`,
        `@${phoneNumber}`,
      );
      processedText = newText;
    }
  }

  return {
    text: processedText,
    mentions: resolvedJids,
    resolved: resolvedMembers,
  };
}

/**
 * Résout les mentions implicites dans un texte
 */
export function resolveImplicitMentions(
  text: string | null | undefined,
  members: Member[],
): ResolvedMentions {
  if (!text || !members || members.length === 0) {
    return { text: text || '', mentions: [], resolved: [] };
  }

  let processedText = text;
  const resolvedJids: string[] = [];
  const resolvedMembers: Member[] = [];

  const sortedMembers = [...members].sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));

  for (const member of sortedMembers) {
    const MIN_NAME_LEN = 3;
    if (!member.name || member.name.length < MIN_NAME_LEN) continue;

    const phoneNumber = member.jid.split('@')[0];
    const { newText, matched } = replaceNameWithMention(
      processedText,
      member.name,
      `@${phoneNumber}`,
    );

    if (matched) {
      if (!resolvedJids.includes(member.jid)) {
        resolvedJids.push(member.jid);
        resolvedMembers.push(member);

        console.log(`[ImplicitMention] Nom trouvé: "${member.name}" → JID: ${member.jid}`);

        processedText = newText;
      }
    }
  }

  return {
    text: processedText,
    mentions: resolvedJids,
    resolved: resolvedMembers,
  };
}

export default {
  findBestMatch,
  extractMentions,
  resolveMentionsInText,
  resolveImplicitMentions,
  levenshteinDistance,
};
