/**
 * Contrat de types partagé par tous les adapters de providers.
 *
 * Module autonome : il n'importe rien de `./index.ts`. C'est `index.ts` qui
 * consomme ces types, jamais l'inverse — un import inverse créerait un cycle
 * détecté par la règle `no-circular` de dependency-cruiser.
 *
 * Les formes déclarées ici reproduisent exactement ce que les adapters
 * envoient et lisent aujourd'hui. Aucun champ n'est ajouté ni retiré : le
 * comportement réseau reste constant.
 */

/** Fonction appelée dans un `tool_call` au format OpenAI. */
export interface ToolCallFunction {
  name: string;
  /** Arguments sérialisés en JSON, jamais un objet (contrainte du protocole). */
  arguments: string;
}

/**
 * Appel d'outil, forme commune aux messages entrants et aux réponses.
 * `thought_signature` est spécifique aux familles Gemini.
 */
export interface ToolCall {
  id: string;
  type: string;
  function: ToolCallFunction;
  thought_signature?: string;
}

/** Fragment de contenu multimodal (texte, image, audio selon `type`). */
export interface ChatContentPart {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

/**
 * Déclaration d'un outil au format OpenAI, telle que transmise par le routeur
 * dans `options.tools`. Les adapters qui reconstruisent la liste (Cohere)
 * lisent `function.name`, `function.description` et `function.parameters`.
 */
export interface ToolDefinition {
  type?: string;
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * Message de conversation tel qu'il transite du routeur vers un adapter.
 * Tous les champs optionnels sont réellement lus par au moins un adapter.
 */
export interface ChatMessage {
  role: string;
  content?: string | ChatContentPart[] | null;
  name?: string;
  tool_calls?: ToolCall[] | null;
  tool_call_id?: string;
  reasoning_content?: string | null;
  thought?: string | null;
  executed_tools?: unknown[] | null;
  [key: string]: unknown;
}

/** Comptage de jetons renvoyé par les APIs compatibles OpenAI. */
export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  [key: string]: unknown;
}

/** Entrée de `models_config.json` pour une famille, transmise par le routeur. */
export interface FamilyConfig {
  base_url?: string;
  [key: string]: unknown;
}

/**
 * Options reçues par un adapter. Le routeur y étale ses propres `ChatOptions`
 * puis ajoute `model`, `apiKey`, `keyIndex` et `familyConfig`
 * (cf. `index.ts` au point d'appel de `adapter.chat`).
 */
export interface AdapterChatOptions {
  model?: string;
  apiKey?: string;
  keyIndex?: number;
  familyConfig?: FamilyConfig;
  tools?: ToolDefinition[];
  tool_choice?: string;
  temperature?: number;
  max_tokens?: number;
  version?: string;
  [key: string]: unknown;
}

/**
 * Valeur de retour d'un `chat()` d'adapter. L'index signature couvre les
 * champs propres à un fournisseur (`executedTools`, `usageBreakdown`…) que le
 * routeur relaie sans les interpréter.
 */
export interface AdapterChatResult {
  content: string | null;
  thought?: string | null;
  toolCalls?: ToolCall[] | null;
  finishReason?: string;
  usage?: TokenUsage;
  [key: string]: unknown;
}

/** Vecteur accompagné de son comptage de jetons (forme renvoyée par `kimi`). */
export interface EmbeddingWithUsage {
  embedding: number[];
  usage?: TokenUsage;
}

/**
 * Retour d'un `embed()`. L'union reflète une divergence réelle et non résolue
 * entre adapters : `openai` renvoie le vecteur nu, `kimi` l'enveloppe avec son
 * `usage`. `index.ts` sonde `.usage?.total_tokens`, ce qui n'aboutit que pour
 * la seconde forme. Le contrat décrit l'existant ; l'unification relève du
 * plan de regroupement des familles de protocole.
 */
export type AdapterEmbedResult = number[] | EmbeddingWithUsage;

/**
 * Contrat exposé par le `export default` de chaque adapter.
 *
 * `chat` et `embed` sont déclarés en **style méthode** et non en propriété
 * fonction : TypeScript vérifie alors leurs paramètres de façon bivariante.
 * Un adapter peut ainsi resserrer un paramètre (`embed(text: string)` chez
 * `openai`, qui appelle `text.substring`) sans être rejeté par
 * `strictFunctionTypes`.
 */
export interface ProviderAdapter {
  name: string;
  chat(messages: ChatMessage[], options: AdapterChatOptions): Promise<AdapterChatResult>;
  embed?(text: string | string[], options: AdapterChatOptions): Promise<AdapterEmbedResult>;
}

/**
 * Corps de requête `POST {base}/chat/completions` commun aux fournisseurs
 * compatibles OpenAI. Les champs déclarés sont ceux réellement émis par les
 * adapters du dossier ; un fournisseur ayant un champ propre (`reasoning` chez
 * `openrouter`, `chat_template_kwargs` chez `nvidia`) étend cette interface
 * localement plutôt que de recourir à une signature d'index.
 */
export interface OpenAIChatRequestBody {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  tools?: ToolDefinition[];
  tool_choice?: string;
}

/** Message d'un `choice` renvoyé par une API compatible OpenAI. */
export interface OpenAIResponseMessage {
  content: string | null;
  tool_calls?: ToolCall[] | null;
  reasoning_content?: string | null;
  /** Outils exécutés côté serveur (Groq Compound). */
  executed_tools?: unknown[] | null;
}

/** Une complétion candidate. Les adapters ne lisent que `choices[0]`. */
export interface OpenAIResponseChoice {
  message: OpenAIResponseMessage;
  finish_reason?: string;
}

/** Réponse `chat/completions` d'une API compatible OpenAI. */
export interface OpenAIChatResponse {
  choices: OpenAIResponseChoice[];
  usage?: TokenUsage;
  /** Détail par modèle sous-jacent (Groq Compound). */
  usage_breakdown?: unknown;
}

/**
 * Corps d'erreur renvoyé par la quasi-totalité des fournisseurs HTTP du
 * dossier. Tous les champs sont optionnels : la réponse d'erreur n'est pas
 * garantie par les APIs, d'où le repli sur un message littéral au point d'appel.
 */
export interface ApiErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
  };
  message?: string;
}

/** Réponse `POST /v1/embeddings` d'une API compatible OpenAI. */
export interface OpenAIEmbeddingResponse {
  data: { embedding: number[] }[];
  usage?: TokenUsage;
}
