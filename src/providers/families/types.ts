/**
 * Contrats partagés des moteurs de protocoles (regroupement des adapters par
 * famille de dialecte HTTP).
 *
 * Un `ProtocolFamily` décrit la mécanique réseau d'un dialecte (construction
 * d'URL, corps de requête, lecture de réponse et d'erreur) ; un `HeaderFamily`
 * décrit la seule construction des en-têtes d'authentification. Les adapters
 * historiques (src/providers/adapters/*.ts) sont réécrits par le routeur
 * familles comme de fines déclarations JSON + référence à ces moteurs.
 *
 * Module de types : aucune logique d'exécution ici, à l'image de
 * `src/providers/types.ts`. Il importe les contrats routeur depuis
 * `../types.js`, jamais l'inverse — pas de cycle `no-circular`.
 */

import type { AdapterChatOptions, AdapterChatResult, ChatMessage, FamilyConfig } from '../types.js';

/**
 * Contexte d'exécution transmis par l'adapter-famille aux méthodes d'un
 * `ProtocolFamily`. Toutes les données nécessaires à la construction de la
 * requête y transitent explicitement — le moteur ne lit aucune globale.
 */
export interface ProtocolContext {
  /** Identifiant modèle résolu par le routeur depuis `models_config.json`. */
  model: string;
  /** Clé API résolue par le routeur pour la tentative courante. */
  apiKey: string;
  /** Historique de conversation au format routeur. */
  messages: ChatMessage[];
  /** Options de l'appel (temperature, max_tokens, tools, passthrough…). */
  options: AdapterChatOptions;
  /** Entrée `familles.<nom>` de `models_config.json` (base_url, protocolOptions…). */
  familyConfig?: FamilyConfig;
  /**
   * Paramètres wire supplémentaires issus de la déclaration JSON ; seules les
   * clés listées dans `ProtocolFamily.wireParamKeys` sont recopiées dans le
   * corps (allowlist fail-closed).
   */
  wireParams?: Record<string, unknown>;
  /**
   * Réglages par famille lus par l'adapter sous `familyConfig.protocol_options`
   * et relayés au moteur (ex. `default_max_tokens`, `sanitize_tool_ids`,
   * `timeout_ms`). Absent quand la famille n'en déclare pas.
   */
  protocolOptions?: ProtocolOptions;
}

/**
 * Réglages par famille, lus sous `familyConfig.protocolOptions` dans
 * `models_config.json`. Chaque clé n'est consommée que si le moteur de
 * protocole concerné l'implémente ; déclaré EXACTEMENT une fois ici.
 */
export interface ProtocolOptions {
  /** `max_tokens` émis quand `options.max_tokens` est absent. */
  default_max_tokens?: number;
  /** `temperature` émise quand `options.temperature` est absente. */
  default_temperature?: number;
  /** Champs statiques fusionnés dans le corps (ex. `{ stream: false }`). */
  extra_body?: Record<string, unknown>;
  /** En-têtes statiques additionnels (consommés par le HeaderFamily). */
  extra_headers?: Record<string, string>;
  /** Clés de `options` recopiées telles quelles dans le corps (ex. reasoning). */
  passthrough_options?: string[];
  /**
   * Politique d'émission de `tool_choice` : `'auto'` toujours quand des tools
   * sont émis, `'gpt-only'` seulement si le modèle commence par `gpt`,
   * `'omit'` jamais.
   */
  tool_choice?: 'auto' | 'gpt-only' | 'omit';
  /** Réécrit les IDs de tool_call au format 9 caractères (Mistral/Codestral). */
  sanitize_tool_ids?: boolean;
  /** `'role-content-only'` réduit chaque message à `{ role, content }`. */
  messages_payload?: 'full' | 'role-content-only';
  /** Sous-chaînes : si le modèle en contient une, tools + tool_choice sont omis. */
  omit_tools_if_model_contains?: string[];
  /** Relaie `reasoning_content` des messages assistant entrants (Kimi/Groq R1). */
  relay_reasoning_content?: boolean;
  /** Expose `reasoning_content`/`reasoning` de la réponse en `reasoningContent`. */
  extract_reasoning_content?: boolean;
  /** Timeout HTTP spécifique à la famille, en millisecondes. */
  timeout_ms?: number;
}

/**
 * Moteur d'un dialecte HTTP. Les méthodes sont déclarées en style méthode
 * (bivariance volontaire, même convention que `ProviderAdapter`) : un moteur
 * peut omettre le paramètre `ctx` de `parseResponse` sans heurter
 * `strictFunctionTypes`.
 *
 * INVARIANT commun : `parseError` ne retourne jamais — il lève une `Error`
 * dont le message contient le statut HTTP, pour la classification quota du
 * routeur (`QUOTA_ERROR_PATTERN` matche 429/rate/limit).
 */
export interface ProtocolFamily {
  /** Identifiant stable du dialecte (ex. `'openai-compatible'`). */
  name: string;
  /** Construit l'URL complète de l'endpoint de chat pour cette requête. */
  buildUrl(ctx: ProtocolContext): string;
  /** Construit le corps JSON de la requête (sans sérialisation). */
  buildBody(ctx: ProtocolContext): Record<string, unknown>;
  /** Convertit la réponse brute en `AdapterChatResult` du contrat routeur. */
  parseResponse(data: unknown, ctx: ProtocolContext): AdapterChatResult;
  /** Lève l'erreur métier à partir du corps d'erreur et du statut HTTP. */
  parseError(body: unknown, status: number): never;
  /** `false` interdit toute émission de `tools` (fail-closed côté moteur). */
  supportsTools?: boolean;
  /** Clés de `wireParams` autorisées à fusionner dans le corps (allowlist). */
  wireParamKeys?: string[];
  /** Budget de temps HTTP par défaut en millisecondes. */
  timeoutMs?: number;
  /** En-têtes statiques propres au dialecte (hors authentification). */
  extraHeaders?: Record<string, string>;
}

/**
 * Contexte optionnel remis à un `HeaderFamily`. Tous les champs sont
 * optionnels : la construction d'en-têtes ne doit exiger que la clé API.
 */
export interface HeaderContext {
  /** Identifiant modèle résolu (en-têtes dépendant du modèle, ex. Groq). */
  model?: string;
  /** Nom du `ProtocolFamily` pilotant la requête. */
  protocol?: string;
  /** Entrée `familles.<nom>` de la configuration. */
  familyConfig?: FamilyConfig;
  /** Options de l'appel (ex. `version`). */
  options?: AdapterChatOptions;
}

/**
 * Constructeur des en-têtes HTTP d'une famille : authentification + en-têtes
 * statiques du dialecte. Style méthode, bivariance volontaire.
 */
export interface HeaderFamily {
  /** Identifiant stable du mode d'authentification (ex. `'bearer'`). */
  name: string;
  /** Construit le dictionnaire d'en-têtes complet de la requête. */
  buildHeaders(apiKey: string, ctx?: HeaderContext): Record<string, string>;
}
