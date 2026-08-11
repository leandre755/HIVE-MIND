/**
 * Contrat de types partagé par les adapters TTS (`minimaxTTS`, `geminiTTS`,
 * `gttsTTS`), consommés par `src/services/voice/voiceProvider.ts`.
 *
 * Module autonome : aucun import depuis `../index.ts`.
 *
 * Comme pour les adapters de chat, aucun identifiant de modèle ni de voix
 * n'est déclaré ici : la liste fait foi dans `src/config/models_config.json`
 * (`voice_provider.tts_models[]` et `voice_provider.gemini_voices[]`), et
 * `VoiceProvider` la résout avant l'appel.
 */

/** Options de synthèse transmises par `VoiceProvider` à un adapter TTS. */
export interface TTSOptions {
  /** Identifiant du modèle, résolu depuis `voice_provider.tts_models[].model`. */
  model?: string;
  /** Nom de voix Gemini, résolu depuis `voice_provider.tts_models[].voice`. */
  voice?: string;
  /** Identifiant de voix Minimax, depuis `voice_provider.tts_models[].voice_id`. */
  voice_id?: string;
  /** Code de langue BCP-47 pour GTTS. */
  language?: string;
  speed?: number;
  vol?: number;
  pitch?: number;
  /** Consignes de jeu Gemini ("Director's Notes"). */
  style?: string;
  tone?: string;
  accent?: string;
  pace?: string;
  speaker_1?: string;
  speaker_2?: string;
}

/** Résultat d'une synthèse : audio OGG Opus prêt pour WhatsApp. */
export interface TTSResult {
  audioBuffer: Buffer;
  format: string;
  filePath?: string;
  provider?: string;
  model?: string;
}

/**
 * Configuration d'adapter injectée à la construction depuis
 * `voice_provider.minimax_config` de `models_config.json`.
 *
 * Ne contient que des réglages de rendu : ni modèle ni voix, qui arrivent par
 * appel via {@link TTSOptions}.
 */
export interface TTSAdapterConfig {
  speed?: number;
  vol?: number;
  pitch?: number;
  language?: string;
}
