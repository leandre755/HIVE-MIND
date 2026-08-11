/**
 * Contrat de types du protocole REST Gemini (`v1beta/models/*:generateContent`),
 * partagé par les adapters de la famille : `gemini`, `geminiCli`, `antigravity`.
 *
 * Module autonome : aucun import depuis `./index.ts` ni depuis un adapter.
 * Complète `./types.ts`, qui décrit le protocole compatible OpenAI ; les deux
 * familles ne partagent que les types de bordure (`ChatMessage`, `ToolCall`)
 * qui transitent par le routeur.
 *
 * Les formes déclarées reproduisent exactement ce que les adapters émettent et
 * lisent aujourd'hui. Aucun champ n'est ajouté ni retiré : le comportement
 * réseau reste constant.
 *
 * Les types du paquet `@google/genai` ne sont pas réutilisés ici : ces adapters
 * appellent l'API REST par `fetch` sans passer par le SDK, et émettent des
 * champs en `snake_case` (`inline_data`, `thought_signature`) que le SDK ne
 * déclare qu'en `camelCase`. Le SDK reste la source de vérité pour
 * `geminiLive.ts`, qui l'utilise réellement.
 */

/** Charge utile binaire inline, en `snake_case` comme l'attend l'API REST. */
export interface GeminiInlineData {
  mime_type: string;
  data: string;
}

/** Appel de fonction émis par le modèle ou réinjecté dans l'historique. */
export interface GeminiFunctionCall {
  name: string;
  args?: Record<string, unknown>;
  /** Réinjecté tel quel pour les modèles « Thinking ». */
  thoughtSignature?: string;
  thought_signature?: string;
}

/** Résultat d'outil renvoyé au modèle. */
export interface GeminiFunctionResponse {
  name?: string;
  response: Record<string, unknown>;
}

/**
 * Fragment de contenu.
 *
 * `thought` est déclaré `string | boolean` : l'API le renvoie en booléen pour
 * marquer un fragment de raisonnement, alors que les adapters réinjectent le
 * texte de la pensée dans ce même champ à la construction de l'historique.
 */
export interface GeminiPart {
  text?: string;
  thought?: string | boolean;
  thoughtSignature?: string;
  thought_signature?: string;
  inline_data?: GeminiInlineData;
  functionCall?: GeminiFunctionCall;
  functionResponse?: GeminiFunctionResponse;
}

/** Tour de conversation au format Gemini (`user`, `model` ou `function`). */
export interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

/** Déclaration d'outil, dérivée de `ToolDefinition.function` du côté OpenAI. */
export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  /**
   * Schéma des paramètres. L'union couvre les deux chemins réels : `gemini`
   * relaie le JSON Schema du routeur tel quel, tandis que `antigravity` et
   * `geminiCli` le normalisent d'abord vers {@link GeminiSchema}.
   */
  parameters?: GeminiSchema | Record<string, unknown>;
}

/** Bloc `tools` du corps de requête. */
export interface GeminiToolBlock {
  functionDeclarations: GeminiFunctionDeclaration[];
}

/**
 * Schéma de paramètres d'outil, dialecte Gemini.
 *
 * L'API n'accepte que six types, en majuscules, et rejette les mots-clés JSON
 * Schema qu'elle ne connaît pas — d'où la normalisation appliquée par les
 * adapters `antigravity` et `geminiCli` avant émission.
 */
export interface GeminiSchema {
  type?: string;
  description?: string;
  properties?: Record<string, GeminiSchema>;
  items?: GeminiSchema;
  required?: string[];
  enum?: string[];
}

/** Réglages de génération. */
export interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  thinkingConfig?: { includeThoughts?: boolean; thinkingBudget?: number };
}

/** Corps de `POST …:generateContent`. */
export interface GeminiRequestBody {
  contents: GeminiContent[];
  generationConfig?: GeminiGenerationConfig;
  systemInstruction?: { parts: { text: string }[] };
  tools?: GeminiToolBlock[];
}

/** Comptage de jetons renvoyé par l'API. */
export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
  [key: string]: unknown;
}

/** Réponse candidate. Les adapters ne lisent que `candidates[0]`. */
export interface GeminiCandidate {
  content?: { parts?: GeminiPart[]; role?: string };
  finishReason?: string;
}

/** Réponse `generateContent`. */
export interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

/** Corps d'erreur de l'API Generative Language. */
export interface GeminiErrorResponse {
  error?: {
    message?: string;
    status?: string;
    code?: number;
  };
}

/**
 * Enveloppe du protocole interne Code Assist
 * (`POST {endpoint}/v1internal:generateContent`), partagée par les adapters
 * `antigravity` et `geminiCli`.
 *
 * Ce protocole imbrique le corps `generateContent` standard sous `request` et
 * ajoute le projet Google Cloud, l'identifiant de requête et l'agent déclaré.
 */
export interface CodeAssistRequestWrapper {
  project: string;
  model: string;
  request: GeminiRequestBody;
  requestType: string;
  userAgent: string;
  requestId: string;
}

/**
 * Réponse du protocole interne Code Assist.
 *
 * Le corps `generateContent` arrive imbriqué sous `response`, mais les deux
 * adapters acceptent aussi la forme à plat (`data.response || data`) : les
 * champs racine sont donc déclarés en option.
 */
export interface CodeAssistResponse extends GeminiGenerateContentResponse {
  response?: GeminiGenerateContentResponse;
}

/** Charge utile du JWT d'accès Google, réduite au champ réellement lu. */
export interface GoogleJwtPayload {
  exp?: number;
}

/** Réponse de `POST https://oauth2.googleapis.com/token`. */
export interface GoogleOAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
}

/**
 * Réponse de `POST {endpoint}/v1internal:loadCodeAssist`.
 *
 * `cloudaicompanionProject` est déclaré en union : les deux adapters lisent
 * d'abord la valeur brute puis `?.id`, l'API renvoyant selon les cas un
 * identifiant nu ou un objet.
 */
export interface LoadCodeAssistResponse {
  cloudaicompanionProject?: string | { id?: string };
}
