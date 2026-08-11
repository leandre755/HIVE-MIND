/**
 * SafeScriptValidator — Validation statique + Auto-Repair du code LLM
 *
 * WHY: Les LLM peuvent générer du JS avec des erreurs de syntaxe, des variables
 * non définies, ou des appels à des fonctions inexistantes. Ce validateur attrape
 * ces erreurs AVANT l'exécution dans le sandbox VM, et tente de les réparer
 * automatiquement quand c'est possible.
 *
 * ARCHITECTURE (3 couches — seules les couches 1 et 3 sont ici) :
 *   Layer 1 : Analyse AST (acorn) — syntaxe + scope + sécurité
 *   Layer 2 : Proxy runtime (dans ProgrammaticExecutor) — gardes pendant l'exécution
 *   Layer 3 : Auto-Repair — correction des erreurs de syntaxe courantes
 */

import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface ValidationError {
  readonly type: 'SYNTAX' | 'UNDEFINED_VAR' | 'UNKNOWN_TOOL' | 'UNSAFE_CONSTRUCT';
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  readonly autoFixable: boolean;
}

export interface ValidationWarning {
  readonly type: 'INFINITE_LOOP' | 'MISSING_AWAIT' | 'MISSING_RETURN';
  readonly message: string;
}

export interface ValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationWarning[];
}

export interface RepairResult {
  readonly success: boolean;
  readonly repairedCode: string | null;
  readonly appliedFixes: readonly string[];
}

// Types pour les nœuds AST acorn
interface AcornIdentifierNode {
  readonly type: 'Identifier';
  readonly name: string;
}

interface AcornObjectPatternNode {
  readonly type: 'ObjectPattern';
  readonly properties: readonly AcornPropertyNode[];
}

interface AcornArrayPatternNode {
  readonly type: 'ArrayPattern';
  readonly elements: readonly (AcornIdentifierNode | null)[];
}

interface AcornPropertyNode {
  readonly type: string;
  readonly key: AcornIdentifierNode;
  readonly value: AcornIdentifierNode;
  readonly computed: boolean;
}

interface AcornVariableDeclaratorNode {
  readonly type: 'VariableDeclarator';
  readonly id: AcornIdentifierNode | AcornObjectPatternNode | AcornArrayPatternNode;
}

interface AcornVariableDeclarationNode {
  readonly type: 'VariableDeclaration';
  readonly declarations: readonly AcornVariableDeclaratorNode[];
}

interface AcornBaseNode {
  readonly type: string;
}

interface AcornFunctionDeclarationNode extends AcornBaseNode {
  readonly type: 'FunctionDeclaration';
  readonly id: AcornIdentifierNode | null;
  readonly params: readonly AcornIdentifierNode[];
}

interface AcornArrowFunctionNode extends AcornBaseNode {
  readonly type: 'ArrowFunctionExpression';
  readonly params: readonly AcornIdentifierNode[];
}

interface AcornCatchClauseNode extends AcornBaseNode {
  readonly type: 'CatchClause';
  readonly param: AcornIdentifierNode | null;
}

interface AcornForInStatementNode extends AcornBaseNode {
  readonly type: 'ForInStatement';
  readonly left: AcornVariableDeclarationNode | AcornIdentifierNode;
}

interface AcornForOfStatementNode extends AcornBaseNode {
  readonly type: 'ForOfStatement';
  readonly left: AcornVariableDeclarationNode | AcornIdentifierNode;
}

interface AcornCallExpressionNode extends AcornBaseNode {
  readonly type: 'CallExpression';
  readonly callee: AcornIdentifierNode | AcornMemberExpressionNode;
}

interface AcornMemberExpressionNode extends AcornBaseNode {
  readonly type: 'MemberExpression';
  readonly object: AcornBaseNode;
  readonly property: AcornIdentifierNode;
  readonly computed: boolean;
}

interface AcornWhileStatementNode extends AcornBaseNode {
  readonly type: 'WhileStatement';
  readonly test: AcornLiteralNode;
}

interface AcornForStatementNode extends AcornBaseNode {
  readonly type: 'ForStatement';
  readonly test: AcornBaseNode | null;
}

interface AcornLiteralNode extends AcornBaseNode {
  readonly type: 'Literal';
  readonly value: boolean | string | number | null;
}

type _AcornWalkNode =
  | AcornVariableDeclaratorNode
  | AcornFunctionDeclarationNode
  | AcornArrowFunctionNode
  | AcornCatchClauseNode
  | AcornForInStatementNode
  | AcornForOfStatementNode
  | AcornCallExpressionNode
  | AcornMemberExpressionNode
  | AcornWhileStatementNode
  | AcornForStatementNode
  | AcornIdentifierNode;

interface AcornSyntaxError {
  readonly message: string;
  readonly loc?: {
    readonly line: number;
    readonly column: number;
  };
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

// Globales JS toujours disponibles dans le sandbox
const JS_BUILTINS = new Set([
  'console',
  'JSON',
  'Array',
  'Object',
  'Math',
  'Date',
  'Error',
  'Map',
  'Set',
  'Promise',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'String',
  'Number',
  'Boolean',
  'RegExp',
  'setTimeout',
  'undefined',
  'null',
  'true',
  'false',
  'Infinity',
  'NaN',
  'encodeURIComponent',
  'decodeURIComponent',
  'encodeURI',
  'decodeURI',
]);

// Helpers défensifs injectés par SandboxHelpers.ts
const SANDBOX_HELPERS = new Set([
  'toArray',
  'safeGet',
  'safeMap',
  'safeFilter',
  'first',
  'len',
  'isSuccess',
  'extractData',
  'extractText',
  'getCommandOutput',
]);

// Constructions JS dangereuses interdites dans le sandbox
const UNSAFE_FUNCTIONS = new Set([
  'eval',
  'Function',
  'require',
  'import',
  'process',
  'globalThis',
  '__proto__',
  'constructor',
]);

// ─────────────────────────────────────────────────────────────
// LAYER 1 : STATIC VALIDATOR (AST Analysis)
// ─────────────────────────────────────────────────────────────

/**
 * Valide le code JS généré par le LLM avant exécution.
 *
 * @param code — Code brut du LLM
 * @param availableTools — Noms des outils injectés dans le sandbox
 * @returns Résultat de validation avec erreurs et warnings
 */
function _handleObjectPattern(node: AcornObjectPatternNode, declaredVars: Set<string>): void {
  for (const prop of node.properties || []) {
    if (prop.type === 'Property') {
      if (prop.value?.type === 'Identifier') declaredVars.add(prop.value.name);
      else if (prop.key?.type === 'Identifier') declaredVars.add(prop.key.name);
    }
  }
}

function _handleArrayPattern(node: AcornArrayPatternNode, declaredVars: Set<string>): void {
  for (const el of node.elements || []) {
    if (el?.type === 'Identifier') declaredVars.add(el.name);
  }
}

function _handleVarDeclarator(node: AcornVariableDeclaratorNode, declaredVars: Set<string>): void {
  if (node.id?.type === 'Identifier') {
    declaredVars.add(node.id.name);
  } else if (node.id?.type === 'ObjectPattern') {
    _handleObjectPattern(node.id as AcornObjectPatternNode, declaredVars);
  } else if (node.id?.type === 'ArrayPattern') {
    _handleArrayPattern(node.id as AcornArrayPatternNode, declaredVars);
  }
}

function _collectASTNodes(ast: acorn.Node) {
  const declaredVars = new Set<string>();
  const usedIdentifiers = new Set<string>();
  const calledFunctions = new Set<string>();
  const functionParams = new Set<string>();

  walk.simple(ast, {
    VariableDeclarator(node) {
      _handleVarDeclarator(node as unknown as AcornVariableDeclaratorNode, declaredVars);
    },
    FunctionDeclaration(node) {
      if (node.id?.name) declaredVars.add(node.id.name);
      for (const param of node.params || []) {
        if (param.type === 'Identifier') functionParams.add(param.name);
      }
    },
    ArrowFunctionExpression(node) {
      for (const param of node.params || []) {
        if (param.type === 'Identifier') functionParams.add(param.name);
      }
    },
    CatchClause(node) {
      if (node.param?.type === 'Identifier') declaredVars.add(node.param.name);
    },
    ForInStatement(node) {
      if (node.left?.type === 'VariableDeclaration') {
        for (const decl of node.left.declarations || []) {
          if (decl.id?.type === 'Identifier') declaredVars.add(decl.id.name);
        }
      }
    },
    ForOfStatement(node) {
      if (node.left?.type === 'VariableDeclaration') {
        for (const decl of node.left.declarations || []) {
          if (decl.id?.type === 'Identifier') declaredVars.add(decl.id.name);
        }
      }
    },
  });

  walk.ancestor(ast, {
    Identifier(node, _state, ancestors) {
      const parent = ancestors.at(ancestors.length - 2);
      if (!parent) return;

      if (
        parent.type === 'VariableDeclarator' &&
        (parent as AcornVariableDeclaratorNode).id === node
      )
        return;
      if (
        parent.type === 'MemberExpression' &&
        (parent as AcornMemberExpressionNode).property === node &&
        !(parent as AcornMemberExpressionNode).computed
      )
        return;
      if (
        parent.type === 'Property' &&
        (parent as AcornPropertyNode).key === node &&
        !(parent as AcornPropertyNode).computed
      )
        return;
      if (parent.type === 'LabeledStatement') return;

      usedIdentifiers.add(node.name);
    },
    CallExpression(node) {
      if (node.callee?.type === 'Identifier') {
        calledFunctions.add(node.callee.name);
      }
    },
  });

  return { declaredVars, usedIdentifiers, calledFunctions, functionParams };
}

function _checkUndefinedVars(
  usedIdentifiers: Set<string>,
  declaredVars: Set<string>,
  functionParams: Set<string>,
  allowedGlobals: Set<string>,
  errors: ValidationError[],
): void {
  for (const name of usedIdentifiers) {
    if (!declaredVars.has(name) && !functionParams.has(name) && !allowedGlobals.has(name)) {
      errors.push({
        type: 'UNDEFINED_VAR',
        message: `Variable "${name}" utilisée mais jamais déclarée. Déclarez-la avec const/let ou vérifiez le nom.`,
        autoFixable: false,
      });
    }
  }
}

function _checkUnknownTools(
  calledFunctions: Set<string>,
  availableTools: readonly string[],
  declaredVars: Set<string>,
  functionParams: Set<string>,
  errors: ValidationError[],
): void {
  for (const fnName of calledFunctions) {
    if (
      !availableTools.includes(fnName) &&
      !SANDBOX_HELPERS.has(fnName) &&
      !JS_BUILTINS.has(fnName) &&
      !declaredVars.has(fnName) &&
      !functionParams.has(fnName)
    ) {
      const suggestion = findClosestTool(fnName, availableTools);
      const hint = suggestion
        ? ` Vouliez-vous dire "${suggestion}" ?`
        : ` Outils disponibles : ${availableTools.join(', ')}`;
      errors.push({
        type: 'UNKNOWN_TOOL',
        message: `Fonction "${fnName}" n'existe pas.${hint}`,
        autoFixable: false,
      });
    }
  }
}

function _checkUnsafeConstructs(ast: acorn.Node, errors: ValidationError[]): void {
  walk.simple(ast, {
    CallExpression(node) {
      const calleeName =
        (node.callee as AcornIdentifierNode)?.name ||
        (node.callee as AcornMemberExpressionNode)?.property?.name;
      if (calleeName && UNSAFE_FUNCTIONS.has(calleeName)) {
        errors.push({
          type: 'UNSAFE_CONSTRUCT',
          message: `"${calleeName}()" est interdit dans le sandbox.`,
          autoFixable: false,
        });
      }
    },
    MemberExpression(node) {
      if (
        node.property?.type === 'Identifier' &&
        (node.property.name === '__proto__' || node.property.name === 'constructor')
      ) {
        errors.push({
          type: 'UNSAFE_CONSTRUCT',
          message: `Accès à "${node.property.name}" est interdit (prototype pollution).`,
          autoFixable: false,
        });
      }
    },
  });
}

export function validateCode(code: string, availableTools: readonly string[]): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const allowedGlobals = new Set([...JS_BUILTINS, ...SANDBOX_HELPERS, ...availableTools, 'HIVE']);

  let ast: acorn.Node;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 2022,
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    });
  } catch (parseErr: unknown) {
    const syntaxErr = parseErr as AcornSyntaxError;
    errors.push({
      type: 'SYNTAX',
      message: extractErrorMessage(parseErr),
      line: syntaxErr.loc?.line,
      column: syntaxErr.loc?.column,
      autoFixable: true,
    });
    return { isValid: false, errors, warnings };
  }

  const { declaredVars, usedIdentifiers, calledFunctions, functionParams } = _collectASTNodes(ast);

  _checkUndefinedVars(usedIdentifiers, declaredVars, functionParams, allowedGlobals, errors);
  _checkUnknownTools(calledFunctions, availableTools, declaredVars, functionParams, errors);
  _checkUnsafeConstructs(ast, errors);

  walk.simple(ast, {
    WhileStatement(node) {
      if (node.test?.type === 'Literal' && node.test.value === true) {
        warnings.push({
          type: 'INFINITE_LOOP',
          message: 'while(true) détecté — risque de boucle infinie.',
        });
      }
    },
    ForStatement(node) {
      if (!node.test) {
        warnings.push({
          type: 'INFINITE_LOOP',
          message: 'for(;;) détecté — risque de boucle infinie.',
        });
      }
    },
  });

  const hasReturn = code.includes('return ');
  if (!hasReturn && calledFunctions.size > 0) {
    warnings.push({
      type: 'MISSING_RETURN',
      message: 'Le code ne contient pas de `return`. Le résultat pourrait être undefined.',
    });
  }

  return { isValid: errors.length === 0, errors, warnings };
}

// ─────────────────────────────────────────────────────────────
// LAYER 3 : AUTO-REPAIR
// ─────────────────────────────────────────────────────────────

/**
 * Tente de réparer automatiquement les erreurs de syntaxe courantes.
 * Ne modifie JAMAIS la logique — uniquement la syntaxe.
 *
 * @param code — Code original avec erreurs
 * @param errors — Erreurs détectées par validateCode
 * @returns Code réparé si possible, null sinon
 */
function _repairSyntaxDelimiters(repaired: string, appliedFixes: string[], msg: string): string {
  let result = repaired;
  if (msg.includes('unexpected end of input') || msg.includes('unexpected token')) {
    const parenDiff = countChar(result, '(') - countChar(result, ')');
    if (parenDiff > 0) {
      result += ')'.repeat(parenDiff);
      appliedFixes.push(`Ajouté ${parenDiff} parenthèse(s) fermante(s)`);
    }

    const braceDiff = countChar(result, '{') - countChar(result, '}');
    if (braceDiff > 0) {
      result += '}'.repeat(braceDiff);
      appliedFixes.push(`Ajouté ${braceDiff} accolade(s) fermante(s)`);
    }

    const bracketDiff = countChar(result, '[') - countChar(result, ']');
    if (bracketDiff > 0) {
      result += ']'.repeat(bracketDiff);
      appliedFixes.push(`Ajouté ${bracketDiff} crochet(s) fermant(s)`);
    }
  }
  return result;
}

function _repairUnterminatedLiterals(
  repaired: string,
  appliedFixes: string[],
  msg: string,
): string {
  let result = repaired;
  if (msg.includes('unterminated template')) {
    const backtickCount = countChar(result, '`');
    if (backtickCount % 2 !== 0) {
      result += '`';
      appliedFixes.push('Fermé template literal (backtick manquant)');
    }
  }

  if (msg.includes('unterminated string')) {
    const singleQuotes = (result.match(/(?<!\\)'/g) || []).length;
    if (singleQuotes % 2 !== 0) {
      result += "'";
      appliedFixes.push('Fermé string (guillemet simple manquant)');
    }
    const doubleQuotes = (result.match(/(?<!\\)"/g) || []).length;
    if (doubleQuotes % 2 !== 0) {
      result += '"';
      appliedFixes.push('Fermé string (guillemet double manquant)');
    }
  }
  return result;
}

export function autoRepairCode(code: string, errors: readonly ValidationError[]): RepairResult {
  let repaired = code;
  const appliedFixes: string[] = [];

  for (const error of errors) {
    if (!error.autoFixable) continue;

    const msg = error.message.toLowerCase();
    repaired = _repairSyntaxDelimiters(repaired, appliedFixes, msg);

    if (msg.includes('unexpected identifier') && error.line && error.line > 1) {
      const lines = repaired.split('\n');
      const prevLine = lines.at(error.line - 2)?.trim();
      if (
        prevLine &&
        !prevLine.endsWith(';') &&
        !prevLine.endsWith('{') &&
        !prevLine.endsWith(',')
      ) {
        lines[error.line - 2] = lines[error.line - 2].trimEnd() + ';';
        repaired = lines.join('\n');
        appliedFixes.push(`Ajouté ";" à la fin de la ligne ${error.line - 1}`);
      }
    }

    repaired = _repairUnterminatedLiterals(repaired, appliedFixes, msg);
  }

  const hasNonFixable = errors.some((e) => !e.autoFixable);
  if (!hasNonFixable) {
    const awaitPattern = /(\b(?:const|let|var)\s+\w+\s*=\s*)(?!await\s)(\w+\s*\()/g;
    const withAwait = repaired.replace(awaitPattern, '$1await $2');
    if (withAwait !== repaired) {
      repaired = withAwait;
      appliedFixes.push('Ajouté "await" manquant sur les appels d\'outils');
    }
  }

  if (appliedFixes.length === 0) {
    return { success: false, repairedCode: null, appliedFixes: [] };
  }

  try {
    acorn.parse(repaired, {
      ecmaVersion: 2022,
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    });
    console.log(`[SafeScript] 🔧 Auto-repair réussi: ${appliedFixes.join(', ')}`);
    return { success: true, repairedCode: repaired, appliedFixes };
  } catch {
    console.warn(`[SafeScript] 🔧 Auto-repair tenté mais échoué: ${appliedFixes.join(', ')}`);
    return { success: false, repairedCode: null, appliedFixes };
  }
}

// ─────────────────────────────────────────────────────────────
// TOOL CALL COUNTING (Anti-gaspillage)
// ─────────────────────────────────────────────────────────────

/**
 * Compte le nombre d'appels uniques à des outils dans le code.
 * Utilisé pour rejeter le PTC quand le LLM n'appelle qu'un seul outil
 * (dans ce cas, le Tool Calling natif est plus rapide).
 *
 * @param code — Code JS à analyser
 * @param availableTools — Noms des outils disponibles
 * @returns Nombre d'appels d'outils distincts (pas les helpers JS)
 */
export function countToolCalls(code: string, availableTools: readonly string[]): number {
  const toolSet = new Set(availableTools);
  let count = 0;

  try {
    const ast = acorn.parse(code, {
      ecmaVersion: 2022,
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    });

    walk.simple(ast, {
      CallExpression(node) {
        const name = node.callee?.type === 'Identifier' ? node.callee.name : null;
        if (name && toolSet.has(name)) {
          count++;
        }
      },
    });
  } catch {
    return 999;
  }

  return count;
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function countChar(str: string, char: string): number {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (str.charAt(i) === char) count++;
  }
  return count;
}

function findClosestTool(input: string, tools: readonly string[]): string | null {
  const inputLower = input.toLowerCase();
  let bestMatch: string | null = null;
  let bestDistance = Infinity;

  for (const tool of tools) {
    const d = levenshtein(inputLower, tool.toLowerCase());
    if (d < bestDistance && d <= Math.max(3, Math.floor(tool.length * 0.4))) {
      bestDistance = d;
      bestMatch = tool;
    }
  }

  return bestMatch;
}

function _computeLevRow(
  i: number,
  n: number,
  a: string,
  b: string,
  rowI: number[],
  rowPrev: number[],
): void {
  for (let j = 1; j <= n; j++) {
    const val =
      a.charAt(i - 1) === b.charAt(j - 1)
        ? (rowPrev.at(j - 1) ?? 0)
        : 1 + Math.min(rowPrev.at(j) ?? 0, rowI.at(j - 1) ?? 0, rowPrev.at(j - 1) ?? 0);
    Reflect.set(rowI, j, val);
  }
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) {
    const row = dp.at(i);
    if (row) Reflect.set(row, 0, i);
  }
  const firstRow = dp.at(0);
  for (let j = 0; j <= n; j++) {
    if (firstRow) Reflect.set(firstRow, j, j);
  }
  for (let i = 1; i <= m; i++) {
    const rowI = dp.at(i);
    const rowPrev = dp.at(i - 1);
    if (rowI && rowPrev) {
      _computeLevRow(i, n, a, b, rowI, rowPrev);
    }
  }
  const lastRow = dp.at(m);
  return lastRow?.at(n) ?? 0;
}
