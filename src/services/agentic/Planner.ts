// services/agentic/Planner.ts
// ============================================================================
// EXPLICIT PLANNER - Plan → Execute → Review for complex tasks
// ============================================================================

import { providerRouter } from '../../providers/index.js';
import { actionMemory } from '../memory/ActionMemory.js';
import { tryParseJson } from '../../utils/ResponseFormatEnforcer.js';

interface PlanStep {
  id: number;
  action: string;
  tool: string;
  params: Record<string, unknown>;
  estimated_time: number;
  depends_on: number[];
}

interface Plan {
  steps: PlanStep[];
  total_time_estimate: number;
  complexity: 'low' | 'medium' | 'high';
}

interface ToolParameter {
  type?: string;
  description?: string;
  properties?: Record<string, ToolParameter>;
}

interface ToolParameters {
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolInfo {
  function?: { name?: string; description?: string; parameters?: ToolParameters };
  name?: string;
  description?: string;
  parameters?: ToolParameters;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface StepResult {
  error?: boolean;
  success?: boolean;
  message?: string;
  llmOutput?: unknown;
  data?: unknown;
  retries?: number;
  [key: string]: unknown;
}

interface ExecutionLog {
  planId: string;
  goal: string;
  plan: Plan;
  startTime: number;
  endTime?: number;
  duration?: number;
  completed: number[];
  failed: number[];
  results: Record<number, StepResult>;
  _replanAttempt: boolean;
  replanFailed?: boolean;
}

interface ReviewResult {
  success: boolean;
  successRate: number;
  totalSteps: number;
  completed: number;
  failed: number;
  duration: number;
  efficiency: number;
}

interface PlanResult {
  id: string;
  goal: string;
  steps: PlanStep[];
  totalTime: number;
  complexity: string;
  status: string;
}

type PlanInput = Record<string, unknown>;

function _findExactKeyInObj(obj: Record<string, unknown>, targetKey: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const targetLower = targetKey.toLowerCase();

  for (const [key, val] of Object.entries(obj)) {
    if (key.toLowerCase() === targetLower) return val;
    if (val && typeof val === 'object') {
      const found = _findExactKeyInObj(val as Record<string, unknown>, targetKey);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function _findKeyInObj(obj: Record<string, unknown>, keys: readonly string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    if (Object.hasOwn(obj, key)) return Reflect.get(obj, key);
  }
  for (const [, val] of Object.entries(obj)) {
    if (val && typeof val === 'object') {
      const found = _findKeyInObj(val as Record<string, unknown>, keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function _extractExactMatch(exactMatch: unknown): string {
  if (typeof exactMatch === 'object' && exactMatch !== null) {
    const matchObj = exactMatch as Record<string, unknown>;
    const subUrl = matchObj.url || matchObj.href || matchObj.link;
    if (subUrl && typeof subUrl !== 'object') return String(subUrl);
    return JSON.stringify(exactMatch);
  }
  return String(exactMatch);
}

function _extractTypedMatch(
  outObj: Record<string, unknown>,
  placeholderName: string,
): string | undefined {
  const nameLower = placeholderName.toLowerCase();
  if (nameLower.includes('path')) {
    const foundPath = _findKeyInObj(outObj, ['filePath', 'path', 'fileName', 'file', 'filepath']);
    if (foundPath) return String(foundPath);
  }
  if (nameLower.includes('url')) {
    const foundUrl = _findKeyInObj(outObj, ['url', 'href', 'link']);
    if (foundUrl) return String(foundUrl);
  }
  return undefined;
}

function _extractFromObj(outObj: Record<string, unknown>, placeholderName: string): string {
  const exactMatch = _findExactKeyInObj(outObj, placeholderName);
  if (exactMatch !== undefined) {
    return _extractExactMatch(exactMatch);
  }

  const typed = _extractTypedMatch(outObj, placeholderName);
  if (typed !== undefined) return typed;

  const foundGeneral = _findKeyInObj(outObj, [
    'result',
    'data',
    'text',
    'value',
    'filePath',
    'path',
    'url',
  ]);
  if (foundGeneral !== undefined) {
    return typeof foundGeneral === 'object' ? JSON.stringify(foundGeneral) : String(foundGeneral);
  }

  if (outObj.result !== undefined) {
    return typeof outObj.result === 'object'
      ? JSON.stringify(outObj.result)
      : String(outObj.result);
  }

  return JSON.stringify(outObj);
}

function extractValueFromStepResult(result: StepResult | unknown, placeholderName: string): string {
  if (!result) return '';

  let output: unknown = (result as StepResult).llmOutput;
  if (output === undefined) output = (result as StepResult).data;
  if (output === undefined) output = result;

  if (typeof output === 'object' && output !== null) {
    return _extractFromObj(output as Record<string, unknown>, placeholderName);
  }
  return String(output);
}

function formatToolForPlanner(t: ToolInfo): string {
  const name = t.function?.name || t.name;
  const desc = t.function?.description || t.description || '';
  const params = t.function?.parameters || t.parameters;

  let paramsStr = '';
  if (params?.properties) {
    const required = params.required || [];
    const props = Object.entries(params.properties)
      .map(([key, val]: [string, ToolParameter]) => {
        const req = required.includes(key) ? ' (REQUIRED)' : ' (optional)';
        const type = val.type ? `: ${val.type}` : '';
        return `     * ${key}${type}${req} - ${val.description || ''}`;
      })
      .join('\n');
    if (props) {
      paramsStr = `\n   Parameters:\n${props}`;
    }
  }
  return `- ${name}: ${desc}${paramsStr}`;
}

function interpolateParams(
  params: PlanInput | string | unknown,
  stepResults: Record<number, StepResult>,
): unknown {
  if (!params) return params;

  if (typeof params === 'string') {
    return params.replace(/\{\{([^{}]+)\}\}/g, (match, inner: string) => {
      const clean = inner.trim();

      const matchFromStep = clean.match(/^(\w+)_from_step_(\d+)$/i);
      if (matchFromStep) {
        const name = matchFromStep[1];
        const stepId = parseInt(matchFromStep[2], 10);
        const result = Object.hasOwn(stepResults, stepId)
          ? (Reflect.get(stepResults, stepId) as StepResult)
          : undefined;
        if (result) return extractValueFromStepResult(result, name);
        return match;
      }

      const stepIdMatch = clean.match(/(?:step|steps)[.\s_-]?(\d+)/i);
      if (stepIdMatch) {
        const stepId = parseInt(stepIdMatch[1], 10);
        const result = Object.hasOwn(stepResults, stepId)
          ? (Reflect.get(stepResults, stepId) as StepResult)
          : undefined;
        if (result) {
          let propName = 'result';
          const parts = clean.split(/[._-]/).map((p: string) => p.trim());
          const technicalWords = ['step', 'steps', 'output', 'result', String(stepId)];
          const cleanParts = parts.filter(
            (p: string) => p && !technicalWords.includes(p.toLowerCase()),
          );

          if (cleanParts.length > 0) {
            propName = cleanParts[0];
          }

          const val = extractValueFromStepResult(result, propName);
          console.log(
            `[Planner] 🔄 Interpolation placeholder: "${clean}" (step: ${stepId}, prop: ${propName}) -> "${val}"`,
          );
          return val;
        }
        console.warn(
          `[Planner] ⚠️ Impossible d'interpoler ${match}: aucun résultat pour l'étape ${stepId}`,
        );
        return match;
      }

      return match;
    });
  }

  if (Array.isArray(params)) {
    return params.map((item) => interpolateParams(item, stepResults));
  }

  if (typeof params === 'object' && params !== null) {
    const interpolated: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(params as Record<string, unknown>)) {
      Reflect.set(interpolated, key, interpolateParams(val, stepResults));
    }
    return interpolated;
  }

  return params;
}

let json5: { parse: (s: string) => unknown } | null = null;
let jsonRepair: ((s: string) => string) | null = null;
let Ajv:
  | (new (opts?: Record<string, unknown>) => {
      compile: (
        schema: Record<string, unknown>,
      ) => ((data: unknown) => boolean) & { errors?: unknown[] };
    })
  | null = null;

async function loadJsonLibraries() {
  if (json5 && jsonRepair && Ajv) return { json5, jsonRepair, Ajv };

  try {
    const json5Module = await import('json5');
    const jsonRepairModule = await import('jsonrepair');
    const ajvModule = await import('ajv');

    json5 = (json5Module.default || json5Module) as typeof json5;
    jsonRepair =
      (jsonRepairModule as unknown as { jsonrepair?: (s: string) => string }).jsonrepair ||
      (jsonRepairModule as unknown as (s: string) => string);
    Ajv = (ajvModule.default || ajvModule) as typeof Ajv;

    console.log('[Planner] ✅ Bibliothèques JSON chargées (json5, jsonrepair, ajv)');
    return { json5, jsonRepair, Ajv };
  } catch (e: unknown) {
    console.warn(
      '[Planner] ⚠️ Bibliothèques JSON non disponibles, fallback sur parsing natif:',
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

const PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          action: { type: 'string', minLength: 1 },
          tool: { type: 'string', minLength: 1 },
          params: { type: 'object' },
          estimated_time: { type: 'number', minimum: 0 },
          depends_on: { type: 'array', items: { type: 'number' } },
        },
        required: ['id', 'action', 'tool'],
      },
      minItems: 1,
    },
    total_time_estimate: { type: 'number', minimum: 0 },
    complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['steps'],
};

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

class CriticalFailureError extends Error {
  constructor(
    public plan: PlanResult,
    public executionLog: ExecutionLog,
  ) {
    super('Critical failure detected');
    this.name = 'CriticalFailureError';
  }
}

export class ExplicitPlanner {
  complexityThreshold: number;

  constructor() {
    this.complexityThreshold = 3;
  }

  async _parsePlanJson(planText: string): Promise<Plan | null> {
    if (!planText) return null;

    const cleanedJson = planText.trim();

    try {
      let parsedPlan: Plan | null = null;
      try {
        parsedPlan = tryParseJson<Plan>(planText);
        console.log('[Planner] ✅ JSON parsé avec succès via tryParseJson');
      } catch (err: unknown) {
        console.warn(
          '[Planner] ⚠️ tryParseJson a échoué, tentative de nettoyage manuel:',
          extractErrorMessage(err),
        );
        parsedPlan = this._parseJsonFallback(planText);
        if (!parsedPlan) return null;
      }

      const libs = await loadJsonLibraries();

      if (libs && Ajv) {
        try {
          const ajv = new Ajv({ useDefaults: true });
          const validate = ajv.compile(PLAN_SCHEMA);

          if (!validate(parsedPlan)) {
            console.warn('[Planner] ⚠️ Plan invalide selon schéma:', validate.errors);

            const correctedPlan = this._autoCorrectPlan(parsedPlan as unknown as PlanInput);
            if (correctedPlan) {
              console.log('[Planner] ✅ Plan corrigé automatiquement');
              return correctedPlan;
            }

            const firstError = validate.errors?.[0] as { message?: string } | undefined;
            console.warn(`[Planner] ⚠️ Plan invalide: ${firstError?.message}`);
          }
        } catch (ajvErr: unknown) {
          console.warn(
            '[Planner] ⚠️ Validation Ajv échouée, plan retourné sans validation:',
            extractErrorMessage(ajvErr),
          );
        }
      }

      return parsedPlan;
    } catch (mainError: unknown) {
      console.warn('[Planner] ⚠️ Fallback parsing natif:', extractErrorMessage(mainError));
      return this._parseJsonFallback(cleanedJson);
    }
  }

  _parseJsonFallback(jsonText: string): Plan | null {
    try {
      let cleaned = jsonText.trim();
      const firstTick = cleaned.indexOf('```json');
      const lastTick = cleaned.lastIndexOf('```');
      if (firstTick !== -1 && lastTick > firstTick) {
        cleaned = cleaned.slice(firstTick + 7, lastTick).trim();
      } else {
        const firstOpen = cleaned.search(/[{[]/);
        if (firstOpen !== -1) {
          const lastClose = cleaned.lastIndexOf(cleaned.charAt(firstOpen) === '{' ? '}' : ']');
          if (lastClose !== -1 && lastClose > firstOpen) {
            cleaned = cleaned.slice(firstOpen, lastClose + 1).trim();
          }
        }
      }

      const fixedJson = cleaned
        .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')
        .replace(/'/g, '"')
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/([{,]\s*)"([^"]+)"\s*:\s*'(.*?)'/g, '$1"$2":"$3"')
        .trim();

      return JSON.parse(fixedJson) as Plan;
    } catch (e: unknown) {
      console.error(
        '[Planner] ❌ Échec parsing JSON après toutes les tentatives:',
        extractErrorMessage(e),
      );
      return null;
    }
  }

  _autoCorrectPlan(plan: PlanInput): Plan | null {
    try {
      const corrected = { ...plan } as Record<string, unknown>;

      if (!Array.isArray(corrected.steps)) {
        corrected.steps = [];
      }

      const steps = (corrected.steps as PlanInput[])
        .filter((step): step is PlanInput => step && typeof step === 'object')
        .map((step, index) => {
          const s = step as Record<string, unknown>;
          let resolvedTool = (s.tool ||
            s.tool_name ||
            s.toolName ||
            s.function ||
            s.use_tool ||
            s.action_type ||
            s.command ||
            null) as string | null;

          if (!resolvedTool && s.action) {
            const actionLower = String(s.action).toLowerCase();
            if (actionLower.includes('screenshot') || actionLower.includes('capture')) {
              resolvedTool = 'browser_screenshot';
            } else if (
              actionLower.includes('scrape') ||
              actionLower.includes('extraire') ||
              actionLower.includes('github') ||
              actionLower.includes('trending')
            ) {
              resolvedTool = 'browser_open';
            } else if (
              actionLower.includes('command') ||
              actionLower.includes('bash') ||
              actionLower.includes('terminal') ||
              actionLower.includes('script')
            ) {
              resolvedTool = 'execute_bash_command';
            } else if (
              actionLower.includes('file') ||
              actionLower.includes('écrire') ||
              actionLower.includes('write') ||
              actionLower.includes('sauvegarder')
            ) {
              resolvedTool = 'execute_bash_command';
            } else {
              resolvedTool = 'execute_bash_command';
            }
            console.log(
              `[Planner] 🔧 Auto-inferred tool "${resolvedTool}" for action: "${s.action}"`,
            );
          }

          return {
            id: Number(s.id) || index + 1,
            action: String(s.action || 'unknown_action'),
            tool: resolvedTool ? String(resolvedTool) : 'execute_bash_command',
            params: (s.params as Record<string, unknown>) || {},
            estimated_time: Number(s.estimated_time) || 10,
            depends_on: Array.isArray(s.depends_on) ? (s.depends_on as unknown[]).map(Number) : [],
          };
        });

      corrected.steps = steps;

      if (steps.length === 0) {
        return null;
      }

      corrected.total_time_estimate =
        Number(corrected.total_time_estimate) ||
        steps.reduce((sum: number, step: PlanStep) => sum + (step.estimated_time || 0), 0);

      corrected.complexity = ['low', 'medium', 'high'].includes(corrected.complexity as string)
        ? corrected.complexity
        : 'medium';

      return corrected as unknown as Plan;
    } catch (e: unknown) {
      console.error('[Planner] Erreur auto-correction:', extractErrorMessage(e));
      return null;
    }
  }

  async needsPlanning(userMessage: string, tools: ToolInfo[]): Promise<boolean> {
    if (userMessage.match(/(plan|planifie|étapes|d'abord.*ensuite|puis|après)/i)) {
      return true;
    }

    try {
      const toolNames = tools.map((t: ToolInfo) => t.function?.name || t.name || '').join(', ');
      const prompt = `<task>
You are estimating task complexity for HIVE-MIND's explicit planner.
Your estimate determines if multi-step planning is needed.
</task>

<user_request>
"${userMessage}"
</user_request>

<available_tools>
${toolNames}
</available_tools>

<estimation_criteria>
Count tools needed:
- 1 tool = Simple, direct action
- 2-3 tools = Medium, sequential steps
- 4+ tools = Complex, requires explicit planning
</estimation_criteria>

<output_format>
Respond with ONLY an integer number representing the estimate. Do not include any other text, reasoning, or markdown.

Few-shot examples:
- Estimate: 1
- Estimate: 3
</output_format>

Estimate:`;

      const response = await providerRouter.chat(
        [
          {
            role: 'system',
            content: 'Tu es un estimateur de complexité. Tu réponds uniquement par un chiffre.',
          },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.1, maxTokens: 5 },
      );

      const text = (response.content || '').trim();
      const match = text.match(/\d+/);
      const estimate = match ? parseInt(match[0], 10) : NaN;
      return !isNaN(estimate) && estimate >= this.complexityThreshold;
    } catch {
      return false;
    }
  }

  private _validateSingleStep(step: PlanStep, i: number, availableToolNames: Set<string>): void {
    if (!step || typeof step !== 'object') {
      throw new Error(`L'étape ${i + 1} du plan est invalide (n'est pas un objet).`);
    }
    if (!step.action) {
      throw new Error(
        `L'étape d'index ${i} du plan est invalide : la propriété "action" est manquante.`,
      );
    }
    if (!step.tool) {
      throw new Error(
        `L'étape "${step.action}" (index ${i}) est invalide : la propriété "tool" est manquante.`,
      );
    }
    if (typeof step.id !== 'number') {
      step.id = i + 1;
    }

    if (!availableToolNames.has(step.tool)) {
      console.warn(`[Planner] ⚠️ Étape ${step.id}: outil "${step.tool}" halluciné`);
      const closest = [...availableToolNames].find(
        (t) =>
          t !== undefined &&
          (step.tool.includes(t) ||
            t.includes(step.tool) ||
            step.tool.replace(/_/g, '').includes(t.replace(/_/g, ''))),
      );
      if (closest) {
        console.log(`[Planner] 🔧 Auto-correction: "${step.tool}" → "${closest}"`);
        step.tool = closest;
      } else {
        throw new Error(
          `L'outil "${step.tool}" spécifié à l'étape ${step.id} n'existe pas dans la liste des outils disponibles.`,
        );
      }
    }
  }

  private _validatePlanSteps(plan: Plan, availableToolNames: Set<string>, goal: string): void {
    if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      throw new Error('Le plan ne contient aucune étape dans le tableau "steps".');
    }

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps.at(i);
      if (step) this._validateSingleStep(step, i, availableToolNames);
    }

    const isComplexQuery =
      /(?: et | puis | ensuite | après | extraire | extrais | résumé | screenshot | capture | faire | créer | sauvegarder | enregistrer)/i.test(
        goal,
      );
    if (isComplexQuery && plan.steps.length < 2) {
      throw new Error(
        "Le plan généré comporte seulement 1 étape. Pour cette tâche complexe, tu DOIS décomposer l'action en au moins 2 étapes distinctes.",
      );
    }
  }

  async plan(goal: string, context: { tools: ToolInfo[]; chatId: string }): Promise<PlanResult> {
    console.log('[Planner] 📋 Création du plan...');

    const toolList = context.tools.map(formatToolForPlanner).join('\n');

    const planPrompt = `<role>
You are HIVE-MIND's PLANNER agent specialized in multi-step task decomposition.
Your primary mission is to break down the user's high-level goal into a series of logical, executable steps.
</role>

<context>
Goal to achieve:
"${goal}"

You will execute these steps sequentially, tracking system state between each action.
</context>

<available_tools>
${toolList}
</available_tools>

<planning_instructions>
To ensure successful execution, structure your planning process according to these guidelines:
1. ANALYSIS AND REASONING: First, analyze the goal. Identify if it is a compound task (e.g., browsing a page AND creating a file, or taking a screenshot AND extracting details).
2. FORCE STEP SPLITTING: If the task is compound, you must explicitly split it into at least 2 distinct steps:
   - Step 1: Retrieve or gather data (e.g., browser_screenshot, read_file, google_ai_search).
   - Step 2: Process, format, write, or report the gathered data (e.g., execute_bash_command, send_file).
3. MATCH TOOLS ACCURATELY: Choose tool names exclusively from the list of available tools. Verify that each selected tool exists exactly as defined.
4. CHOOSE THE RIGHT TOOL:
    - Use \`execute_bash_command\` for terminal actions, running Node scripts, and creating files in the filesystem.
    - Reserve \`code_execution\` only for lightweight orchestration of multiple existing HIVE tools using sandboxed JavaScript. (Do not use it for require/import, npm packages, shell commands, or local file writes).
    - INLINE CODE RESTRICTIONS: Bash commands like \`node -e "..."\` are strictly FORBIDDEN by security policies and will be blocked. To run custom Node.js logic, you MUST plan a step to CREATE a physical script file (e.g. \`storage_hm/run.cjs\`) using tools or bash commands (like echo or cat), and then plan a subsequent step to RUN it with \`node storage_hm/run.cjs\`. Never attempt to run inline code.
    - ES MODULES & TEMPORARY SCRIPTS STRICT COMPATIBILITY: The HIVE-MIND project uses "type": "module" in its package.json. Consequently, Node.js will treat any ".js" file as an ES module, where "require()" is forbidden and will throw "ReferenceError: require is not defined". ANY temporary Node.js script file you write or generate (for example, to use a CommonJS library like pdf-parse, fs, path, etc.) MUST absolutely use the ".cjs" extension (e.g., "storage_hm/extract_text.cjs"), never ".js". You must also execute it using the exact ".cjs" filename (e.g., "node storage_hm/extract_text.cjs").
5. NODE.JS LIBRARY VERSIONS & VARIABLES: When using npm libraries, always check their API and variable usage very carefully. For example, "pdf-parse" v2+ uses a class-based API:
  const fs = require('fs');
  const { PDFParse } = require('pdf-parse');
  const dataBuffer = fs.readFileSync('storage_hm/test_document.pdf');
  const p = new PDFParse({ data: dataBuffer });
  p.getText().then(data => {
      fs.writeFileSync('storage_hm/test_document.md', data.text);
  }).catch(err => {
      process.exitCode = 1;
      process.exit(1);
  });
  NEVER reference a non-existent variable like "buffer" (e.g. { data: buffer } where you read the file into "dataBuffer"). Ensure all variables are fully defined and in scope.
6. DEFINE COMPLETE PARAMETERS: For every step, provide all required properties for the chosen tool.
7. PASS DATA SEQUENTIALLY: Reuse outputs from previous steps by using the variable interpolation syntax "{{step_X_propertyName}}" (e.g., {"filePath": "{{step_1_filePath}}"} or "{{step_1_result}}").
8. DRAFT CONCISE QUERIES: When using search tools (\`google_ai_search\`, \`duckduck_search\`, \`wikipedia\`), write a short, concise search query (maximum of 15 words) for the query parameter. Avoid passing large chunks of text or variable references like "{{step_X_result}}".
9. JSON VALIDITY: Double-check your JSON block. Ensure there are no trailing commas, all keys and strings are wrapped in double quotes, and braces/brackets are correctly balanced.
</planning_instructions>

<output_format>
Your response must consist of two parts:
1. A brief "Thinking" section explaining your reasoning and why the task must be decomposed into at least 2 steps.
2. A "Plan JSON" block containing the structured plan, wrapped in markdown triple backticks.

Example format:
Thinking:
The user wants to navigate to a page, take a screenshot, and then extract trending repositories to format them in a markdown file. This is a compound task. I will split it into two steps: Step 1 will take the screenshot of the page, and Step 2 will extract the data and format the markdown file.

\`\`\`json
{
  "steps": [
    {
      "id": 1,
      "action": "Navigate to the URL and capture a screenshot",
      "tool": "browser_screenshot",
      "params": {
        "url": "https://example.com"
      },
      "estimated_time": 15,
      "depends_on": []
    },
    {
      "id": 2,
      "action": "Extract page content and format as markdown",
      "tool": "execute_bash_command",
      "params": {
        "command": "node scripts/extract.cjs"
      },
      "estimated_time": 20,
      "depends_on": [1]
    }
  ],
  "total_time_estimate": 35,
  "complexity": "medium"
}
\`\`\`
</output_format>

Plan:`;

    let attempts = 0;
    const maxAttempts = 5;
    let plan: Plan | null = null;
    const chatHistory: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Tu es un planificateur expert en décomposition de tâches. Tu dois impérativement respecter le schéma de sortie JSON demandé et diviser les tâches complexes en au moins 2 étapes distinctes.',
      },
      { role: 'user', content: planPrompt },
    ];

    while (attempts < maxAttempts) {
      attempts++;
      let response: { content: string | null } | null = null;
      try {
        response = await providerRouter.chat(chatHistory, { temperature: 0.3 });
        if (!response?.content) {
          throw new Error('La réponse du modèle est vide ou nulle.');
        }

        plan = await this._parsePlanJson(response.content);
        const availableToolNames = new Set(
          context.tools
            .map((t: ToolInfo) => t.function?.name || t.name)
            .filter((n): n is string => Boolean(n)),
        );

        if (!plan) throw new Error('Le plan généré est nul ou invalide.');
        this._validatePlanSteps(plan, availableToolNames, goal);
        break;
      } catch (err: unknown) {
        const errMsg = extractErrorMessage(err);
        console.warn(`[Planner] ⚠️ Tentative ${attempts}/${maxAttempts} échouée: ${errMsg}`);
        if (attempts >= maxAttempts) {
          throw new Error(
            `Planification impossible après ${maxAttempts} tentatives. Dernière erreur: ${errMsg}`,
          );
        }
        chatHistory.push({
          role: 'assistant',
          content: response?.content || 'Plan malformé ou incomplet',
        });
        chatHistory.push({
          role: 'user',
          content: `ERREUR DE PLANIFICATION: ${errMsg}\n\nVeuillez corriger le plan et me renvoyer uniquement le JSON valide contenant toutes les étapes nécessaires.`,
        });
      }
    }

    console.log(
      `[Planner] ✅ Plan validé après ${attempts} tentative(s) : ${plan!.steps.length} étapes`,
    );

    const planId = await actionMemory.startAction(context.chatId, {
      type: 'explicit_plan',
      goal,
      context: { plan },
      priority: 8,
    });

    console.log(
      `[Planner] ✅ Plan créé: ${plan!.steps.length} étapes, ~${plan!.total_time_estimate}s`,
    );

    return {
      id: planId ?? `fallback-${Date.now()}`,
      goal,
      steps: plan!.steps,
      totalTime: plan!.total_time_estimate,
      complexity: plan!.complexity,
      status: 'ready',
    };
  }

  private async _executeStepWithRetry(
    step: PlanStep,
    context: {
      executeToolFn: (
        toolCall: { id: string; function: { name: string; arguments: string } },
        message: unknown,
      ) => Promise<StepResult>;
      chatId: string;
      message: unknown;
      tools: ToolInfo[];
    },
    executionLog: ExecutionLog,
    plan: PlanResult,
  ): Promise<StepResult | null> {
    let retries = 0;
    const MAX_RETRIES = 3;
    let finalResult: StepResult | null = null;
    let stepParams: Record<string, unknown> = (step.params || {}) as Record<string, unknown>;

    while (retries < MAX_RETRIES) {
      try {
        const { validateToolArgs } = await import('../../utils/toolValidator.js');
        const validation = validateToolArgs(
          step.tool,
          JSON.stringify(stepParams),
          context.tools || [],
        );

        if (!validation.valid) {
          throw new Error(
            `[SYSTEM REJECTION] : ${validation.formattedError}\nDIRECTIVE: Expected schema: ${JSON.stringify(validation.schema, null, 0)}`,
          );
        }

        const toolCall = {
          id: `step_${step.id}_try_${retries}`,
          function: { name: step.tool, arguments: JSON.stringify(stepParams) },
        };

        finalResult = await context.executeToolFn(toolCall, context.message);
        this._validateStepResult(finalResult);
        break;
      } catch (err: unknown) {
        retries++;
        const errMsg = extractErrorMessage(err);
        console.warn(
          `[Planner] ⚠️ Étape ${step.id} (Essai ${retries}/${MAX_RETRIES}) échouée: ${errMsg}`,
        );

        if (retries >= MAX_RETRIES) {
          console.error(
            `[Planner] 🛑 Échec définitif de l'étape ${step.id} après ${MAX_RETRIES} essais.`,
          );
          executionLog.failed.push(step.id);
          executionLog.results[step.id] = { error: true, success: false, message: errMsg };
          await actionMemory.updateStep(
            context.chatId,
            `❌ Étape ${step.id}: ${step.action} - ${errMsg}`,
          );

          if (this._isCriticalFailure(step, err)) {
            console.warn('[Planner] 🛑 Échec critique, replanification...');
            throw new CriticalFailureError(plan, executionLog);
          }
          break;
        }

        stepParams = await this._requestSelfCorrection(step.id, step.tool, stepParams, errMsg);
      }
    }

    return finalResult;
  }

  private _validateStepResult(finalResult: StepResult | null): void {
    if (finalResult && (finalResult.error === true || finalResult.success === false)) {
      throw new Error(
        finalResult.message ||
          String(finalResult.error) ||
          (typeof finalResult.llmOutput === 'string'
            ? finalResult.llmOutput
            : JSON.stringify(finalResult.llmOutput)) ||
          'erreur inconnue',
      );
    }

    if (
      finalResult?.llmOutput &&
      typeof (finalResult.llmOutput as Record<string, unknown>).exitCode === 'number' &&
      (finalResult.llmOutput as Record<string, unknown>).exitCode !== 0
    ) {
      const stdout = ((finalResult.llmOutput as Record<string, unknown>).stdout as string) || '';
      throw new Error(
        `[BASH EXIT CODE ${(finalResult.llmOutput as Record<string, unknown>).exitCode}] Command failed.\nOutput: ${stdout.substring(0, 500)}`,
      );
    }
  }

  private async _requestSelfCorrection(
    stepId: number,
    toolName: string,
    stepParams: Record<string, unknown>,
    errMsg: string,
  ): Promise<Record<string, unknown>> {
    console.log(`[Planner] 🔄 Demande d'auto-correction au LLM pour l'étape ${stepId}...`);
    const fixPrompt = `Your previous attempt to call tool "${toolName}" failed with the following error:\n<tool_use_error>${errMsg}</tool_use_error>\n\nYour previous parameters were:\n${JSON.stringify(stepParams)}\n\nFix the parameters and output ONLY the corrected JSON parameters object. Do NOT wrap in markdown.`;

    try {
      const providerRouterModule = (await import('../../providers/index.js')).providerRouter;
      const fixResponse = await providerRouterModule.callServiceRecipe('PLANNER', [
        {
          role: 'system',
          content: 'You are a JSON parameter corrector. Output strictly valid JSON.',
        },
        { role: 'user', content: fixPrompt },
      ]);

      if (fixResponse && fixResponse.content) {
        const { tryParseJson: tpj } = await import('../../utils/ResponseFormatEnforcer.js');
        const parsed = tpj<Record<string, unknown>>(fixResponse.content || '');
        if (parsed) return parsed;
      }
    } catch (aiErr) {
      console.error('[Planner] Échec de la requête de correction:', aiErr);
    }
    return stepParams;
  }

  async execute(
    plan: PlanResult,
    context: {
      executeToolFn: (
        toolCall: { id: string; function: { name: string; arguments: string } },
        message: unknown,
      ) => Promise<StepResult>;
      chatId: string;
      message: unknown;
      tools: ToolInfo[];
    },
    initialExecutionLog?: Partial<ExecutionLog>,
  ): Promise<ExecutionLog> {
    console.log(`[Planner] 🚀 Exécution du plan: ${plan.steps.length} étapes`);

    const executionLog: ExecutionLog = {
      planId: plan.id,
      goal: plan.goal,
      plan: plan as unknown as Plan,
      startTime: initialExecutionLog?.startTime || Date.now(),
      completed: initialExecutionLog?.completed ? [...initialExecutionLog.completed] : [],
      failed: initialExecutionLog?.failed ? [...initialExecutionLog.failed] : [],
      results: initialExecutionLog?.results ? { ...initialExecutionLog.results } : {},
      _replanAttempt: initialExecutionLog?._replanAttempt || false,
    };

    for (const step of plan.steps) {
      try {
        const result = await this._executeSingleStep(step, context, executionLog, plan);
        if (result === 'continue') continue;
        if (result === 'replanned') return executionLog;
      } catch (e: unknown) {
        if (e instanceof CriticalFailureError) {
          return await this._replan(e.plan, e.executionLog, context);
        }
        throw e;
      }
    }

    this._finalizeExecution(executionLog, plan.steps.length);
    return executionLog;
  }

  private async _executeSingleStep(
    step: PlanStep,
    context: {
      executeToolFn: (
        toolCall: { id: string; function: { name: string; arguments: string } },
        message: unknown,
      ) => Promise<StepResult>;
      chatId: string;
      message: unknown;
      tools: ToolInfo[];
    },
    executionLog: ExecutionLog,
    plan: PlanResult,
  ): Promise<'continue' | 'replanned'> {
    if (executionLog.completed.includes(step.id)) {
      console.log(`[Planner] ⏭️ Étape ${step.id} déjà complétée, passage.`);
      return 'continue';
    }

    console.log(`[Planner] Étape ${step.id}/${plan.steps.length}: ${step.action}`);

    if (!this._areDependenciesMet(step, executionLog)) {
      console.warn(`[Planner] ⚠️ Dépendances non satisfaites pour étape ${step.id}`);
      executionLog.failed.push(step.id);
      return 'continue';
    }

    if (step.params) {
      step.params = interpolateParams(step.params, executionLog.results) as Record<string, unknown>;
    }

    if (!step.tool || step.tool === 'unknown_tool') {
      console.warn(
        `[Planner] ⚠️ Étape ${step.id} ignorée: outil manquant ou invalide ("${step.tool || 'null'}")`,
      );
      executionLog.failed.push(step.id);
      executionLog.results[step.id] = {
        error: true,
        message: `Step skipped: no valid tool (was "${step.tool || 'null'}")`,
      };
      await actionMemory.updateStep(
        context.chatId,
        `⏭️ Étape ${step.id}: ${step.action} - outil manquant`,
      );
      return 'continue';
    }

    try {
      const finalResult = await this._executeStepWithRetry(step, context, executionLog, plan);
      if (finalResult && !executionLog.failed.includes(step.id)) {
        finalResult.retries = 0;
        executionLog.results[step.id] = finalResult;
      }
      executionLog.completed.push(step.id);
      await actionMemory.updateStep(context.chatId, `✅ Étape ${step.id}: ${step.action}`);
      console.log(`[Planner] ✅ Étape ${step.id} terminée`);
    } catch (error: unknown) {
      console.error('[Planner] ❌ Échec étape %s:', step.id, extractErrorMessage(error));
      executionLog.failed.push(step.id);

      if (this._isCriticalFailure(step, error)) {
        console.warn('[Planner] 🛑 Échec critique détecté, replanification...');
        throw new CriticalFailureError(plan, executionLog);
      }

      await actionMemory.updateStep(
        context.chatId,
        `❌ Étape ${step.id} échouée: ${extractErrorMessage(error)}`,
      );
    }

    return 'continue';
  }

  private _areDependenciesMet(step: PlanStep, executionLog: ExecutionLog): boolean {
    if (!step.depends_on || step.depends_on.length === 0) return true;
    return step.depends_on.every((depId: number) => executionLog.completed.includes(depId));
  }

  private _finalizeExecution(executionLog: ExecutionLog, totalSteps: number): void {
    executionLog.endTime = Date.now();
    executionLog.duration = executionLog.endTime - executionLog.startTime;
    console.log(
      `[Planner] 🏁 Plan terminé: ${executionLog.completed.length}/${totalSteps} étapes réussies`,
    );
  }

  async review(executionLog: ExecutionLog): Promise<ReviewResult> {
    console.log('[Planner] 📊 Révision post-exécution...');

    const successRate =
      executionLog.completed.length / (executionLog.completed.length + executionLog.failed.length);

    const analysis: ReviewResult = {
      success: successRate >= 0.8,
      successRate,
      totalSteps: executionLog.completed.length + executionLog.failed.length,
      completed: executionLog.completed.length,
      failed: executionLog.failed.length,
      duration: executionLog.duration || 0,
      efficiency: (executionLog.duration || 0) / ((executionLog.completed.length || 1) * 1000),
    };

    if (analysis.success) {
      try {
        const { dreamService } = await import('../dreamService.js');
        const recordFn = (dreamService as Record<string, unknown>).recordPlanSuccess;
        if (typeof recordFn === 'function') {
          await recordFn({
            goal: executionLog.goal,
            steps: executionLog.completed.length,
            duration: executionLog.duration,
            efficiency: analysis.efficiency,
          });
        }
      } catch {
        // Optional feature
      }
    }

    console.log(
      `[Planner] Analyse: ${analysis.successRate * 100}% succès, ${analysis.duration}ms total`,
    );

    return analysis;
  }

  _isCriticalFailure(_step: PlanStep, _error: unknown): boolean {
    return true;
  }

  async _replan(
    originalPlan: PlanResult,
    executionLog: ExecutionLog,
    context: {
      executeToolFn: (
        toolCall: { id: string; function: { name: string; arguments: string } },
        message: unknown,
      ) => Promise<StepResult>;
      chatId: string;
      message: unknown;
      tools: ToolInfo[];
    },
  ): Promise<ExecutionLog> {
    if (executionLog._replanAttempt) {
      console.warn('[Planner] 🛑 Replan already attempted, aborting to prevent infinite loop.');
      return { ...executionLog, replanFailed: true } as ExecutionLog;
    }
    executionLog._replanAttempt = true;

    console.log('[Planner] 🔄 Replanification...');

    const detailedToolsList = (context.tools || []).map(formatToolForPlanner).join('\n');

    const detailedStepsLog = originalPlan.steps
      .map((s: PlanStep) => {
        const result = executionLog.results[s.id];
        if (!result) return `- Step ${s.id} (${s.action}): Not executed`;

        const status = executionLog.completed.includes(s.id) ? 'SUCCESS' : 'FAILED';
        let outputStr = '';

        if (result.error) {
          outputStr = `Error: ${result.message || JSON.stringify(result)}`;
        } else if (result.llmOutput) {
          const out = result.llmOutput;
          outputStr = typeof out === 'string' ? out : JSON.stringify(out);
        } else {
          outputStr = JSON.stringify(result);
        }

        if (outputStr.length > 3000) {
          outputStr = outputStr.substring(0, 3000) + '\n... [TRUNCATED]';
        }

        return `### Step ${s.id} (${s.action}) - ${status}
- Tool: ${s.tool}
- Params: ${JSON.stringify(s.params)}
- Output/Error: ${outputStr}`;
      })
      .join('\n\n');

    const toolListStr = detailedToolsList || 'No tool list provided';

    const replanPrompt = `<role>
You are HIVE-MIND's adaptive PLANNER recovering from an execution failure.
Your mission is to analyze the execution history, identify the root cause of the failure, and formulate a new, viable plan to achieve the goal.
</role>

<context>
Original Goal:
"${originalPlan.goal}"

Execution Status:
- Completed Steps: ${executionLog.completed.join(', ') || 'none'}
- Failed Steps: ${executionLog.failed.join(', ')}
</context>

<execution_history_details>
${detailedStepsLog}
</execution_history_details>

<available_tools>
${toolListStr}
</available_tools>

<replanning_instructions>
Formulate your new plan using these guidelines:
1. FAILURE ANALYSIS: Analyze why the previous steps failed. Formulate an alternate strategy that circumvents the error.
2. DECOMPOSE THE REMAINING TASK: Split complex remaining operations into separate steps.
3. MATCH TOOLS ACCURATELY: Choose tool names exclusively from the list of available tools.
4. CHOOSE THE RIGHT TOOL:
    - Use \`execute_bash_command\` for terminal actions, running Node scripts, and creating files in the filesystem.
    - Reserve \`code_execution\` only for lightweight orchestration of multiple existing HIVE tools.
    - INLINE CODE RESTRICTIONS: Bash commands like \`node -e "..."\` are strictly FORBIDDEN.
    - ES MODULES COMPATIBILITY: Any script file using CommonJS \`require()\` MUST have the \`.cjs\` extension.
5. DEFINE COMPLETE PARAMETERS: For every step, provide all required properties for the chosen tool.
6. PASS DATA SEQUENTIALLY: Reuse outputs from previous steps using "{{step_X_propertyName}}".
7. DRAFT CONCISE QUERIES: When using search tools, write a short, concise search query (maximum 15 words).
</replanning_instructions>

<output_format>
Your response must consist of two parts:
1. A brief "Thinking" section explaining why the previous run failed and how you are adjusting the plan.
2. A "Plan JSON" block containing the corrected structured plan, wrapped in markdown triple backticks.
</output_format>

New plan:`;

    let attempts = 0;
    const maxAttempts = 3;
    let newPlan: Plan | null = null;
    const chatHistory: ChatMessage[] = [
      { role: 'system', content: "Tu es un planificateur expert en récupération d'échecs." },
      { role: 'user', content: replanPrompt },
    ];

    while (attempts < maxAttempts) {
      attempts++;
      let response: { content: string | null } | null = null;
      try {
        response = await providerRouter.chat(chatHistory, { temperature: 0.5 });
        if (!response?.content) {
          throw new Error('AI response for replan is empty');
        }

        newPlan = await this._parsePlanJson(response.content);
        if (!newPlan) {
          throw new Error('Impossible de parser le nouveau plan JSON après replanification');
        }

        const validToolNames = new Set(
          (context.tools || []).map((t: ToolInfo) => t.function?.name || t.name),
        );
        const invalidSteps = (newPlan.steps || []).filter(
          (s: PlanStep) => s.tool && !validToolNames.has(s.tool),
        );
        if (invalidSteps.length > 0) {
          console.warn(
            `[Planner] ⚠️ Replan contains ${invalidSteps.length} invalid tool(s): ${invalidSteps.map((s: PlanStep) => s.tool).join(', ')}. Filtering out.`,
          );
          newPlan.steps = (newPlan.steps || []).filter(
            (s: PlanStep) => !s.tool || validToolNames.has(s.tool),
          );
        }

        if (!newPlan.steps || newPlan.steps.length === 0) {
          throw new Error('Replan produced no valid steps');
        }

        break;
      } catch (err: unknown) {
        const errMsg = extractErrorMessage(err);
        console.warn(`[Planner] ⚠️ Tentative replan ${attempts}/${maxAttempts} échouée: ${errMsg}`);
        if (attempts >= maxAttempts) {
          console.error('[Planner] Erreur replanification:', errMsg);
          return {
            ...executionLog,
            replanFailed: true,
          };
        }
        chatHistory.push({
          role: 'assistant',
          content: response?.content || 'Plan malformé ou incomplet',
        });
        chatHistory.push({
          role: 'user',
          content: `ERREUR DE PLANIFICATION: ${errMsg}\n\nVeuillez corriger le plan et me renvoyer uniquement le JSON valide.`,
        });
      }
    }

    console.log('[Planner] ✅ Nouveau plan créé, réexécution...');

    return await this.execute(
      { ...originalPlan, steps: newPlan!.steps } as PlanResult,
      context,
      executionLog,
    );
  }
}

export const planner = new ExplicitPlanner();
export default planner;
