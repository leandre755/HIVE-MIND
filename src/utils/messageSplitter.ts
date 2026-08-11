/**
 * utils/messageSplitter.ts
 * Utilitaire pour découper les messages longs en parties WhatsApp-friendly
 */

/**
 * Découpe intelligemment un message long en parties
 * @param text Message à découper
 * @param maxLength Longueur max par partie (défaut: 1500)
 * @returns Array de messages
 */
export function splitMessage(text: string | null | undefined, maxLength: number = 1500): string[] {
  if (!text) return [];
  if (text.length <= maxLength) return [text];

  const parts: string[] = [];

  // 1. Essayer de couper par --- (séparateur markdown)
  if (text.includes('\n---\n')) {
    const sections = text.split('\n---\n');
    for (const section of sections) {
      if (section.length > maxLength) {
        parts.push(...splitByParagraph(section, maxLength));
      } else if (section.trim()) {
        parts.push(section.trim());
      }
    }
    return parts.filter((p) => p.length > 0);
  }

  // 2. Sinon couper par paragraphe
  return splitByParagraph(text, maxLength);
}

/**
 * Accumule un paragraphe dans l'état de découpage.
 */
function accumulateParagraph(
  para: string,
  state: { current: string; parts: string[] },
  maxLength: number,
): void {
  const trimmedPara = para.trim();
  if (!trimmedPara) return;

  if (trimmedPara.length > maxLength) {
    if (state.current) {
      state.parts.push(state.current.trim());
      state.current = '';
    }
    state.parts.push(...splitBySentence(trimmedPara, maxLength));
    return;
  }

  if ((state.current + '\n\n' + trimmedPara).length > maxLength) {
    if (state.current) state.parts.push(state.current.trim());
    state.current = trimmedPara;
  } else {
    state.current += (state.current ? '\n\n' : '') + trimmedPara;
  }
}

/**
 * Découpe par double saut de ligne (paragraphes)
 */
function splitByParagraph(text: string, maxLength: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const state = { current: '', parts: [] as string[] };

  for (const para of paragraphs) {
    accumulateParagraph(para, state, maxLength);
  }

  if (state.current.trim()) state.parts.push(state.current.trim());

  return state.parts.filter((p) => p.length > 0);
}

/**
 * Découpe par phrase comme dernier recours
 */
function splitBySentence(text: string, maxLength: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).length > maxLength) {
      if (current) parts.push(current.trim());
      current = sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }

  if (current.trim()) parts.push(current.trim());

  return parts;
}

/**
 * Messages de feedback intelligents basés sur le nom de l'outil
 */
export const TOOL_FEEDBACK: Record<string, string> = {
  // Recherche
  duckduck_search: '🔍 Je cherche sur le web...',
  search_wikipedia: '📚 Je consulte Wikipédia...',
  search_google: '🔍 Je cherche sur Google...',

  // Création
  create_sticker: '🎨 Je crée ton sticker...',
  generate_image: '🖼️ Je génère une image...',

  // Voix
  text_to_speech: '🎙️ Je prépare un message vocal...',
  transcribe_audio: "🎧 J'écoute ton audio...",

  // Mémoire
  remember_fact: '📝 Je note ça...',
  recall_fact: '🧠 Je cherche dans ma mémoire...',

  // Modération
  gm_kick_user: '⚠️ Action de modération en cours...',
  gm_ban_user: '🚫 Bannissement en cours...',
  gm_mute_user: '🔇 Mise en sourdine...',

  // Traduction
  translate_text: '🌍 Je traduis...',

  // Défaut
  _default: '⏳ Je réfléchis...',
};

/**
 * Récupère le message de feedback approprié pour un outil
 * @param toolName Nom de l'outil
 * @returns Message de feedback
 */
export function getToolFeedback(toolName: string): string {
  return (Reflect.get(TOOL_FEEDBACK, toolName) as string | undefined) || TOOL_FEEDBACK._default;
}
