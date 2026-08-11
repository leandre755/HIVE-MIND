/**
 * ProgrammaticExecutor — Cœur du Programmatic Tool Calling (PTC)
 *
 * WHY: Remplace la boucle ReAct multi-round-trip par une exécution unique.
 * Le LLM génère un script JS → on l'exécute dans un VM sandbox → seul le résultat final
 * revient au LLM. Économise ~80% de tokens sur les requêtes multi-tools.
 *
 * ARCHITECTURE:
 *   1. Le LLM reçoit un meta-tool `code_execution` en plus des tools normaux
 *   2. S'il décide de l'utiliser, il génère du code JS orchestrant N tools
 *   3. Ce code est exécuté ici dans un Node.js `vm` sandbox
 *   4. Les tools sont injectés comme fonctions globales dans le sandbox
 *   5. Seul le résultat final est renvoyé au LLM (pas les résultats intermédiaires)
 */

import vm from 'node:vm';
import type {
  ToolCallRecord,
  PTCExecutionResult,
  PTCConfig,
  ToolFunction,
  OpenAIToolDefinition,
} from './types.js';
import { SANDBOX_HELPERS_SOURCE } from './SandboxHelpers.js';
import { validateCode, autoRepairCode } from './SafeScriptValidator.js';
import type { HiveWakeBridge, SleepResult } from './WakeSystem.js';

const DEFAULT_CONFIG: PTCConfig = {
  timeoutMs: 30_000,
  baseContextTokens: 7_000,
};

export class ProgrammaticExecutor {
  private readonly config: PTCConfig;

  constructor(config: Partial<PTCConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────

  /**
   * Crée la définition du meta-tool `code_execution` au format OpenAI.
   * La description inclut la liste des tools disponibles pour guider le LLM.
   */
  buildCodeExecutionToolDef(availableTools: readonly OpenAIToolDefinition[]): OpenAIToolDefinition {
    const toolDocs = availableTools
      .map((t) => {
        const fn = t.function;
        const params = fn.parameters?.properties
          ? Object.entries(fn.parameters.properties)
              .map(([key, val]) => {
                const prop = val as { type?: string; description?: string };
                const type = prop.type || 'any';
                const descStr = prop.description ? ` — ${prop.description}` : '';
                return `    - ${key}: ${type}${descStr}`;
              })
              .join('\n')
          : '    (pas de paramètres)';
        return `• ${fn.name}: ${fn.description}\n${params}`;
      })
      .join('\n\n');

    return {
      type: 'function',
      function: {
        name: 'code_execution',
        description: `Exécute du code JavaScript pour orchestrer PLUSIEURS appels d'outils en une seule fois.
UTILISE CET OUTIL quand tu dois faire 3 appels d'outils ou plus. C'est BEAUCOUP plus rapide et économique.

QUAND UTILISER:
- Récupérer des données de plusieurs sources en parallèle
- Traiter des listes ou faire des opérations en lot
- Chaîner des outils (résultat de l'un → entrée de l'autre)
- Agréger ou filtrer des résultats

OUTILS DISPONIBLES DANS LE CODE:
${toolDocs}

HELPERS DÉFENSIFS (toujours disponibles):
- toArray(value) — Convertit en array (null → [], objet → extrait .items/.data)
- safeGet(obj, 'path.to.prop', default) — Accès sûr
- safeMap(value, fn) — Map sûr
- isSuccess(response) — Vérifie succès
- extractText(response) — Extrait du texte

EXEMPLE (ceci est la chaîne envoyée dans le paramètre "code" de l'outil) :
const [meteo1, meteo2, meteo3] = await Promise.all([
  get_weather({ city: 'Paris' }),
  get_weather({ city: 'Lyon' }),
  get_weather({ city: 'Marseille' })
]);
return { paris: meteo1, lyon: meteo2, marseille: meteo3 };

RÈGLES:
1. Appeler chaque outil avec UN SEUL objet: nomOutil({ param1: val, param2: val })
2. TOUJOURS retourner le résultat final avec \`return\`
3. Utiliser \`await\` pour chaque appel d'outil
4. Utiliser \`Promise.all()\` pour les appels parallèles
5. SILENCE ABSOLU: Ne JAMAIS montrer, imprimer, ou expliquer ce code JavaScript à l'utilisateur dans ton message texte. Le code doit être envoyé uniquement via l'appel d'outil.
6. INTERDICTION ABSOLUE: Ne JAMAIS utiliser require(), import(), eval() ou fetch(). Utilise UNIQUEMENT les outils fournis ci-dessus.
7. CRITIQUE: Les outils retournent un objet { success, llmOutput }. Ne tente jamais d'accéder à "result.data" ou "result.markdown" directement sans utiliser extractText(result).
8. DO NOT use code_execution for NPM, Node scripts, file creation, or filesystem writes; use execute_bash_command directly for those tasks.

TÂCHES LONGUES (>30s) — API HIVE:
L'objet global \`HIVE\` est disponible pour gérer les tâches qui dépassent le timeout LLM.
- \`await HIVE.sleepAndWake(delayMs, "Prompt de réveil")\` — Libère la boucle LLM et programme un réveil automatique après \`delayMs\` ms. HIVE-MIND se réveillera et exécutera le prompt automatiquement.
- \`await HIVE.waitForBackground(commandId, checkEveryMs, "Prompt")\` — Attend la fin d'une commande background et se réveille quand c'est terminé.
QUAND UTILISER : scraping long, compilation, attente d'un webhook, surveillance d'un service.
RÈGLE CRITIQUE : Après avoir appelé \`HIVE.sleepAndWake()\`, retourne UNIQUEMENT le résultat de sleepAndWake et réponds \`__HIVE_SILENT_7f3a__\` dans ton message final.

EXEMPLE TÂCHE LONGUE:
\`\`\`javascript
// Vérifier un endpoint dans 60 secondes
const result = await HIVE.sleepAndWake(60000, "Vérifie si https://api.example.com/health répond avec status 200 et préviens l'utilisateur");
return result; // Type SLEEP_SCHEDULED
\`\`\``,
        parameters: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description:
                'Code JavaScript à exécuter. Peut utiliser async/await. Les outils sont disponibles comme fonctions globales. Retourner le résultat final avec return.',
            },
          },
          required: ['code'],
        },
      },
    };
  }

  /**
   * Exécute le code JS généré par le LLM dans un sandbox VM.
   *
   * @param code — Code JS généré par le LLM
   * @param toolFunctions — Map nom → fonction exécutable pour chaque outil
   * @param hiveBridge — Bridge HIVE injecté dans le VM (WakeSystem, etc.)
   * @returns Résultat + métriques d'économies de tokens
   */
  private _validateAndRepairCode(code: string, availableToolNames: string[]): string {
    const validation = validateCode(code, availableToolNames);
    if (validation.isValid) {
      for (const warning of validation.warnings) {
        console.warn(`[PTC] ⚠️ SafeScript warning: ${warning.type} — ${warning.message}`);
      }
      return code;
    }

    const repair = autoRepairCode(code, validation.errors);
    if (repair.success && repair.repairedCode) {
      console.log(`[PTC] 🔧 SafeScript auto-repair: ${repair.appliedFixes.join(', ')}`);
      const revalidation = validateCode(repair.repairedCode, availableToolNames);
      if (revalidation.isValid) {
        return repair.repairedCode;
      }
      const errorSummary = revalidation.errors.map((e) => `${e.type}: ${e.message}`).join('; ');
      throw new Error(`[PTC] SafeScript — Erreurs non-réparables: ${errorSummary}`);
    }

    const errorSummary = validation.errors.map((e) => `${e.type}: ${e.message}`).join('; ');
    throw new Error(`[PTC] SafeScript — Code invalide: ${errorSummary}`);
  }

  /**
   * Exécute le code JS généré par le LLM dans un sandbox VM.
   *
   * @param code — Code JS généré par le LLM
   * @param toolFunctions — Map nom → fonction exécutable pour chaque outil
   * @param hiveBridge — Bridge HIVE injecté dans le VM (WakeSystem, etc.)
   * @returns Résultat + métriques d'économies de tokens
   */
  async execute(
    code: string,
    toolFunctions: ReadonlyMap<string, ToolFunction>,
    hiveBridge?: HiveWakeBridge,
  ): Promise<PTCExecutionResult> {
    const startTime = Date.now();
    const toolCalls: ToolCallRecord[] = [];
    const availableToolNames = [...toolFunctions.keys()];

    const { countToolCalls } = await import('./SafeScriptValidator.js');
    const toolCallCount = countToolCalls(code, availableToolNames);
    if (toolCallCount < 2) {
      console.log(
        `[PTC] ⚠️ Code contient seulement ${toolCallCount} appel(s) d'outil. Exécution VM autorisée (plus rapide qu'un retry LLM).`,
      );
    }

    const validatedCode = this._validateAndRepairCode(code, availableToolNames);
    const sandboxGlobals = this.buildSandboxContext(toolFunctions, toolCalls, hiveBridge);

    // ── Layer 2 : Scope Guard (Proxy) — appliqué dans buildSandboxContext ──

    // Wrapper async : le code utilisateur est dans une async IIFE
    const wrappedCode = `
${SANDBOX_HELPERS_SOURCE}

(async () => {
    try {
        const __result = await (async () => {
            ${validatedCode}
        })();
        __resolve(__result);
    } catch (err) {
        __reject(err);
    }
})();
`;

    // Exécuter dans le VM
    const output = await this.runInVM(wrappedCode, sandboxGlobals);

    const executionTime = Date.now() - startTime;
    const tokenSavings = this.calculateTokenSavings(toolCalls);

    console.log(
      `[PTC] ✅ Exécution terminée: ${toolCalls.length} tool calls en ${executionTime}ms, ~${tokenSavings.totalSaved} tokens économisés`,
    );

    // Sérialiser le résultat
    const serializableOutput = this.safeSerialize(output, toolCalls);

    // Extraire le SleepResult si HIVE.sleepAndWake() a été appelé dans le script
    const capturedSleep: SleepResult | undefined = (sandboxGlobals as Record<string, unknown>)
      .__hiveSleepResult as SleepResult | undefined;

    return {
      result: capturedSleep
        ? { type: 'SLEEP_SCHEDULED', sleepResult: capturedSleep }
        : serializableOutput,
      metadata: {
        toolCallCount: toolCalls.length,
        intermediateTokensSaved: tokenSavings.intermediateResults,
        totalTokensSaved: tokenSavings.totalSaved,
        tokenSavingsBreakdown: tokenSavings,
        toolsUsed: [...new Set(toolCalls.map((c) => c.toolName))],
        executionTimeMs: executionTime,
        sandboxToolCalls: toolCalls,
        sleepScheduled: capturedSleep,
        ...(toolCallCount < 2
          ? {
              warning:
                "ATTENTION: Tu n'as appelé qu'un seul outil. À l'avenir, n'utilise 'code_execution' QUE pour 2+ outils. Utilise le Tool Calling natif pour un seul outil.",
            }
          : {}),
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE
  // ─────────────────────────────────────────────────────────────

  /**
   * Construit le contexte global injecté dans le VM.
   * Chaque outil HIVE-MIND devient une fonction globale `async toolName(args)`.
   * L'objet global `HIVE` est injecté avec le bridge WakeSystem.
   */
  private buildSandboxContext(
    toolFunctions: ReadonlyMap<string, ToolFunction>,
    toolCalls: ToolCallRecord[],
    hiveBridge?: HiveWakeBridge,
  ): Record<string, unknown> {
    const globals: Record<string, unknown> = {
      // Standard JS globals nécessaires dans le VM
      console: {
        log: (...args: unknown[]) => console.log('[PTC:sandbox]', ...args),
        warn: (...args: unknown[]) => console.warn('[PTC:sandbox]', ...args),
        error: (...args: unknown[]) => console.error('[PTC:sandbox]', ...args),
      },
      setTimeout,
      Promise,
      JSON,
      Array,
      Object,
      Math,
      Date,
      Error,
      Map,
      Set,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      String,
      Number,
      Boolean,
      RegExp,
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,
    };

    // Injecter chaque outil comme fonction globale
    for (const [name, fn] of toolFunctions) {
      Reflect.set(globals, name, async (args: Record<string, unknown>) => {
        const callStart = Date.now();
        const record: ToolCallRecord = { toolName: name, args };
        toolCalls.push(record);

        try {
          const result = await fn(args);
          record.result = result;
          record.executionTimeMs = Date.now() - callStart;
          return result;
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          record.error = errorMsg;
          record.executionTimeMs = Date.now() - callStart;
          return { success: false, error: errorMsg, gracefulDegradation: true };
        }
      });
    }

    // Injecter le bridge HIVE dans le sandbox
    // `HIVE.sleepAndWake(delayMs, prompt)` permet au script de planifier son propre réveil.
    // La variable __hiveSleepResult capture le résultat pour le retourner dans les métadonnées.
    if (hiveBridge) {
      globals['HIVE'] = {
        sleepAndWake: async (delayMs: number, wakePrompt: string) => {
          const result = await hiveBridge.sleepAndWake(delayMs, wakePrompt);
          // Capturer pour le caller (ProgrammaticExecutor.execute)
          globals['__hiveSleepResult'] = result;
          return result;
        },
        waitForBackground: async (commandId: string, checkEveryMs: number, wakePrompt: string) => {
          const result = await hiveBridge.waitForBackground(commandId, checkEveryMs, wakePrompt);
          globals['__hiveSleepResult'] = result;
          return result;
        },
      };
    } else {
      // Fallback: injecter un objet HIVE factice qui ne plante pas
      globals['HIVE'] = {
        sleepAndWake: async (_delayMs: number, _wakePrompt: string) => ({
          type: 'SLEEP_ERROR',
          wakeEventId: '',
          wakeAtMs: 0,
          message: '[HIVE] WakeSystem non disponible dans ce contexte.',
        }),
        waitForBackground: async (
          _commandId: string,
          _checkEveryMs: number,
          _wakePrompt: string,
        ) => ({
          type: 'SLEEP_ERROR',
          wakeEventId: '',
          wakeAtMs: 0,
          message: '[HIVE] WakeSystem non disponible dans ce contexte.',
        }),
      };
    }

    // ── Layer 2 : Scope Guard (Proxy) ──
    // Empêche l'accès silencieux à des variables non définies.
    // Sans ça, `undefinedVar` retourne `undefined` au lieu de lancer une erreur.
    return this.createGuardedContext(globals);
  }

  /**
   * Enveloppe les globals dans un Proxy qui lance des ReferenceError explicites
   * pour toute variable non injectée. Empêche les bugs silencieux.
   */
  private createGuardedContext(globals: Record<string, unknown>): Record<string, unknown> {
    return new Proxy(globals, {
      get(target, prop: string | symbol) {
        if (typeof prop === 'symbol') return Reflect.get(target, prop);
        if (prop in target) return target[prop as string];

        // Variables internes du VM à ignorer
        const vmInternals = [
          'global',
          'globalThis',
          'GLOBAL',
          'root',
          'window',
          'self',
          '__hiveSleepResult',
        ];
        if (vmInternals.includes(prop as string)) return undefined;

        // Variable non définie → erreur explicite
        throw new ReferenceError(
          `[SafeScript] "${String(prop)}" n'est pas défini. ` +
            "Vérifiez le nom de la variable ou de l'outil.",
        );
      },
      set(target, prop: string | symbol, value) {
        // Permettre la création de variables dans le scope
        target[prop as string] = value;
        return true;
      },
      has() {
        // Retourner true pour forcer le VM à passer par get()
        // au lieu de ReferenceError silencieux
        return true;
      },
    });
  }

  /**
   * Exécute le code dans un Node.js VM isolé.
   * Utilise une Promise pour gérer le résultat async.
   */
  private runInVM(code: string, sandboxGlobals: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      // Injecter les callbacks de résolution dans le sandbox
      sandboxGlobals.__resolve = resolve;
      sandboxGlobals.__reject = (err: unknown) => {
        if (err instanceof Error) {
          reject(err);
        } else {
          reject(new Error(String(err)));
        }
      };

      const context = vm.createContext(sandboxGlobals);

      // Timeout de sécurité global
      const timeoutId = setTimeout(() => {
        reject(new Error(`[PTC] Timeout: exécution dépassant ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      const cleanup = () => clearTimeout(timeoutId);

      // Patch: attacher cleanup sur la résolution AVANT l'exécution de runInContext
      const originalResolve = sandboxGlobals.__resolve as (v: unknown) => void;
      const originalReject = sandboxGlobals.__reject as (e: unknown) => void;
      sandboxGlobals.__resolve = (v: unknown) => {
        cleanup();
        originalResolve(v);
      };
      sandboxGlobals.__reject = (e: unknown) => {
        cleanup();
        originalReject(e);
      };

      try {
        Reflect.apply(vm.runInContext, vm, [
          code,
          context,
          {
            filename: 'ptc-execution.js',
            timeout: this.config.timeoutMs,
          },
        ]);
      } catch (err) {
        cleanup();
        reject(err);
        return;
      }
    });
  }

  // validateSyntax is now handled by SafeScriptValidator (Layer 1 + Layer 3)

  private _serializeObject(output: Record<string, unknown>): Record<string, unknown> {
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(output)) {
      try {
        Reflect.set(safe, key, JSON.parse(JSON.stringify(value)));
      } catch {
        Reflect.set(safe, key, String(value));
      }
    }
    return safe;
  }

  /** Sérialise le résultat de manière sûre (gère les objets non-sérialisables) */
  private safeSerialize(output: unknown, toolCalls: ToolCallRecord[]): unknown {
    if (output === undefined || output === null) {
      if (toolCalls.length === 0) {
        return { message: 'Code exécuté sans résultat', success: true };
      }
      if (toolCalls.length === 1) {
        const firstCall = toolCalls.at(0);
        return firstCall?.result ?? { success: !firstCall?.error };
      }
      return {
        message: `${toolCalls.length} outils exécutés`,
        results: toolCalls.map((tc) => ({
          tool: tc.toolName,
          success: !tc.error,
          result: tc.result,
        })),
      };
    }

    try {
      return JSON.parse(JSON.stringify(output));
    } catch {
      if (typeof output === 'object' && output !== null) {
        return this._serializeObject(output as Record<string, unknown>);
      }
      return { value: String(output), type: typeof output };
    }
  }

  /**
   * Calcule les tokens économisés par rapport à la boucle ReAct classique.
   *
   * En ReAct, chaque tool call = 1 round-trip LLM complet :
   *   - Re-envoi de tout le contexte (system + history + résultats précédents)
   *   - Le LLM décide "quoi faire ensuite" (tokens de décision)
   *   - Overhead JSON de la structure tool_call
   *
   * En PTC, tout ça est remplacé par 1 exécution locale.
   */
  private calculateTokenSavings(toolCalls: ToolCallRecord[]): {
    intermediateResults: number;
    roundTripContext: number;
    toolCallOverhead: number;
    llmDecisions: number;
    totalSaved: number;
  } {
    const numCalls = toolCalls.length;

    if (numCalls <= 1) {
      return {
        intermediateResults: 0,
        roundTripContext: 0,
        toolCallOverhead: 0,
        llmDecisions: 0,
        totalSaved: 0,
      };
    }

    // 1. Tokens des résultats intermédiaires (jamais envoyés au LLM)
    let intermediateResults = 0;
    const resultSizes: number[] = [];
    for (const call of toolCalls) {
      if (call.result) {
        const tokens = Math.ceil(JSON.stringify(call.result).length / 4);
        intermediateResults += tokens;
        resultSizes.push(tokens);
      }
    }

    // 2. Tokens de re-envoi du contexte (base + résultats accumulés × N-1 calls)
    let roundTripContext = 0;
    let accumulated = 0;
    for (let i = 1; i < numCalls; i++) {
      accumulated += resultSizes[i - 1] || 50;
      roundTripContext += this.config.baseContextTokens + accumulated;
    }

    // 3. Overhead JSON par tool_call (~40 tokens par appel)
    const toolCallOverhead = numCalls * 40;

    // 4. Tokens de décision LLM (~80 tokens par étape de réflexion)
    const llmDecisions = (numCalls - 1) * 80;

    const totalSaved = intermediateResults + roundTripContext + toolCallOverhead + llmDecisions;

    return { intermediateResults, roundTripContext, toolCallOverhead, llmDecisions, totalSaved };
  }
}
