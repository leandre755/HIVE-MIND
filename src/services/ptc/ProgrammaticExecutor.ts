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

const FORBIDDEN_TOOL_PROPS = new Set([
  'constructor',
  '__proto__',
  'prototype',
  'caller',
  'callee',
  'arguments',
  'bind',
  'call',
  'apply',
  'toString',
  'valueOf',
]);

const contextCleanupMap = new WeakMap<object, () => void>();

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
        const __payload = __result !== undefined ? __result : null;
        try {
            __resolve(JSON.stringify(__payload));
        } catch (serErr) {
            __resolve(JSON.stringify({
                __unserializable: true,
                reason: serErr && serErr.message ? serErr.message : String(serErr),
                preview: String(__payload).slice(0, 500),
            }));
        }
    } catch (err) {
        __reject(err && err.message ? err.message : String(err));
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
  private _guardFunction<T extends (...args: never[]) => unknown>(fn: T): T {
    try {
      Object.setPrototypeOf(fn, null);
    } catch {
      /* ignore */
    }

    return new Proxy(fn, {
      get(target, prop, receiver) {
        if (typeof prop === 'symbol') {
          return prop === Symbol.species || prop === Symbol.hasInstance
            ? undefined
            : Reflect.get(target, prop, receiver);
        }
        if (FORBIDDEN_TOOL_PROPS.has(String(prop))) {
          throw new Error(
            `Accès interdit à "${String(prop)}" sur les fonctions injectées (sandbox escape)`,
          );
        }
        return Reflect.get(target, prop, receiver);
      },
      getPrototypeOf() {
        return null;
      },
      apply(target, _thisArg, argArray) {
        return Reflect.apply(target, null, argArray);
      },
    }) as unknown as T;
  }

  /**
   * Assainit récursivement les retours d'outils pour détacher intégralement les prototypes hôtes.
   * Lorsqu'une fonction de désérialisation interne au realm VM est fournie (vmParse),
   * les objets et tableaux sont matérialisés directement dans le realm VM, héritant
   * de ses prototypes verrouillés et éliminant tout objet du runtime hôte Node.js.
   */
  private _sanitizeToolResult(value: unknown, vmParse?: (s: string) => unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'function') {
      throw new Error('[PTC] Les outils ne peuvent pas retourner de fonctions exécutables.');
    }
    if (typeof value !== 'object') return value;

    let jsonStr: string;
    try {
      jsonStr = JSON.stringify(value);
    } catch (err) {
      throw new Error(
        `[PTC] Résultat d'outil non sérialisable: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    if (vmParse) {
      try {
        return vmParse(jsonStr);
      } catch {
        // En cas d'erreur de parsing dans la VM, repli sur nettoyage local
      }
    }

    let cloned: unknown;
    try {
      cloned = JSON.parse(jsonStr);
    } catch {
      return String(value);
    }

    const seen = new WeakSet<object>();
    const stripPrototypes = (current: unknown): unknown => {
      if (current === null || current === undefined || typeof current !== 'object') {
        if (typeof current === 'function') return undefined;
        return current;
      }
      if (seen.has(current)) return current;
      seen.add(current);

      if (Array.isArray(current)) {
        try {
          Object.setPrototypeOf(current, null);
        } catch {
          /* ignore */
        }
        for (let i = 0; i < current.length; i++) {
          const item = Reflect.get(current, i);
          Reflect.set(current, i, stripPrototypes(item));
        }
      } else {
        try {
          Object.setPrototypeOf(current, null);
        } catch {
          /* ignore */
        }
        for (const key of Object.keys(current)) {
          const val = Reflect.get(current, key);
          Reflect.set(current, key, stripPrototypes(val));
        }
      }
      return current;
    };

    return stripPrototypes(cloned);
  }

  private buildSandboxContext(
    toolFunctions: ReadonlyMap<string, ToolFunction>,
    toolCalls: ToolCallRecord[],
    hiveBridge?: HiveWakeBridge,
  ): Record<string, unknown> {
    const globals: Record<string, unknown> = Object.create(null);

    const consoleObj: Record<string, unknown> = Object.create(null);
    consoleObj.log = this._guardFunction((...args: unknown[]) =>
      console.log('[PTC:sandbox]', ...args),
    );
    consoleObj.warn = this._guardFunction((...args: unknown[]) =>
      console.warn('[PTC:sandbox]', ...args),
    );
    consoleObj.error = this._guardFunction((...args: unknown[]) =>
      console.error('[PTC:sandbox]', ...args),
    );
    for (const p of ['constructor', '__proto__', 'prototype']) {
      Object.defineProperty(consoleObj, p, {
        get: () => {
          throw new Error(`[PTC] Accès interdit à ${p} sur console`);
        },
        set: () => {
          throw new Error(`[PTC] Accès interdit à ${p} sur console`);
        },
        configurable: false,
      });
    }
    globals['console'] = consoleObj;

    const timers = new Map<number, NodeJS.Timeout>();
    let timerSeq = 0;

    globals['setTimeout'] = this._guardFunction(
      (fn: (...args: unknown[]) => unknown, ms: number) => {
        const handleId = ++timerSeq;
        const t = setTimeout(
          () => {
            timers.delete(handleId);
            try {
              if (typeof fn === 'function') {
                const res = fn();
                if (res && typeof (res as Promise<unknown>).catch === 'function') {
                  (res as Promise<unknown>).catch((asyncErr) => {
                    console.warn(
                      '[PTC Sandbox] Rejet asynchrone ignoré dans setTimeout callback:',
                      asyncErr,
                    );
                  });
                }
              }
            } catch (err) {
              console.warn('[PTC Sandbox] Erreur ignorée dans setTimeout callback:', err);
            }
          },
          Math.max(0, Number(ms) || 0),
        );
        timers.set(handleId, t);
        return handleId;
      },
    );
    globals['clearTimeout'] = this._guardFunction((id: unknown) => {
      if (typeof id !== 'number') return;
      const t = timers.get(id);
      if (t) {
        clearTimeout(t);
        timers.delete(id);
      }
    });

    const cleanupTimers = () => {
      for (const t of timers.values()) {
        try {
          clearTimeout(t);
        } catch {
          /* ignore */
        }
      }
      timers.clear();
    };
    contextCleanupMap.set(globals, cleanupTimers);

    // Injecter chaque outil comme fonction globale protégée
    for (const [name, fn] of toolFunctions) {
      const toolWrapper = async (args: Record<string, unknown>) => {
        const callStart = Date.now();
        const record: ToolCallRecord = { toolName: name, args };
        toolCalls.push(record);

        try {
          const result = await fn(args);
          const vmParse = globals['__vmJsonParse'] as ((s: string) => unknown) | undefined;
          const safeResult = this._sanitizeToolResult(result, vmParse);
          record.result = safeResult;
          record.executionTimeMs = Date.now() - callStart;
          return safeResult;
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          record.error = errorMsg;
          record.executionTimeMs = Date.now() - callStart;
          return { success: false, error: errorMsg, gracefulDegradation: true };
        }
      };

      Reflect.set(globals, name, this._guardFunction(toolWrapper));
    }

    // Injecter le bridge HIVE dans le sandbox
    const hiveObj: Record<string, unknown> = Object.create(null);
    if (hiveBridge) {
      hiveObj.sleepAndWake = this._guardFunction(async (delayMs: number, wakePrompt: string) => {
        const result = await hiveBridge.sleepAndWake(delayMs, wakePrompt);
        globals['__hiveSleepResult'] = result;
        return result;
      });
      hiveObj.waitForBackground = this._guardFunction(
        async (commandId: string, checkEveryMs: number, wakePrompt: string) => {
          const result = await hiveBridge.waitForBackground(commandId, checkEveryMs, wakePrompt);
          globals['__hiveSleepResult'] = result;
          return result;
        },
      );
    } else {
      hiveObj.sleepAndWake = this._guardFunction(async (_delayMs: number, _wakePrompt: string) => ({
        type: 'SLEEP_ERROR',
        wakeEventId: '',
        wakeAtMs: 0,
        message: '[HIVE] WakeSystem non disponible dans ce contexte.',
      }));
      hiveObj.waitForBackground = this._guardFunction(
        async (_commandId: string, _checkEveryMs: number, _wakePrompt: string) => ({
          type: 'SLEEP_ERROR',
          wakeEventId: '',
          wakeAtMs: 0,
          message: '[HIVE] WakeSystem non disponible dans ce contexte.',
        }),
      );
    }
    for (const p of ['constructor', '__proto__', 'prototype']) {
      Object.defineProperty(hiveObj, p, {
        get: () => {
          throw new Error(`[PTC] Accès interdit à ${p} sur HIVE`);
        },
        set: () => {
          throw new Error(`[PTC] Accès interdit à ${p} sur HIVE`);
        },
        configurable: false,
      });
    }
    globals['HIVE'] = hiveObj;

    // ── Layer 2 : Scope Guard actif ──
    return this.createGuardedContext(globals);
  }

  /**
   * Applique le verrouillage strict sur les propriétés prototypes sensibles (constructor, __proto__, prototype).
   * Verrouille l'objet globals directement pour garantir un contexte VM propre et conforme.
   */
  private createGuardedContext(globals: Record<string, unknown>): Record<string, unknown> {
    const forbidden = () => {
      throw new ReferenceError(
        "[SafeScript] L'accès à cette propriété est interdit (protection prototype).",
      );
    };
    for (const prop of ['constructor', '__proto__', 'prototype']) {
      Object.defineProperty(globals, prop, {
        get: forbidden,
        set: forbidden,
        configurable: false,
      });
    }
    return globals;
  }

  /**
   * Exécute le code dans un Node.js VM isolé.
   * Utilise une Promise pour gérer le résultat async.
   */
  private runInVM(code: string, sandboxGlobals: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const context = vm.createContext(sandboxGlobals);

      // Injecter le parser JSON interne au realm VM pour instancier les retours d'outils
      // directement dans le contexte isolé sans aucune fuite d'objet ou de prototype hôte
      try {
        const vmJsonParse = Reflect.apply(vm.runInContext, vm, [
          `((jsonStr) => {
            const parsed = JSON.parse(jsonStr);
            const strip = (val) => {
              if (val && typeof val === 'object') {
                if (!Array.isArray(val)) {
                  try { Object.setPrototypeOf(val, null); } catch {}
                }
                for (const k of Object.keys(val)) {
                  val[k] = strip(val[k]);
                }
              }
              return val;
            };
            return strip(parsed);
          })`,
          context,
        ]);
        Object.defineProperty(sandboxGlobals, '__vmJsonParse', {
          value: vmJsonParse,
          writable: false,
          configurable: false,
          enumerable: false,
        });
      } catch (parserErr) {
        reject(parserErr);
        return;
      }

      // Sanitisation préventive immédiate du realm VM pour neutraliser l'évasion par prototype ou constructeur
      try {
        Reflect.apply(vm.runInContext, vm, [
          `(() => {
            const forbidden = () => {
              throw new Error('[PTC Sandbox] Accès prototype ou constructeur interdit');
            };
            const fnProto = Object.getPrototypeOf(() => {});
            const asyncFnProto = Object.getPrototypeOf(async () => {});
            const genFnProto = Object.getPrototypeOf(function* () {});
            const asyncGenFnProto = Object.getPrototypeOf(async function* () {});
            const allFnProtos = [fnProto, asyncFnProto, genFnProto, asyncGenFnProto].filter(Boolean);
            for (const p of [Object.prototype, Error.prototype, ...allFnProtos]) {
              if (!p) continue;
              try {
                Object.defineProperty(p, 'constructor', {
                  get: forbidden,
                  set: forbidden,
                  configurable: false,
                });
                Object.defineProperty(p, '__proto__', {
                  get: forbidden,
                  set: forbidden,
                  configurable: false,
                });
              } catch (e) {
                throw new Error('[PTC Sandbox] Échec du verrouillage de prototype: ' + (e && e.message ? e.message : String(e)));
              }
            }
            // Verrouiller constructor sur Array lui-même et __proto__ sur Array.prototype
            // afin de préserver ArraySpeciesCreate pour .map/.filter/.slice tout en bloquant [].constructor.constructor
            try {
              Object.defineProperty(Array, 'constructor', {
                get: forbidden,
                set: forbidden,
                configurable: false,
              });
              Object.defineProperty(Array.prototype, '__proto__', {
                get: forbidden,
                set: forbidden,
                configurable: false,
              });
            } catch (e) {
              throw new Error('[PTC Sandbox] Échec du verrouillage de prototype Array: ' + (e && e.message ? e.message : String(e)));
            }

            // Verrouiller les constructeurs intrinsèques restants
            const intrinsics = [
              typeof Function !== 'undefined' ? Function : null,
              typeof String !== 'undefined' ? String : null,
              typeof Number !== 'undefined' ? Number : null,
              typeof Boolean !== 'undefined' ? Boolean : null,
              typeof RegExp !== 'undefined' ? RegExp : null,
              typeof Promise !== 'undefined' ? Promise : null,
              typeof Map !== 'undefined' ? Map : null,
              typeof Set !== 'undefined' ? Set : null,
              typeof Symbol !== 'undefined' ? Symbol : null,
              typeof Date !== 'undefined' ? Date : null,
              typeof JSON !== 'undefined' ? JSON : null,
            ].filter(Boolean);
            for (const ctor of intrinsics) {
              try {
                Object.defineProperty(ctor, 'constructor', {
                  get: forbidden,
                  set: forbidden,
                  configurable: false,
                });
                if (ctor.prototype) {
                  Object.defineProperty(ctor.prototype, '__proto__', {
                    get: forbidden,
                    set: forbidden,
                    configurable: false,
                  });
                }
              } catch (e) {
                throw new Error("[PTC Sandbox] Échec du verrouillage de l'intrinsèque: " + (e && e.message ? e.message : String(e)));
              }
            }
          })();`,
          context,
        ]);
      } catch (sanitizationErr) {
        reject(sanitizationErr);
        return;
      }

      // Timeout de sécurité global
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`[PTC] Timeout: exécution dépassant ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      const cleanup = () => {
        clearTimeout(timeoutId);
        const cleanupFn = contextCleanupMap.get(sandboxGlobals);
        if (typeof cleanupFn === 'function') {
          try {
            cleanupFn();
          } catch {
            /* ignore */
          }
        }
      };

      const guardedResolve = this._guardFunction((jsonStr: unknown) => {
        cleanup();
        try {
          const parsed = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
          resolve(parsed);
        } catch {
          resolve(jsonStr);
        }
      });
      const guardedReject = this._guardFunction((err: unknown) => {
        cleanup();
        if (err instanceof Error) {
          reject(err);
        } else {
          reject(new Error(String(err)));
        }
      });

      Object.defineProperty(sandboxGlobals, '__resolve', {
        value: guardedResolve,
        writable: false,
        configurable: false,
        enumerable: false,
      });
      Object.defineProperty(sandboxGlobals, '__reject', {
        value: guardedReject,
        writable: false,
        configurable: false,
        enumerable: false,
      });

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
