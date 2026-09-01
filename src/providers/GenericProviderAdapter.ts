/**
 * Adapter générique du routeur-familles : composition `ProtocolFamily` ×
 * `HeaderFamily` pilotée par une déclaration JSON de `models_config.json`.
 *
 * Une famille JSON (`familles.<nom>`) n'a plus besoin d'un fichier dédié dans
 * `adapters/` : elle déclare `protocol_family` (dialecte HTTP) et
 * `header_family` (schéma d'authentification) et cette classe exécute le cycle
 * complet `buildUrl` → `buildBody` → `buildHeaders` → `fetch` →
 * `parseResponse` / `parseError` à l'invocation.
 *
 * Résolution paresseuse (INVARIANT) : le constructeur ne résout aucun moteur
 * via le registre — `getProtocolFamily` / `getHeaderFamily` ne sont appelés
 * que dans `chat()`. Le démarrage du routeur et l'instanciation des familles
 * ne peuvent donc jamais être bloqués par une configuration incomplète : la
 * vérification a lieu à l'invocation, et échoue alors de façon fermée et
 * nommée.
 *
 * Précédences documentées :
 * - `familyConfig` : celle du constructeur (déclaration de la famille) prime
 *   sur `options.familyConfig` (repli quand l'instance est construite sans).
 * - En-têtes : `header.buildHeaders(...)` d'abord, puis `headers_extra` de la
 *   configuration, puis `protocol.extraHeaders` en dernier — le protocole peut
 *   donc réécrire un en-tête déclaré côté configuration (ex. empreinte fixe
 *   d'un dialecte).
 *
 * Le contrat `ProviderAdapter` est respecté sans `embed` : le routeur détecte
 * l'absence de la méthode et répond « ne supporte pas la méthode embed ».
 *
 * Le routeur enregistre l'`export default` des adapters ; l'export par défaut
 * est ici la classe elle-même, instanciée par le routeur familles
 * (`new GenericProviderAdapter(nom, config)`), contrairement aux adapters
 * historiques qui exportent un singleton.
 */

import { getHeaderFamily, getProtocolFamily } from './families/registry.js';
import type { ProtocolContext, ProtocolOptions } from './families/types.js';
import { requireModel } from './requireModel.js';
import type {
  AdapterChatOptions,
  AdapterChatResult,
  ChatMessage,
  FamilyConfig,
  ProviderAdapter,
} from './types.js';

/** Moteur d'en-têtes appliqué quand `header_family` n'est pas déclaré. */
const DEFAULT_HEADER_FAMILY = 'standard-bearer';

/** Budget de temps HTTP de dernier recours (millisecondes). */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Préfixe commun des messages d'erreur : situe la famille JSON en cause.
 *
 * @param familyName Nom de la famille JSON pilotant cette instance.
 * @returns Libellé stable du type `GenericProviderAdapter(<nom>)`.
 */
function adapterLabel(familyName: string): string {
  return `GenericProviderAdapter(${familyName})`;
}

/**
 * Valide une clé de configuration attendue comme chaîne non vide.
 *
 * INVARIANT : la valeur retournée est une chaîne non vide ; tout autre cas
 * lève une erreur (fail-closed, la forme invalide ne produit jamais de
 * requête).
 *
 * @param value Valeur brute lue dans la déclaration de la famille.
 * @param key Nom de la clé, tel qu'écrit dans la configuration.
 * @param label Préfixe d'erreur situant l'instance.
 * @returns La chaîne validée.
 * @throws {Error} Si `value` n'est pas une chaîne non vide.
 */
function assertNonEmptyString(value: unknown, key: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `[${label}] Clé "${key}" invalide dans la déclaration de la famille : ` +
        `une chaîne non vide est attendue (reçu : ${typeof value}).`,
    );
  }
  return value;
}

/**
 * Valide la forme d'une valeur optionnelle attendue comme objet simple.
 *
 * @param value Valeur brute (`undefined` admis : la clé est alors absente).
 * @param key Nom de la clé, tel qu'écrit dans la configuration.
 * @param label Préfixe d'erreur situant l'instance.
 * @returns L'objet validé, ou `undefined` si la clé est absente.
 * @throws {Error} Si la valeur présente n'est pas un objet non nul et non tableau.
 */
function assertOptionalRecord(
  value: unknown,
  key: string,
  label: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `[${label}] Clé "${key}" invalide dans la déclaration de la famille : ` +
        'un objet Record est attendu.',
    );
  }
  return value as Record<string, unknown>;
}

/**
 * Lit et valide `protocol_options` de la déclaration de la famille.
 *
 * Validation stricte de la forme : objet simple si présent, et `timeout_ms`
 * — seule clé consommée par cet adapter — numérique si déclaré. Les autres
 * clés sont relayées au moteur de protocole, seul habilité à les interpréter
 * (cf. contrat `ProtocolOptions`).
 *
 * @param value Valeur brute de `familyConfig.protocol_options`.
 * @param label Préfixe d'erreur situant l'instance.
 * @returns Les réglages validés, ou `undefined` si la clé est absente.
 * @throws {Error} Si la forme est invalide ou si `timeout_ms` n'est pas numérique.
 */
function readProtocolOptions(value: unknown, label: string): ProtocolOptions | undefined {
  const record = assertOptionalRecord(value, 'protocol_options', label);
  if (record === undefined) return undefined;
  const timeout = record['timeout_ms'];
  if (timeout !== undefined && typeof timeout !== 'number') {
    throw new Error(
      `[${label}] Clé "protocol_options.timeout_ms" invalide : ` +
        `un nombre de millisecondes est attendu (reçu : ${typeof timeout}).`,
    );
  }
  const rawHeaders = record['extra_headers'];
  if (rawHeaders !== undefined) {
    const headersRecord = assertOptionalRecord(rawHeaders, 'protocol_options.extra_headers', label);
    for (const [key, headerValue] of Object.entries(headersRecord ?? {})) {
      if (typeof headerValue !== 'string' || headerValue.length === 0) {
        throw new Error(
          `[${label}] Clé "protocol_options.extra_headers.${key}" invalide : ` +
            'une valeur de type chaîne non vide est attendue.',
        );
      }
    }
  }
  return record as ProtocolOptions;
}

/**
 * Lit et valide `headers_extra` de la déclaration de la famille.
 *
 * Validation stricte de la forme : si présente, la valeur doit être un
 * `Record<string, string>` à valeurs non vides — des valeurs non chaînes
 * casseraient silencieusement la construction des en-têtes HTTP.
 *
 * @param value Valeur brute de `familyConfig.headers_extra`.
 * @param label Préfixe d'erreur situant l'instance.
 * @returns La table d'en-têtes validée (vide si la clé est absente).
 * @throws {Error} Si la forme est invalide ou si une valeur n'est pas une chaîne.
 */
function readHeadersExtra(value: unknown, label: string): Record<string, string> {
  const record = assertOptionalRecord(value, 'headers_extra', label);
  if (record === undefined) return {};
  const entries = Object.entries(record);
  for (const [key, headerValue] of entries) {
    if (typeof headerValue !== 'string' || headerValue.length === 0) {
      throw new Error(
        `[${label}] Clé "headers_extra.${key}" invalide : ` +
          'une valeur de type chaîne non vide est attendue.',
      );
    }
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * Lit `options.wireParams` transmis par le routeur, avec typage défensif.
 *
 * @param value Valeur brute de `options.wireParams` (signature d'index).
 * @param label Préfixe d'erreur situant l'instance.
 * @returns L'objet validé, ou `undefined` si l'option est absente.
 * @throws {Error} Si la valeur présente n'est pas un objet simple.
 */
function readWireParams(value: unknown, label: string): Record<string, unknown> | undefined {
  return assertOptionalRecord(value, 'wireParams', label);
}

/**
 * Adapter générique piloté par une déclaration JSON de famille.
 *
 * `name` vaut le nom de la famille JSON (clé sous `familles` de
 * `models_config.json`) ; `chat` est déclaré en style méthode, conformément à
 * la convention de bivariance du contrat `ProviderAdapter`.
 */
export class GenericProviderAdapter implements ProviderAdapter {
  /** Nom de la famille JSON pilotant cette instance (contrat routeur). */
  public readonly name: string;

  /**
   * Déclaration de la famille, copiée défensivement au constructeur : une
   * mutation ultérieure de l'objet source ne fait pas dériver cette instance.
   */
  private readonly familyConfig?: FamilyConfig;

  /**
   * Construit l'adapter. Aucune résolution de moteur ni validation de la
   * configuration n'a lieu ici : tout est vérifié à l'invocation de `chat()`
   * (résolution paresseuse, démarrage du routeur jamais bloqué).
   *
   * @param familyName Nom de la famille JSON (devient `name`, exposé au routeur).
   * @param familyConfig Entrée `familles.<familyName>` de `models_config.json`.
   */
  constructor(familyName: string, familyConfig?: FamilyConfig) {
    this.name = familyName;
    if (familyConfig !== undefined) {
      this.familyConfig = { ...familyConfig };
    }
  }

  /**
   * Exécute un appel de chat en composant le `ProtocolFamily` et le
   * `HeaderFamily` déclarés par la famille JSON.
   *
   * Étapes (linéaires) :
   * 1. Garde du modèle (`requireModel`) et lecture des clés de déclaration
   *    (`protocol_family`, `header_family` avec repli `standard-bearer`,
   *    `protocol_options`, `headers_extra`) avec validation stricte de forme.
   * 2. Résolution paresseuse des deux moteurs via le registre.
   * 3. Construction du `ProtocolContext`, de l'URL et du corps.
   * 4. Fusion des en-têtes : moteur d'en-têtes, puis `headers_extra`, puis
   *    `protocol.extraHeaders` (dernier gagnant, cf. en-tête de module).
   * 5. `fetch` POST sous `AbortController` borné par
   *    `protocolOptions.timeout_ms ?? protocol.timeoutMs ?? 60000` ; le minuteur
   *    est libéré en `finally` et une interruption est rejetée en erreur de
   *    délai explicite.
   * 6. Échec HTTP → `protocol.parseError(corps, statut)` (lève toujours).
   * 7. Succès → `protocol.parseResponse(corps, ctx)` retourné tel quel : cet
   *    adapter n'ajoute rien au résultat (le routeur pose `usedFamily` /
   *    `usedModel`).
   *
   * @param messages Historique de conversation au format routeur.
   * @param options Options de l'appel posées par le routeur (`model`, `apiKey`,
   *   `familyConfig`, `wireParams` éventuel, passthrough…).
   * @returns Le résultat produit par le moteur de protocole, sans ajout.
   * @throws {Error} Sur modèle absent, clé API manquante, déclaration de
   *   famille incomplète ou mal formée, délai dépassé, ou erreur distante.
   */
  async chat(messages: ChatMessage[], options: AdapterChatOptions): Promise<AdapterChatResult> {
    const label = adapterLabel(this.name);

    // 1. Modèle : toujours fourni par le routeur (fail-closed sinon).
    const model = requireModel(options.model, label);

    // La déclaration du constructeur prime ; repli sur celle du routeur.
    const familyConfig = this.familyConfig ?? options.familyConfig;

    // 1bis. Lecture + validation stricte de la forme des clés de déclaration.
    const rawProtocolName = familyConfig?.['protocol_family'];
    if (rawProtocolName === undefined) {
      throw new Error(
        `[${label}] protocol_family manquant pour la famille "${this.name}" : ` +
          'la déclaration JSON doit nommer le dialecte HTTP à exécuter.',
      );
    }
    const protocolFamilyName = assertNonEmptyString(rawProtocolName, 'protocol_family', label);

    const rawHeaderName = familyConfig?.['header_family'];
    const headerFamilyName =
      rawHeaderName === undefined
        ? DEFAULT_HEADER_FAMILY
        : assertNonEmptyString(rawHeaderName, 'header_family', label);

    const protocolOptions = readProtocolOptions(familyConfig?.['protocol_options'], label);
    const headersExtra = readHeadersExtra(familyConfig?.['headers_extra'], label);

    // 2. Résolution paresseuse des moteurs (erreur explicite du registre sinon).
    const protocol = getProtocolFamily(protocolFamilyName);
    const header = getHeaderFamily(headerFamilyName);

    // 3. Clé API : le routeur passe une chaîne vide quand aucune clé n'est
    //    disponible — la requête ne doit jamais partir non signée.
    const apiKey = options.apiKey;
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new Error(
        `[${label}] API key manquante : le routeur n'a fourni aucune clé ` +
          `pour la famille "${this.name}".`,
      );
    }

    const ctx: ProtocolContext = {
      model,
      apiKey,
      messages,
      options,
      familyConfig,
      wireParams: readWireParams(options['wireParams'], label),
      protocolOptions,
    };

    const url = protocol.buildUrl(ctx);
    const body = protocol.buildBody(ctx);

    // 4. En-têtes : base du moteur (qui fusionne déjà headers_extra via
    //    ctx.familyConfig — fusion idempotente ici), puis headers_extra, puis
    //    extra_headers de protocol_options (parité filaire des adapters
    //    historiques : Accept codestral/nvidia, triplet openrouter), puis
    //    empreinte du protocole en dernier (peut réécrire, comportement voulu).
    const headers: Record<string, string> = {
      ...header.buildHeaders(apiKey, {
        model,
        protocol: protocol.name,
        familyConfig,
        options,
      }),
      ...headersExtra,
      ...protocolOptions?.extra_headers,
      ...protocol.extraHeaders,
    };

    // 5. Envoi borné dans le temps ; minuteur libéré en finally.
    const timeoutMs = protocolOptions?.timeout_ms ?? protocol.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `[${label}] Délai dépassé : la requête a été interrompue après ` +
            `${timeoutMs} ms sans réponse du fournisseur.`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    // 6. Échec HTTP : le moteur de protocole traduit et lève toujours.
    if (!response.ok) {
      const errorBody: unknown = await response.json().catch(() => null);
      throw protocol.parseError(errorBody, response.status);
    }

    // 7. Succès : résultat du moteur, sans ajout de cet adapter.
    const data: unknown = await response.json();
    return protocol.parseResponse(data, ctx);
  }
}

export default GenericProviderAdapter;
