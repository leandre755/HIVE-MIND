// plugins/base/dev_tools/ASTTools.ts
// ============================================================================
// AST-NATIVE TOOLS — Tree-sitter powered code intelligence for the LLM
//
// WHY: These tools are 80-95% more token-efficient than raw file reading.
// Instead of sending 500 lines of code for a single function edit, we can:
// - get_file_skeleton: Show only signatures (~20 lines vs 500)
// - get_function: Extract just the target function (~30 lines vs 500)
// - find_symbol_references: Locate all usages without grep ambiguity
//
// These tools are the second pillar of the Dirac harness methodology.
// ============================================================================

import {
  safeExistsSync,
  safeStatSync,
  safeReaddirSync,
  safeReadFileSync,
  resolveWithinRoot,
} from '../../../utils/safeFs.js';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { permissionManager } from '../../../core/security/PermissionManager.js';
import {
  getFileSkeleton,
  getFunction,
  findSymbolReferences,
  LANGUAGE_MAP,
} from '../../../services/ast/index.js';
import { hashLines } from '../../../services/anchor/index.js';

const execFileAsync = promisify(execFile);

// --- Type helpers ---

interface ToolContext {
  chatId?: string;
  sourceChannel?: string;
  message?: { sender?: string };
}

interface SkeletonArgs {
  paths?: string[];
}

interface FunctionArgs {
  file_path?: string;
  function_name?: string;
}

interface ReferenceArgs {
  symbol_name?: string;
  search_paths?: string[];
  find_type?: 'definition' | 'reference' | 'both';
}

interface SymbolReference {
  filePath: string;
  line: number;
  lineText: string;
  isDefinition: boolean;
}

interface FunctionResult {
  startLine: number;
  endLine: number;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// --- Helper functions to reduce complexity ---

async function resolveFilePaths(searchPaths: string[]): Promise<string[]> {
  const filePaths: string[] = [];
  for (const searchPath of searchPaths) {
    const absolutePath = resolveWithinRoot(
      permissionManager.sandboxDir,
      searchPath,
      permissionManager.sandboxDir,
    );

    if (safeExistsSync(absolutePath) && safeStatSync(absolutePath).isDirectory()) {
      await expandDirectory(absolutePath, filePaths);
    } else if (safeExistsSync(absolutePath)) {
      filePaths.push(absolutePath);
    }
  }
  return filePaths;
}

async function expandDirectory(dirPath: string, filePaths: string[]): Promise<void> {
  try {
    const findArgs = [dirPath, '-maxdepth', '3', '-type', 'f', '('];
    const extensions = Object.keys(LANGUAGE_MAP);
    extensions.forEach((ext, index) => {
      if (index > 0) findArgs.push('-o');
      findArgs.push('-name', `*.${ext}`);
    });
    findArgs.push(')');

    const { stdout } = await execFileAsync('find', findArgs, { timeout: 5000 });
    const results = stdout.split('\n').filter(Boolean);
    filePaths.push(...results.slice(0, 100));
  } catch {
    const entries = safeReaddirSync(dirPath);
    for (const entry of entries) {
      const fullPath = resolveWithinRoot(dirPath, entry);
      const ext = path.extname(entry).toLowerCase().slice(1);
      if (Reflect.get(LANGUAGE_MAP, ext) && safeStatSync(fullPath).isFile()) {
        filePaths.push(fullPath);
      }
    }
  }
}

function formatReferenceOutput(symbolName: string, references: SymbolReference[]): string {
  const byFile = new Map<string, SymbolReference[]>();
  for (const ref of references) {
    const existing = byFile.get(ref.filePath) || [];
    existing.push(ref);
    byFile.set(ref.filePath, existing);
  }

  let output = `Symbol "${symbolName}" — ${references.length} occurrence(s) in ${byFile.size} file(s):\n\n`;
  for (const [filePath, refs] of byFile) {
    const relPath = path.relative(permissionManager.sandboxDir, filePath);
    output += `--- ${relPath} ---\n`;
    for (const ref of refs) {
      const tag = ref.isDefinition ? '[DEF]' : '[REF]';
      output += `  ${tag} L${ref.line + 1}: ${ref.lineText.trim()}\n`;
    }
    output += '\n';
  }
  return output.trim();
}

function resolveExt(filePath: string): string {
  return path.extname(filePath).toLowerCase().slice(1);
}

function resolveAbsolute(file_path: string): string {
  const absolute = resolveWithinRoot(process.cwd(), file_path, permissionManager.sandboxDir);

  if (!permissionManager.isInSandbox(absolute)) {
    throw new Error(`Access denied: path "${file_path}" is outside authorized sandbox.`);
  }
  return absolute;
}

async function handleGetSkeleton(
  args: SkeletonArgs,
): Promise<{ success: boolean; message: string }> {
  const paths: string[] = args.paths || [];
  if (paths.length === 0) {
    return { success: false, message: 'Parameter "paths" required (array of file paths).' };
  }

  const results: string[] = [];
  for (const filePath of paths) {
    const absolutePath = resolveAbsolute(filePath);
    if (!safeExistsSync(absolutePath)) {
      results.push(`--- ${filePath} ---\nError: File does not exist.`);
      continue;
    }

    const ext = resolveExt(absolutePath);
    if (!Reflect.get(LANGUAGE_MAP, ext)) {
      results.push(
        `--- ${filePath} ---\nUnsupported language: .${ext}. Supported: ${Object.keys(LANGUAGE_MAP).join(', ')}`,
      );
      continue;
    }

    try {
      const skeleton = await getFileSkeleton(absolutePath);
      if (skeleton) {
        results.push(`--- ${filePath} ---\n${skeleton}`);
      } else {
        results.push(`--- ${filePath} ---\nNo definitions found.`);
      }
    } catch (error: unknown) {
      results.push(`--- ${filePath} ---\nAST Error: ${extractErrorMessage(error)}`);
    }
  }

  return { success: true, message: results.join('\n\n') };
}

async function handleGetFunction(
  args: FunctionArgs,
): Promise<{ success: boolean; message: string }> {
  const { file_path, function_name } = args;
  if (!file_path || !function_name) {
    return { success: false, message: 'Parameters "file_path" and "function_name" required.' };
  }

  const absolutePath = resolveAbsolute(file_path);
  if (!safeExistsSync(absolutePath)) {
    return { success: false, message: `File does not exist: ${file_path}` };
  }

  const ext = resolveExt(absolutePath);
  if (!Reflect.get(LANGUAGE_MAP, ext)) {
    return {
      success: false,
      message: `Unsupported language: .${ext}. Supported: ${Object.keys(LANGUAGE_MAP).join(', ')}`,
    };
  }

  try {
    const result: FunctionResult | null = await getFunction(absolutePath, function_name);
    if (!result) {
      return {
        success: false,
        message: `Function "${function_name}" not found in ${file_path}. Use get_file_skeleton to see available symbols.`,
      };
    }

    const fullContent = safeReadFileSync(absolutePath, 'utf8');
    const hashedContent = hashLines(absolutePath, fullContent);
    const hashedLines = hashedContent.split('\n');
    const relevantLines = hashedLines.slice(result.startLine, result.endLine + 1);

    return {
      success: true,
      message: `Function "${function_name}" (lines ${result.startLine + 1}-${result.endLine + 1}):\n${relevantLines.join('\n')}`,
    };
  } catch (error: unknown) {
    return { success: false, message: `AST Error: ${extractErrorMessage(error)}` };
  }
}

async function handleFindReferences(
  args: ReferenceArgs,
): Promise<{ success: boolean; message: string }> {
  const { symbol_name, search_paths, find_type = 'both' } = args;
  if (!symbol_name || !search_paths?.length) {
    return { success: false, message: 'Parameters "symbol_name" and "search_paths" required.' };
  }

  const filePaths = await resolveFilePaths(search_paths);
  if (filePaths.length === 0) {
    return { success: false, message: 'No supported files found in specified paths.' };
  }

  try {
    const references = await findSymbolReferences(filePaths, symbol_name, find_type);

    if (references.length === 0) {
      let typeLabel = 'occurrence';
      if (find_type === 'definition') typeLabel = 'definition';
      else if (find_type === 'reference') typeLabel = 'reference';

      return {
        success: true,
        message: `No ${typeLabel} found for "${symbol_name}" in ${filePaths.length} file(s).`,
      };
    }

    const output = formatReferenceOutput(symbol_name, references);
    return { success: true, message: output };
  } catch (error: unknown) {
    return { success: false, message: `AST Error: ${extractErrorMessage(error)}` };
  }
}

export default {
  name: 'dev_tools_ast',
  description:
    'AST tools for structural code intelligence (skeleton, function extraction, references).',
  version: '1.0.0',
  enabled: true,

  toolDefinitions: [
    {
      type: 'function',
      function: {
        name: 'get_file_skeleton',
        description:
          "Extracts the structure of a source file (function signatures, classes, methods, interfaces) WITHOUT implementation bodies. Returns a compact skeleton ~80-95% smaller than the full file. Use this tool BEFORE read_file to understand a file's structure. Supports: TypeScript, JavaScript, Python.",
        parameters: {
          type: 'object',
          properties: {
            paths: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of file paths (relative or absolute).',
            },
          },
          required: ['paths'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_function',
        description:
          'Extracts the complete code of a specific function or method by its name. Supports "Class.method" notation for class methods. Returns ONLY the targeted function\'s code with its hash-stable anchors. ~90% more efficient than read_file for a specific target.',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Source file path.',
            },
            function_name: {
              type: 'string',
              description: 'Name of the function/method. Use "Class.method" for class methods.',
            },
          },
          required: ['file_path', 'function_name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'find_symbol_references',
        description:
          'Finds all AST references of a symbol (function, class, variable) across a set of files. More accurate than grep as it uses AST (no false positives in comments or strings). Returns definitions and/or usages.',
        parameters: {
          type: 'object',
          properties: {
            symbol_name: {
              type: 'string',
              description: 'Name of the symbol to search for.',
            },
            search_paths: {
              type: 'array',
              items: { type: 'string' },
              description: 'Files or directories to search in.',
            },
            find_type: {
              type: 'string',
              enum: ['definition', 'reference', 'both'],
              description:
                'Result type: "definition" (declarations), "reference" (usages), or "both" (all). Default: "both".',
            },
          },
          required: ['symbol_name', 'search_paths'],
        },
      },
    },
  ],

  async execute(args: Record<string, unknown>, _context: ToolContext, toolName: string) {
    try {
      switch (toolName) {
        case 'get_file_skeleton':
          return await handleGetSkeleton(args as unknown as SkeletonArgs);
        case 'get_function':
          return await handleGetFunction(args as unknown as FunctionArgs);
        case 'find_symbol_references':
          return await handleFindReferences(args as unknown as ReferenceArgs);
        default:
          return null;
      }
    } catch (error: unknown) {
      return { success: false, message: `Error in ${toolName}: ${extractErrorMessage(error)}` };
    }
  },
};
