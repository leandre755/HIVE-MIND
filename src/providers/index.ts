// providers/index.js
// providers/index.js
// Model Provider Layer - Routeur multi-familles

import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { safeReadFileSync } from '../utils/safeFs.js';
// LLM classifier permanently disabled — category is now always
// provided by the caller (e.g. category: 'AGENTIC') or defaults to AGENTIC.
import { envResolver } from '../services/envResolver.js';
import {
  applyPromptCaching,
  resolveCapabilities,
  resolveProtocolDialect,
  toWireParams,
  type GenerationParams,
  type ThinkingParams,
} from './GenerationParams.js';
import { GenericProviderAdapter } from './GenericProviderAdapter.js';
import type {
  AdapterChatOptions,
  AdapterChatResult,
  AdapterEmbedResult,
  ChatMessage,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let activeRuntime: unknown = null;
async function getRuntime() {
  if (activeRuntime) return activeRuntime;
  try {
    const serviceContainer = (
      globalThis as unknown as {
        container?: {
          has(name: string): boolean;
          get(name: string): unknown;
        };
      }
    ).container;
    if (serviceContainer?.has('runtime')) {
      activeRuntime = serviceContainer.get('runtime');
      return activeRuntime;
    }
  } catch {
    /* ignore */
  }
  const { AIRuntimeInfrastructure } = (await Function(
    'return import("../services/runtime/RuntimeInfrastructure.js")',
  )()) as { AIRuntimeInfrastructure: new () => unknown };
  activeRuntime = new AIRuntimeInfrastructure();
  return activeRuntime;
}

// Les formes de configuration sont déclarées en alias de type (et non en
// `interface`) : TypeScript ne dote d'une signature d'index implicite que les
// alias, ce qui permet de transmettre un `FamilyDefinition` dans
// `AdapterChatOptions.familyConfig` sans assertion.

/** Un modèle déclaré dans `familles.<nom>.modeles[]` de `models_config.json`. */
type ModelDefinition = { id: string; types?: string[] };

/** Une famille de providers déclarée dans `familles` de `models_config.json`. */
type FamilyDefinition = {
  nom_affiche?: string;
  service_enabled?: boolean;
  /**
   * Racine HTTP de la famille, relayée telle quelle aux adapters via
   * `AdapterChatOptions.familyConfig` (lue par `github`, `kimi`, `moonshot`).
   * Les autres clés présentes dans le JSON (`provider`, `description`) ne sont
   * consommées par aucun chemin de code et ne sont donc pas déclarées.
   */
  base_url?: string;
  modeles?: ModelDefinition[];
};

/** Cascade d'un service interne (`reglages_generaux.service_recipes.<nom>`). */
type ServiceRecipe = {
  model: string;
  fallback?: string;
  fallback_2?: string;
  temperature?: number;
};

/** Couple primaire/fallback d'une catégorie chat (`chat_recipes.categories.<nom>`). */
type ChatCategoryRecipe = { primary: string; fallback?: string; description?: string };

/** Cible d'embedding (`reglages_generaux.embeddings.primary` / `.fallback`). */
type EmbeddingTarget = { provider: string; model: string; dimensions?: number };

interface ModelsConfigJson {
  reglages_generaux: {
    famille_active?: string;
    familles_prioritaires?: string[];
    service_recipes?: Record<string, ServiceRecipe>;
    chat_recipes?: {
      categories?: Record<string, ChatCategoryRecipe>;
    };
    embeddings?: {
      primary?: EmbeddingTarget;
      fallback?: EmbeddingTarget;
    };
  };
  familles: Record<string, FamilyDefinition>;
}

/**
 * Réponse du routeur : la forme renvoyée par l'adapter, enrichie de la famille
 * et du modèle effectivement retenus par la cascade.
 */
export interface ChatResponse extends AdapterChatResult {
  usedFamily?: string;
  usedModel?: string;
}

export interface ChatOptions {
  family?: string;
  model?: string;
  fallbackFamily?: string;
  fallbackModel?: string;
  isServiceRecipe?: boolean;
  category?: string;
  temperature?: number;
  max_tokens?: number;
  isFallback?: boolean;
  [key: string]: unknown;
}

/**
 * Vue du routeur sur un adapter enregistré.
 *
 * `chat` et `embed` sont déclarés en **style méthode** : la vérification des
 * paramètres est alors bivariante, si bien qu'un adapter déclarant
 * `chat(messages: ChatMessage[], …)` (contrat de `./types.js`) satisfait ce
 * slot alors que le routeur relaie un `unknown[]` non validé venant de ses
 * appelants. Aucune assertion n'est nécessaire à la frontière.
 */
interface RegisteredAdapter {
  chat(messages: unknown[], options: AdapterChatOptions): Promise<AdapterChatResult>;
  embed?(text: string | string[], options: AdapterChatOptions): Promise<AdapterEmbedResult>;
}

/** Marges de sécurité passées au QuotaManager (fraction de la limite). */
interface QuotaThresholds {
  rpm: number;
  tpm: number;
  rpd: number;
}

/**
 * Surface du `quotaManager` réellement consommée par `chat()`. Déclarée
 * localement et non importée de `../services/quotaManager.js` : ce module
 * importe déjà le routeur en aval, un import (même de type) créerait un cycle
 * signalé par `no-circular`.
 */
interface ChatQuotaManager {
  getHealthyFamilies(
    familiesConfig: Record<string, FamilyDefinition>,
    thresholds: QuotaThresholds,
  ): Promise<string[]>;
  getAvailableKeyForModel(
    modelId: string,
    family: string,
    thresholds: QuotaThresholds,
  ): Promise<number | null>;
  recordQuotaExceeded(modelId: string, waitSeconds: number, keyIndex: number): Promise<void>;
  recordUsage(
    family: string,
    modelId: string,
    estimatedTokens: number,
    keyIndex: number,
  ): Promise<void>;
}

/** Surface du `quotaManager` consommée par `callServiceRecipe()`. */
interface RecipeQuotaManager {
  isModelAvailable(modelId: string): Promise<boolean>;
}

/** Surface du `quotaManager` consommée par `embed()`. */
interface EmbedQuotaManager {
  isModelAvailable(modelId: string): Promise<boolean>;
  recordUsage(family: string, modelId: string, estimatedTokens: number): Promise<void>;
}

/**
 * Surface de `AIRuntimeInfrastructure` consommée par le routeur (KKT + FinOps).
 * Déclarée localement pour la même raison de cycle que {@link ChatQuotaManager}.
 */
interface RuntimeWithFinOps {
  finOps: {
    calculateLambda(): number;
    recordUsage(
      modelId: string,
      promptTokens: number,
      completionTokens: number,
    ): { budgetSafe: boolean };
  };
}

/** Marges du filtrage de santé nominal (niveau 2 du routage). */
const PRIMARY_HEALTH_THRESHOLDS: QuotaThresholds = { rpm: 0.2, tpm: 0.1, rpd: 0.05 };
/** Marges relâchées du mode secours, quand aucune famille prioritaire ne passe. */
const EMERGENCY_HEALTH_THRESHOLDS: QuotaThresholds = { rpm: 0.05, tpm: 0.05, rpd: 0.02 };
/** Marges de la sélection proactive de clé (Zero-429). */
const KEY_SELECTION_THRESHOLDS: QuotaThresholds = { rpm: 0.2, tpm: 0.1, rpd: 0.05 };
/** Types de modèles exclus de la rotation chat, pour préserver les quotas texte. */
const EXCLUDED_ROTATION_TYPES: readonly string[] = [
  'live_api',
  'tts',
  'stt',
  'audio',
  'transcription',
];
/** Seuil de λ (KKT) au-delà duquel `max_tokens` est bridé. */
const BUDGET_THROTTLE_LAMBDA = 0.05;
/** `max_tokens` retenu quand l'appelant n'en fournit pas. */
const DEFAULT_MAX_TOKENS = 4096;
/** Plancher de `max_tokens` sous bridage, pour garder une réponse exploitable. */
const MIN_THROTTLED_MAX_TOKENS = 200;
/** Signature d'une erreur de quota / limite de débit, tous fournisseurs. */
const QUOTA_ERROR_PATTERN = /(quota|limit|rate|429|insufficient)/;
/** Blocage par défaut d'un couple modèle+clé quand l'API ne précise pas l'attente. */
const DEFAULT_QUOTA_WAIT_SECONDS = 60;
/** Ratio caractères → jetons utilisé quand la réponse ne porte pas d'`usage`. */
const CHARS_PER_TOKEN = 4;

/** Message lisible d'une valeur levée, `Error` ou non. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Estimation grossière des jetons consommés, utilisée uniquement quand
 * l'adapter ne renvoie pas d'`usage` : somme des longueurs de contenu divisée
 * par {@link CHARS_PER_TOKEN}.
 */
function estimateTokens(messages: unknown[], responseContent: string | null): number {
  const promptChars = messages
    .map((entry) => {
      const message = entry as { content?: string };
      return message.content || '';
    })
    .join(' ').length;
  return Math.ceil((promptChars + (responseContent || '').length) / CHARS_PER_TOKEN);
}

// Charger les configurations
let modelsConfig: ModelsConfigJson;
try {
  modelsConfig = JSON.parse(
    safeReadFileSync(join(__dirname, '..', 'config', 'models_config.json')),
  ) as ModelsConfigJson;
} catch (error) {
  console.error('❌ Erreur chargement config providers:', describeError(error));
  modelsConfig = { reglages_generaux: { famille_active: 'openai' }, familles: {} };
}

// Index des sections adressées par clé dynamique. `new Map(Object.entries(…))`
// remplace les accès `objet[clé]` : le bracket dynamique disparaît (plus de
// `security/detect-object-injection`) et le type de valeur devient explicite.
// Construits une fois au chargement du module — la configuration est en
// lecture seule ensuite, donc aucune allocation par appel.
const familyConfigs = new Map<string, FamilyDefinition>(Object.entries(modelsConfig.familles));
const serviceRecipes = new Map<string, ServiceRecipe>(
  Object.entries(modelsConfig.reglages_generaux.service_recipes ?? {}),
);
const chatCategories = new Map<string, ChatCategoryRecipe>(
  Object.entries(modelsConfig.reglages_generaux.chat_recipes?.categories ?? {}),
);

/**
 * Interface unifiée pour tous les providers
 */
class ProviderRouter {
  adapters: Map<string, RegisteredAdapter>;
  currentFamily: string;
  forcedFamily?: string;
  forcedModel?: string;
  /** Failure score par modèle (non-quota) : plus haut = relégué en fin de rotation */
  modelFailureScore: Map<string, { score: number; lastFailureAt: number }>;

  constructor() {
    this.adapters = new Map();
    this.currentFamily = modelsConfig.reglages_generaux?.famille_active || 'openai';
    this.modelFailureScore = new Map(); // Reliability score par modèle
  }

  /**
   * Enregistre un adaptateur pour une famille
   */
  registerAdapter(familyName: string, adapter: RegisteredAdapter) {
    this.adapters.set(familyName, adapter);
  }

  /**
   * Parse un model string pour extraire family et model
   * Ex: "qwen/qwen3-32b" → { family: "groq", model: "qwen/qwen3-32b" }
   * Ex: "kimi-for-coding" → { family: "kimi", model: "kimi-for-coding" }
   */
  parseModelString(modelStr: string): { family: string; model: string } | null {
    const priorityFamilies = modelsConfig.reglages_generaux.familles_prioritaires || [];
    const orderedFamilies = [...new Set([...priorityFamilies, ...familyConfigs.keys()])];

    // Chercher dans toutes les familles par ordre de priorité
    for (const familyName of orderedFamilies) {
      const familyConfig = familyConfigs.get(familyName);
      if (!familyConfig) continue;
      const model = familyConfig.modeles?.find((m) => m.id === modelStr);
      if (model) {
        return { family: familyName, model: modelStr };
      }
    }

    // Si pas trouvé, retourner null
    console.warn(`[Router] ⚠️ Modèle ${modelStr} non trouvé dans la config`);
    return null;
  }

  /**
   * Appel direct d'une recette de service (sans classification Level 3)
   * Utilise le modèle assigné + fallback automatique si nécessaire
   */
  async callServiceRecipe(
    serviceName: string,
    messages: unknown[],
    options: ChatOptions = {},
  ): Promise<ChatResponse> {
    const recipe = serviceRecipes.get(serviceName);

    if (!recipe) {
      throw new Error(
        `[Router] Service recipe "${serviceName}" non trouvé dans models_config.json`,
      );
    }

    console.log(`[Router] 🔧 Service Recipe: ${serviceName} → ${recipe.model}`);

    const quotaManager = await this._resolveQuotaManager<RecipeQuotaManager>();
    // Cascade primary → fallback → fallback_2. Le primaire est conservé même
    // vide : `parseModelString` le rejettera avec un avertissement nommé plutôt
    // que de masquer une recette mal configurée.
    const fallbacks = [recipe.fallback, recipe.fallback_2].filter(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
    );
    const modelsToTry = [recipe.model, ...fallbacks];
    const fallbackModels = new Set(fallbacks);

    let lastError: unknown = null;
    let triedAny = false;

    for (const modelStr of modelsToTry) {
      const parsed = this.parseModelString(modelStr);
      if (!parsed) {
        console.warn(`[Router] ⚠️ Modèle ${modelStr} invalide, skip`);
        continue;
      }

      const usable = await this._isRecipeCandidateUsable(modelStr, parsed, quotaManager);
      if (!usable) continue;

      triedAny = true;
      try {
        // Appel avec température du service
        const result = await this.chat(messages, {
          ...options,
          family: parsed.family,
          model: parsed.model,
          temperature: recipe.temperature ?? options.temperature,
          isServiceRecipe: true, // Flag pour éviter classification
          isFallback: fallbackModels.has(modelStr),
        });

        if (fallbackModels.has(modelStr)) {
          console.log(`[Router] ⚠️ ${serviceName} utilisé fallback: ${modelStr}`);
        }

        return result;
      } catch (error) {
        console.warn(`[Router] ❌ ${serviceName}/${modelStr} échec: ${describeError(error)}`);
        lastError = error;
      }
    }

    if (!triedAny) {
      throw new Error(
        `[Router] 🛑 Service ${serviceName} échec total : tous les modèles de la cascade sont indisponibles ou en cooldown.`,
      );
    }

    throw new Error(
      `[Router] 🛑 Service ${serviceName} échec total. Dernière erreur: ${describeError(lastError)}`,
    );
  }

  /**
   * Récupère le `quotaManager` du conteneur de services, ou `null` s'il n'y est
   * pas enregistré (démarrage partiel, tests unitaires).
   *
   * INVARIANT : ne lève jamais. Un conteneur indisponible dégrade le routage
   * vers le mode « sans suivi de quota », il ne l'interrompt pas.
   *
   * @typeParam T Sous-ensemble de la surface du gestionnaire dont l'appelant a besoin.
   */
  private async _resolveQuotaManager<T>(): Promise<T | null> {
    try {
      const serviceContainer = (
        globalThis as unknown as {
          container?: {
            has(name: string): boolean;
            get(name: string): unknown;
          };
        }
      ).container;
      if (!serviceContainer?.has('quotaManager')) return null;
      return serviceContainer.get('quotaManager') as T;
    } catch (error) {
      console.warn('[Router] QuotaManager non dispo via container:', describeError(error));
      return null;
    }
  }

  /**
   * Décide si un modèle de cascade de service peut être tenté : quota obtenu
   * auprès du QuotaManager (la protection anti-429 est le blocage Redis par
   * modèle+clé, pas un circuit breaker).
   *
   * @returns `true` si l'appel peut être émis, `false` si le modèle doit être sauté.
   */
  private async _isRecipeCandidateUsable(
    modelStr: string,
    parsed: { family: string; model: string },
    quotaManager: RecipeQuotaManager | null,
  ): Promise<boolean> {
    if (!quotaManager) return true;

    const isAvailable = await quotaManager.isModelAvailable(parsed.model);
    if (!isAvailable) {
      console.log(
        `[Router] ⏭️ Modèle ${modelStr} de service sauté direct : quota épuisé ou clé bloquée`,
      );
      return false;
    }
    return true;
  }

  /**
   * Retourne les modèles candidats pour une catégorie chat Level 3
   */
  getChatCandidates(category: string) {
    const categoryConfig = chatCategories.get(category);

    if (!categoryConfig) {
      console.warn(`[Router] ⚠️ Catégorie chat "${category}" introuvable`);
      return null;
    }

    return {
      primary: categoryConfig.primary,
      fallback: categoryConfig.fallback,
      description: categoryConfig.description,
    };
  }

  /**
   * Récupère la configuration d'une famille
   */
  getFamilyConfig(familyName: string = this.currentFamily) {
    return familyConfigs.get(familyName);
  }

  /**
   * Récupère la clé API d'une famille
   */
  getApiKey(
    familyName: string = this.currentFamily,
    keyIndex: number | null = null,
  ): string | null {
    return envResolver.resolveProviderKey(familyName, keyIndex);
  }

  // =========================================================================
  // RELIABILITY SCORING — Modèles défaillants relegués en fin de rotation
  // =========================================================================

  /**
   * Incrémente le failure score d'un modèle non-quota.
   * Score max: 10. Décroît de 50% toutes les 30 minutes (half-life).
   */
  _recordModelFailure(model: string) {
    const now = Date.now();
    const HALF_LIFE_MS = 30 * 60 * 1000; // 30 min
    const existing = this.modelFailureScore.get(model) || { score: 0, lastFailureAt: now };

    // Appliquer le déclin exponentiel depuis le dernier échec
    const elapsed = now - existing.lastFailureAt;
    const decayFactor = Math.pow(0.5, elapsed / HALF_LIFE_MS);
    const decayedScore = existing.score * decayFactor;

    const newScore = Math.min(10, decayedScore + 1);
    this.modelFailureScore.set(model, { score: newScore, lastFailureAt: now });
    console.log(`[Router] 📉 Reliability score ${model}: ${newScore.toFixed(2)} (+1 échec)`);
  }

  /**
   * Trie un tableau de modèles par fiabilité : les moins défaillants en premier.
   * Les modèles sans historique d'échec restent à leur position.
   */
  _sortModelsByReliability(models: string[]): string[] {
    const now = Date.now();
    const HALF_LIFE_MS = 30 * 60 * 1000;

    return [...models].sort((a, b) => {
      const statsA = this.modelFailureScore.get(a);
      const statsB = this.modelFailureScore.get(b);

      // Calculer le score actuel (avec déclin temporel)
      const scoreA = statsA
        ? statsA.score * Math.pow(0.5, (now - statsA.lastFailureAt) / HALF_LIFE_MS)
        : 0;
      const scoreB = statsB
        ? statsB.score * Math.pow(0.5, (now - statsB.lastFailureAt) / HALF_LIFE_MS)
        : 0;

      return scoreA - scoreB; // Moins d'échecs en premier
    });
  }

  /**
   * Appel chat unifié avec Fallback automatique
   */
  /**
   * Smart Router Chat Logic
   * Level 1: Context (Sticky Session)
   * Level 2: Availability (QuotaManager — Zero-429)
   * Level 3: Category Resolution (caller-provided or default AGENTIC — NO LLM call)
   *
   * INVARIANT : la fonction retourne soit une réponse d'adapter enrichie de
   * `usedFamily`/`usedModel`, soit lève une erreur nommée. Elle ne retourne
   * jamais une réponse partielle ni `null`.
   */
  async chat(messages: unknown[], rawOptions: ChatOptions = {}): Promise<ChatResponse> {
    console.log(
      `[Router Debug] chat called. messages type: ${typeof messages}, isArray: ${Array.isArray(messages)}`,
    );
    const options = { ...rawOptions };
    if (this.forcedFamily) {
      options.family = this.forcedFamily;
    }
    if (this.forcedModel) {
      options.model = this.forcedModel;
    }

    const quotaManager = await this._resolveQuotaManager<ChatQuotaManager>();

    // NIVEAUX 1 & 2 : contexte (sticky session) puis disponibilité proactive.
    const availableFamilies = await this._selectAvailableFamilies(options, quotaManager);
    if (availableFamilies.length === 0) {
      throw new Error(
        '[Router] 🛑 Aucune famille IA disponible (Toutes épuisées ou sans clé API). Vérifiez credentials.json ou attendez le reset des quotas.',
      );
    }

    // NIVEAU 3 : résolution de catégorie. Mute `options` et réordonne la
    // cascade pour placer le primaire puis le fallback en tête.
    const orderedFamilies = this._applyCategoryRouting(options, availableFamilies);

    return this._runCascade(messages, options, orderedFamilies, quotaManager);
  }

  /**
   * NIVEAUX 1 & 2 du routage : restreint les familles candidates au contexte
   * (famille forcée), puis à celles réellement dotées d'une clé, autorisées
   * pour les recettes de service, et jugées saines par le QuotaManager.
   *
   * INVARIANT : ne retourne que des familles pour lesquelles
   * {@link ProviderRouter.isAvailable} est vrai. Un tableau vide signale qu'il
   * n'existe aucun candidat, y compris après le mode secours.
   */
  private async _selectAvailableFamilies(
    options: ChatOptions,
    quotaManager: ChatQuotaManager | null,
  ): Promise<string[]> {
    // ── NIVEAU 1 : CONTEXTE (STICKY SESSION) ──
    let preferredFamilies = modelsConfig.reglages_generaux.familles_prioritaires || [];
    if (options.family) {
      preferredFamilies = [options.family];
      console.log(`[Router] 🔒 Famille forcée par contexte: ${options.family}`);
    }

    // ── NIVEAU 2 : DISPONIBILITÉ PROACTIVE (ZERO-429) ──
    let availableFamilies = this._filterUsableFamilies(preferredFamilies, options);

    if (quotaManager) {
      try {
        const healthyFamilies = await quotaManager.getHealthyFamilies(
          modelsConfig.familles,
          PRIMARY_HEALTH_THRESHOLDS,
        );
        availableFamilies = availableFamilies.filter((f) => healthyFamilies.includes(f));
      } catch (error) {
        console.warn(
          '[Router] Erreur health check, fallback sur filtre basique:',
          describeError(error),
        );
      }
    }

    if (availableFamilies.length > 0) return availableFamilies;

    return this._selectEmergencyFamilies(options, quotaManager);
  }

  /**
   * Mode SECOURS : rouvre la sélection à toutes les familles configurées avec
   * des marges de quota abaissées ({@link EMERGENCY_HEALTH_THRESHOLDS}).
   */
  private async _selectEmergencyFamilies(
    options: ChatOptions,
    quotaManager: ChatQuotaManager | null,
  ): Promise<string[]> {
    console.warn(
      '[Router] ⚠️ TOUS les modèles prioritaires sont épuisés ou proches des limites ! Passage en mode SECOURS.',
    );

    const availableFamilies = this._filterUsableFamilies([...familyConfigs.keys()], options);
    if (!quotaManager || availableFamilies.length === 0) return availableFamilies;

    try {
      const emergencyHealthy = await quotaManager.getHealthyFamilies(
        modelsConfig.familles,
        EMERGENCY_HEALTH_THRESHOLDS,
      );
      // Aucune famille saine même en urgence : fail-closed. Le mode SECOURS a
      // déjà relâché les marges (EMERGENCY_HEALTH_THRESHOLDS) ; court-circuiter
      // le check de santé émettrait des requêtes non protégées (risque 429). Le
      // circuit breaker est vestigial (jamais déclenché) : il ne peut pas
      // trancher. Le tableau vide laisse `chat()` lever une erreur nommée claire.
      return availableFamilies.filter((f) => emergencyHealthy.includes(f));
    } catch (error) {
      console.warn('[Router] Health check de secours indisponible:', describeError(error));
      return availableFamilies;
    }
  }

  /**
   * Retient les familles dotées d'une clé API et, pour une recette de service,
   * non désactivées par `service_enabled: false`.
   */
  private _filterUsableFamilies(families: string[], options: ChatOptions): string[] {
    return families.filter((family) => {
      if (!this.isAvailable(family)) return false;
      if (!options.isServiceRecipe) return true;
      return familyConfigs.get(family)?.service_enabled !== false;
    });
  }

  /**
   * NIVEAU 3 : résout la catégorie fournie par l'appelant (ou `AGENTIC`) en un
   * couple modèle primaire / fallback, **mute `options`** en conséquence et
   * remonte les familles correspondantes en tête de cascade.
   *
   * Sans catégorie exploitable — ou lorsque l'appelant impose déjà une famille,
   * un modèle, ou passe par une recette de service — l'ordre initial est rendu
   * inchangé.
   */
  private _applyCategoryRouting(options: ChatOptions, availableFamilies: string[]): string[] {
    // La catégorie est TOUJOURS fournie par l'appelant (ex: core/index.ts passe
    // category: 'AGENTIC'). Sans catégorie, on retient AGENTIC. Plus de
    // classification LLM.
    if (options.family || options.model || options.isServiceRecipe) return availableFamilies;

    const category = options.category || 'AGENTIC';
    console.log(`[Router] 🎯 Catégorie: ${category}${options.category ? '' : ' (défaut)'}`);

    const candidates = this.getChatCandidates(category);
    if (!candidates?.primary) return availableFamilies;

    console.log(`[Router] 📋 Modèles: ${candidates.primary} (fallback: ${candidates.fallback})`);

    const primaryParsed = this.parseModelString(candidates.primary);
    if (!primaryParsed) return availableFamilies;

    const fallbackParsed = candidates.fallback ? this.parseModelString(candidates.fallback) : null;

    options.family = primaryParsed.family;
    options.model = primaryParsed.model;
    if (fallbackParsed) {
      options.fallbackFamily = fallbackParsed.family;
      options.fallbackModel = fallbackParsed.model;
    }

    return this._prioritizeFamilies(
      availableFamilies,
      primaryParsed.family,
      fallbackParsed?.family,
    );
  }

  /**
   * Réordonne la cascade : famille primaire d'abord, famille de fallback
   * ensuite, le reste dans son ordre d'origine.
   *
   * INVARIANT : le résultat est une permutation de `families` — aucune entrée
   * n'est ajoutée ni retirée. Une famille absente de la liste (donc jugée
   * indisponible en amont) n'est jamais réintroduite.
   */
  private _prioritizeFamilies(
    families: string[],
    primaryFamily: string,
    fallbackFamily?: string,
  ): string[] {
    const head: string[] = [];
    if (families.includes(primaryFamily)) head.push(primaryFamily);
    if (
      fallbackFamily &&
      fallbackFamily !== primaryFamily &&
      families.includes(fallbackFamily) &&
      head.length > 0
    ) {
      head.push(fallbackFamily);
    }
    if (head.length === 0) return families;
    return [...head, ...families.filter((f) => !head.includes(f))];
  }

  /**
   * EXÉCUTION : parcourt les familles puis leurs modèles jusqu'au premier
   * succès. Lève une erreur nommée si la cascade s'épuise.
   */
  private async _runCascade(
    messages: unknown[],
    options: ChatOptions,
    availableFamilies: string[],
    quotaManager: ChatQuotaManager | null,
  ): Promise<ChatResponse> {
    let lastError: unknown = null;

    for (const family of availableFamilies) {
      const adapter = this.adapters.get(family);
      if (!adapter) {
        console.warn(
          `[Router] ⚠️ Adaptateur manquant pour ${family}, passage à la famille suivante...`,
        );
        continue;
      }

      const familyOutcome = await this._runFamilyModels({
        messages,
        options,
        family,
        adapter,
        availableFamilies,
        quotaManager,
      });
      if (familyOutcome.response) return familyOutcome.response;
      lastError = familyOutcome.error ?? lastError;
    }

    throw new Error(
      `[Router] Échec total de la cascade. Dernière erreur: ${describeError(lastError)}`,
    );
  }

  /**
   * Épuise les modèles d'une famille donnée jusqu'au premier succès.
   *
   * INVARIANT : au retour, `response` est renseigné en cas de succès (de la
   * famille ou du fallback d'urgence) et `error` porte sinon la dernière
   * erreur observée — `null` si aucun modèle n'a émis de requête. La protection
   * anti-429 est assurée en amont par le blocage Redis (par modèle+clé) ; un
   * échec non-quota laisse le parcours continuer vers les modèles suivants.
   */
  private async _runFamilyModels(context: {
    messages: unknown[];
    options: ChatOptions;
    family: string;
    adapter: RegisteredAdapter;
    availableFamilies: string[];
    quotaManager: ChatQuotaManager | null;
  }): Promise<{ response?: ChatResponse; error?: unknown }> {
    const { messages, options, family, adapter, availableFamilies, quotaManager } = context;
    let lastError: unknown = null;

    for (const model of this._resolveModelsToTry(family, options)) {
      const attemptOutcome = await this._tryModelAcrossKeys({
        messages,
        options,
        family,
        adapter,
        model,
        quotaManager,
      });

      if (attemptOutcome.response) return { response: attemptOutcome.response };
      lastError = attemptOutcome.error ?? lastError;

      const emergency = await this._retryWithoutForcedFamily(
        messages,
        options,
        availableFamilies,
        family,
      );
      if (emergency) return { response: emergency };
    }

    return { error: lastError };
  }

  /**
   * Modèles à tenter pour une famille : le modèle forcé (et son fallback de
   * même famille) s'ils s'appliquent, sinon les modèles `chat` de la famille
   * triés par fiabilité.
   */
  private _resolveModelsToTry(family: string, options: ChatOptions): string[] {
    const forced: string[] = [];
    if (options.model && family === options.family) {
      // Modèle spécifique forcé ET famille correspondante
      forced.push(options.model);
    }
    if (
      options.fallbackModel &&
      family === options.fallbackFamily &&
      !forced.includes(options.fallbackModel)
    ) {
      // Fallback déclaré dans la même famille
      forced.push(options.fallbackModel);
    }
    if (forced.length > 0) return forced;

    // Sinon (fallback ou famille différente), on prend les modèles 'chat' de
    // cette famille. Smart Router V2 : les modèles purement audio/live sont
    // exclus pour préserver les quotas texte, sauf pour les services internes.
    const rawModels =
      this.getFamilyConfig(family)
        ?.modeles?.filter((m) => {
          if (!m.types?.includes('chat')) return false;
          if (options.isServiceRecipe) return true;
          return !m.types.some((t) => EXCLUDED_ROTATION_TYPES.includes(t));
        })
        .map((m) => m.id) || [];

    // [RELIABILITY] Modèles défaillants relégués en fin de rotation
    return this._sortModelsByReliability(rawModels);
  }

  /**
   * Épuise les clés API disponibles pour un couple famille/modèle.
   *
   * INVARIANT : exactement un des deux champs `response` / `error` est
   * renseigné à la sortie, sauf quand toutes les clés sont préemptivement
   * bloquées par le QuotaManager — cas où aucune requête n'a été émise et où
   * les deux champs restent vides.
   */
  private async _tryModelAcrossKeys(context: {
    messages: unknown[];
    options: ChatOptions;
    family: string;
    adapter: RegisteredAdapter;
    model: string;
    quotaManager: ChatQuotaManager | null;
  }): Promise<{ response?: ChatResponse; error?: unknown }> {
    const { messages, options, family, adapter, model, quotaManager } = context;

    const availableIndices = envResolver.getAvailableKeysForProvider(family);
    const maxKeyAttempts = availableIndices?.length ? availableIndices.length : 1;

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxKeyAttempts; attempt++) {
      const keyIndex = await this._selectKeyIndex(model, family, quotaManager);
      if (keyIndex === null) {
        // Plus aucune clé valide pour ce modèle : on passe au modèle suivant.
        return { error: lastError };
      }

      try {
        const response = await this._invokeAdapter({
          messages,
          options,
          family,
          adapter,
          model,
          keyIndex,
          quotaManager,
        });
        return { response };
      } catch (error) {
        lastError = error;
        const errorMessage = describeError(error);
        console.warn(
          `[Router] ⚠️ Échec ${family}/${model} (Clé ${keyIndex}): ${errorMessage.substring(0, 200)}...`,
        ); // Limit length

        const isQuotaError = QUOTA_ERROR_PATTERN.test(errorMessage.toLowerCase());
        if (!isQuotaError || !quotaManager) {
          // Erreur non-quota : dégrader le score de fiabilité du modèle.
          this._recordModelFailure(model);
          return { error };
        }

        await this._blockExhaustedKey(model, keyIndex, errorMessage, quotaManager);

        // 🔄 INNER RETRY LOOP : s'il reste des clés pour CE modèle, on réessaie.
        if (attempt >= maxKeyAttempts) return { error };
        console.log(`[Router] 🔄 Basculement transparent sur la clé suivante pour ${model}...`);
      }
    }

    return { error: lastError };
  }

  /**
   * [ZERO-429] Sélection proactive de la clé la moins sollicitée.
   *
   * @returns L'index de clé à utiliser, ou `null` si toutes sont épuisées.
   *   En l'absence de QuotaManager, la clé 1 est retenue.
   */
  private async _selectKeyIndex(
    model: string,
    family: string,
    quotaManager: ChatQuotaManager | null,
  ): Promise<number | null> {
    if (!quotaManager) return 1;

    const bestKeyIndex = await quotaManager.getAvailableKeyForModel(
      model,
      family,
      KEY_SELECTION_THRESHOLDS,
    );
    if (bestKeyIndex === null) {
      console.log(`[Router] ⏭️ ${model} skipped: Toutes les clés sont épuisées (429 Proactif)`);
      return null;
    }
    return bestKeyIndex;
  }

  /**
   * Émet l'appel à l'adapter puis enregistre les compteurs de succès.
   *
   * INVARIANT : à chaque retour normal, la consommation est enregistrée côté
   * FinOps. Un dépassement de budget lève `BUDGET_EXCEEDED` **après**
   * comptabilisation, jamais avant.
   */
  private async _invokeAdapter(context: {
    messages: unknown[];
    options: ChatOptions;
    family: string;
    adapter: RegisteredAdapter;
    model: string;
    keyIndex: number;
    quotaManager: ChatQuotaManager | null;
  }): Promise<ChatResponse> {
    const { messages, options, family, adapter, model, keyIndex, quotaManager } = context;

    const runtimeInstance = (await getRuntime()) as RuntimeWithFinOps;
    const activeOptions = this._applyBudgetThrottling(options, runtimeInstance);

    // Traduction GenerationParams → champs filaires (injection limitée aux
    // familles déclaratives : `protocol_family` ou `capacites` dans le JSON).
    const { effectiveMessages, wireParams } = this._prepareWireParams(
      family,
      model,
      messages,
      activeOptions,
    );

    console.log(`[Router] 🚀 Tentative: ${family} → ${model} (Clé ${keyIndex})`);
    const result = await adapter.chat(effectiveMessages, {
      ...activeOptions,
      model,
      apiKey: this.getApiKey(family, keyIndex) || '',
      keyIndex, // Passer l'index pour que l'adapter puisse incrémenter le bon compteur
      familyConfig: this.getFamilyConfig(family),
      ...(wireParams !== undefined ? { wireParams } : {}),
    });

    // ✅ SUCCÈS
    // 💰 [FINOPS] Enregistrer le coût via AIRuntimeInfrastructure (Kill Switch)
    const promptTokens = result.usage?.prompt_tokens || 0;
    const completionTokens = result.usage?.completion_tokens || 0;
    const usageRecord = runtimeInstance.finOps.recordUsage(model, promptTokens, completionTokens);

    if (!usageRecord.budgetSafe) {
      throw new Error(
        'BUDGET_EXCEEDED: Le budget maximum de la session a été atteint. Arrêt de sécurité.',
      );
    }

    // 📊 Enregistrer Usage (QuotaManager) — tokens estimés si usage absent
    if (quotaManager) {
      const estimatedTokens =
        promptTokens + completionTokens || estimateTokens(messages, result.content);
      await quotaManager.recordUsage(family, model, estimatedTokens, keyIndex);
    }

    return { ...result, usedFamily: family, usedModel: model };
  }

  /**
   * ── KKT Lagrangian Throttling ── Bride `max_tokens` quand le multiplicateur
   * λ signale une érosion du budget de session.
   *
   * INVARIANT : `options` n'est jamais muté ; une copie est renvoyée.
   */
  private _applyBudgetThrottling(
    options: ChatOptions,
    runtimeInstance: RuntimeWithFinOps,
  ): ChatOptions {
    const activeOptions = { ...options };
    const lambda = runtimeInstance.finOps.calculateLambda();
    if (lambda <= BUDGET_THROTTLE_LAMBDA) return activeOptions;

    const baseMaxTokens = options.max_tokens || DEFAULT_MAX_TOKENS;
    const throttledMaxTokens = Math.max(
      MIN_THROTTLED_MAX_TOKENS,
      Math.floor(baseMaxTokens * (1 - lambda)),
    );
    activeOptions.max_tokens = throttledMaxTokens;
    console.log(
      `[Router:KKT] ⚠️ Budget Slack depletion detected (λ = ${lambda.toFixed(2)}). Throttling max_tokens: ${baseMaxTokens} → ${throttledMaxTokens}`,
    );
    return activeOptions;
  }

  /**
   * Traduit les paramètres de génération normalisés en champs filaires par
   * dialecte (point d'injection unique, après le bridage KKT).
   *
   * APPLICABILITÉ : l'injection n'a lieu QUE si l'entrée `familles.<family>`
   * du JSON existe ET déclare une clé `protocol_family` ou `capacites` non
   * `undefined` (sondée via `Object.hasOwn`). Dans tous les autres cas —
   * natifs conservés en fichiers dédiés (cohere, cloudflare, huggingface,
   * modal, groq) ou familles sans déclaration — le comportement courant est
   * préservé exactement : messages inchangés, aucun `wireParams` émis.
   *
   * `activeOptions` (options POST-bridage budgétaire) est la source de
   * vérité : le `max_tokens` bridé alimente à la fois `params.maxTokens` et
   * le plafond effectif de `toWireParams`, de sorte qu'un éventuel budget de
   * raisonnement Anthropic reste strictement inférieur au plafond réellement
   * émis.
   *
   * INVARIANT : le paramètre `messages` n'est jamais muté — quand le prompt
   * caching s'applique, `applyPromptCaching` renvoie une copie annotée qui
   * est la seule relayée à l'adapter.
   *
   * @param family Nom de la famille JSON courante.
   * @param model Identifiant du modèle tenté.
   * @param messages Historique d'entrée (non muté).
   * @param activeOptions Options post-bridage budgétaire (non mutées).
   * @returns Messages effectifs et `wireParams` à fusionner — `undefined`
   *   quand la traduction ne produit aucun champ (la clé n'est alors pas
   *   posée dans le littéral d'appel).
   * @throws {GenerationParamsError} Sur paramètre invalide ou déclaration
   *   incohérente : remonte telle quelle, le `catch` de `_tryModelAcrossKeys`
   *   la classe en échec non-quota (message sans motif quota).
   */
  private _prepareWireParams(
    family: string,
    model: string,
    messages: unknown[],
    activeOptions: ChatOptions,
  ): { effectiveMessages: unknown[]; wireParams?: Record<string, unknown> } {
    const familyEntry = familyConfigs.get(family);
    if (familyEntry === undefined) {
      return { effectiveMessages: messages };
    }
    const declaresProtocol =
      Object.hasOwn(familyEntry, 'protocol_family') &&
      Reflect.get(familyEntry, 'protocol_family') !== undefined;
    const declaresCapabilities =
      Object.hasOwn(familyEntry, 'capacites') &&
      Reflect.get(familyEntry, 'capacites') !== undefined;
    if (!declaresProtocol && !declaresCapabilities) {
      return { effectiveMessages: messages };
    }

    const dialect = resolveProtocolDialect(family, familyEntry);
    const caps = resolveCapabilities(model, familyEntry);

    // Seules les clés effectivement définies sont reprises dans les paramètres
    // normalisés (les absences restent des absences côté filaire).
    const params: GenerationParams = {};
    if (Object.hasOwn(activeOptions, 'thinking')) {
      const thinking = Reflect.get(activeOptions, 'thinking') as ThinkingParams | undefined;
      if (thinking !== undefined) params.thinking = thinking;
    }
    if (activeOptions.max_tokens !== undefined) {
      params.maxTokens = activeOptions.max_tokens;
    }
    if (activeOptions.temperature !== undefined) {
      params.temperature = activeOptions.temperature;
    }
    if (Object.hasOwn(activeOptions, 'promptCaching')) {
      const promptCaching = Reflect.get(activeOptions, 'promptCaching') as boolean | undefined;
      if (promptCaching !== undefined) params.promptCaching = promptCaching;
    }

    const wire = toWireParams(dialect, params, caps, activeOptions.max_tokens);

    let effectiveMessages = messages;
    if (params.promptCaching === true) {
      effectiveMessages = applyPromptCaching(messages as ChatMessage[], caps);
    }

    if (Object.keys(wire).length === 0) {
      return { effectiveMessages };
    }
    return { effectiveMessages, wireParams: wire };
  }

  /**
   * Bloque le couple modèle+clé auprès du QuotaManager pour la durée annoncée
   * par le fournisseur, ou {@link DEFAULT_QUOTA_WAIT_SECONDS} à défaut.
   */
  private async _blockExhaustedKey(
    model: string,
    keyIndex: number,
    errorMessage: string,
    quotaManager: ChatQuotaManager,
  ): Promise<void> {
    // Tentative d'extraction du temps d'attente précis
    const matchWait =
      /retry in\s+([\d.]+)\s*s/i.exec(errorMessage) || /after\s+([\d.]+)\s*s/i.exec(errorMessage);
    const parsedWait = matchWait?.[1] ? Number.parseFloat(matchWait[1]) : Number.NaN;
    const waitTime = Number.isFinite(parsedWait)
      ? Math.ceil(parsedWait)
      : DEFAULT_QUOTA_WAIT_SECONDS;

    // On bloque spécifiquement CE modèle, pas toute la famille, et pour cette CLÉ
    await quotaManager.recordQuotaExceeded(model, waitTime, keyIndex);
    console.log(
      `[Router] 🛡️ Modèle ${model} (Clé ${keyIndex}) bloqué pour ${waitTime}s (Feedback Temps Réel)`,
    );
  }

  /**
   * Brise le verrou de « famille forcée » quand celle-ci a échoué sur toutes
   * ses clés : relance `chat()` sans contrainte de famille.
   *
   * @returns La réponse du repli, ou `null` si ce chemin ne s'applique pas
   *   (plusieurs familles candidates, aucune famille forcée, ou repli déjà en
   *   cours — `isFallback` bornant la récursion à un seul niveau).
   */
  private async _retryWithoutForcedFamily(
    messages: unknown[],
    options: ChatOptions,
    availableFamilies: string[],
    family: string,
  ): Promise<ChatResponse | null> {
    if (availableFamilies.length !== 1 || !options.family || options.isFallback) return null;

    console.warn(
      `[Router] 🔓 Échec de la famille forcée (${family}). Activation du FALLBACK d'urgence.`,
    );
    console.log('[Router] 🔄 Redirection vers les autres providers...');
    return this.chat(messages, { ...options, family: undefined, isFallback: true });
  }

  /**
   * Génère un embedding
   */
  async embed(
    text: string | string[],
    _options: Record<string, unknown> = {},
  ): Promise<AdapterEmbedResult> {
    // 1. Déterminer le provider (Config > OpenAI fallback)
    const primaryConfig = modelsConfig.reglages_generaux?.embeddings?.primary;
    const providerName = primaryConfig?.provider || 'openai';
    const modelId = primaryConfig?.model || 'text-embedding-3-small';

    const adapter = this.adapters.get(providerName);
    const apiKey = this.getApiKey(providerName);

    if (!adapter || !apiKey) {
      throw new Error(`Provider embedding '${providerName}' non disponible ou sans clé.`);
    }

    // 2. Vérifier les quotas (si QuotaManager disponible)
    // NOTE: ProviderRouter est un singleton, on résout le conteneur à l'appel.
    const quotaManager = await this._resolveQuotaManager<EmbedQuotaManager>();

    if (quotaManager) {
      const isAvailable = await quotaManager.isModelAvailable(modelId);
      if (!isAvailable) {
        // Repli sur la cible secondaire configurée si elle diffère de la primaire ;
        // sinon échec nommé, aucune cible de repli n'étant exploitable.
        const fallbackConfig = modelsConfig.reglages_generaux?.embeddings?.fallback;
        if (fallbackConfig && fallbackConfig.provider !== providerName) {
          console.warn(
            `[Router] ⚠️ Embedding ${providerName}/${modelId} quota épuisé. Tentative fallback ${fallbackConfig.provider}...`,
          );
          return this.embedFallback(text, fallbackConfig);
        }
        throw new Error(`Quota épuisé pour le modèle d'embedding ${modelId}`);
      }
    }

    // 3. Exécuter
    if (!adapter.embed) {
      throw new Error(`L'adaptateur pour ${providerName} ne supporte pas la méthode embed`);
    }
    try {
      const result = await adapter.embed(text, {
        apiKey,
        model: modelId,
      });

      // 4. Enregistrer usage
      if (quotaManager) {
        // `usage` n'est présent que sur la forme enveloppée (cf. AdapterEmbedResult) ;
        // sinon estimation à 1 jeton ≈ CHARS_PER_TOKEN caractères.
        const reportedTokens = Array.isArray(result) ? undefined : result.usage?.total_tokens;
        const tokens = reportedTokens || Math.ceil(text.length / CHARS_PER_TOKEN);
        quotaManager.recordUsage(providerName, modelId, tokens).catch((error: unknown) => {
          // Le comptage est un effet annexe : son échec ne doit pas invalider
          // l'embedding déjà obtenu, mais reste tracé.
          console.warn('[Router] Comptage usage embedding échoué:', describeError(error));
        });
      }

      return result;
    } catch (error) {
      console.error('[Router] Erreur embedding %s:', providerName, error);
      throw error;
    }
  }

  /**
   * Repli d'embedding sur une cible secondaire.
   *
   * Ne relit pas les quotas : ce chemin n'est atteint que depuis
   * {@link ProviderRouter.embed} après épuisement de la cible primaire, et il
   * n'appelle pas `embed()` en retour — la récursion est donc bornée à un seul
   * niveau par construction.
   */
  async embedFallback(
    text: string | string[],
    config: { provider: string; model: string },
  ): Promise<AdapterEmbedResult> {
    const providerName = config.provider;
    const modelId = config.model;
    const adapter = this.adapters.get(providerName);
    const apiKey = this.getApiKey(providerName);

    if (!adapter || !apiKey) throw new Error(`Fallback embedding ${providerName} indisponible`);

    if (!adapter.embed) throw new Error(`Provider embedding ${providerName} ne supporte pas embed`);
    const result = await adapter.embed(text, { apiKey, model: modelId });
    return result;
  }

  /**
   * Liste les familles disponibles
   */
  listFamilies() {
    return [...familyConfigs.entries()].map(([key, config]) => ({
      id: key,
      name: config.nom_affiche,
      models: config.modeles?.map((m) => m.id) || [],
      hasApiKey: !!this.getApiKey(key),
    }));
  }

  /**
   * Vérifie si une famille est disponible
   */
  isAvailable(familyName: string) {
    const apiKey = this.getApiKey(familyName);
    return !!apiKey && !apiKey.startsWith('VOTRE_');
  }
}

export const providerRouter = new ProviderRouter();

/**
 * Auto-import des adaptateurs disponibles, via deux canaux complémentaires :
 *
 * 1. **Fichiers natifs conservés** de `adapters/` (cf. `adapterMapping`) :
 *    import dynamique silencieusement ignoré quand le fichier est absent
 *    (`MODULE_NOT_FOUND`).
 * 2. **Déclaration JSON générique** : chaque famille de `models_config.json`
 *    (`familles`) non couverte par un fichier natif est enregistrée avec un
 *    `GenericProviderAdapter` piloté par ses clés `protocol_family` /
 *    `header_family`. La résolution du moteur de protocole est paresseuse
 *    (à l'invocation de `chat()`) : une famille sans `protocol_family` ne
 *    peut JAMAIS faire échouer le chargement.
 *
 * WHY: Exported and idempotent so ServiceContainer can `await loadAdapters()`.
 * The module-level fire-and-forget call below provides backward compatibility
 * for code paths that import providerRouter without going through the container.
 */
let loadPromise: Promise<void> | null = null;
export async function loadAdapters(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // Mapping: nom du fichier adaptateur → nom(s) à enregistrer.
    // Restreint aux familles natives CONSERVÉES en fichiers dédiés ; toute
    // autre famille du JSON est servie par le canal générique ci-dessous.
    const adapterMapping = {
      openai: ['openai'],
      gemini: ['gemini'],
      anthropic: ['anthropic'],
      groq: ['groq'],
      huggingface: ['huggingface'],
      cohere: ['cohere'],
      cloudflare: ['cloudflare'],
      modal: ['modal'],
    };

    for (const [fileName, registerNames] of Object.entries(adapterMapping)) {
      try {
        const adapterPath = join(__dirname, 'adapters', `${fileName}.js`);
        const adapterUrl = pathToFileURL(adapterPath).href;
        const adapter = await import(adapterUrl);

        // Enregistrer l'adaptateur sous tous les noms associés
        for (const name of registerNames) {
          providerRouter.registerAdapter(name, adapter.default);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          errorMessage.indexOf('ERR_MODULE_NOT_FOUND') === -1 &&
          errorMessage.indexOf('MODULE_NOT_FOUND') === -1
        ) {
          console.error('[Router Debug] Erreur de chargement pour %s:', fileName, error);
        }
      }
    }

    // Canal générique : chaque famille déclarée dans le JSON sans fichier
    // natif reçoit un GenericProviderAdapter. Résolution paresseuse côté
    // adaptateur — jamais de throw ici, même sans `protocol_family` déclaré.
    for (const familyName of familyConfigs.keys()) {
      if (providerRouter.adapters.has(familyName)) continue;
      providerRouter.registerAdapter(
        familyName,
        new GenericProviderAdapter(familyName, providerRouter.getFamilyConfig(familyName)),
      );
    }
  })();

  return loadPromise;
}

// Backward compatibility: auto-load when module is imported outside ServiceContainer
loadAdapters().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[Providers] loadAdapters failed during module init:', msg);
});

export * from './layer0/index.js';
export * from './layer1/index.js';

export default providerRouter;
