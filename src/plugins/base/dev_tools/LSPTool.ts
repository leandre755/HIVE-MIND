import path from 'path';
import { safeExistsSync, safeStatSync, safeReaddirSync, safePath } from '../../../utils/safeFs.js';
import { permissionManager } from '../../../core/security/PermissionManager.js';
import {
  parseDefinitions,
  findSymbolReferences,
  getFunction,
} from '../../../services/ast/index.js';

// --- Type helpers ---

interface ToolContext {
  chatId?: string;
  sourceChannel?: string;
  message?: { sender?: string };
}

interface LspQueryArgs {
  operation?: string;
  file_path?: string;
  symbol_name?: string;
  search_paths?: string[];
}

interface LspSymbolDef {
  name: string;
  kind: string;
  parent?: string;
  startLine: number;
  endLine: number;
  signatureLine: string;
}

interface LspSymbolRef {
  filePath: string;
  line: number;
  lineText: string;
}

interface LspFuncDetails {
  content: string;
  startLine: number;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function scanDirectoryFiles(targetPath: string): string[] {
  if (!safeExistsSync(targetPath)) return [];
  if (!safeStatSync(targetPath).isDirectory()) return [targetPath];

  const files: string[] = [];
  const entries = safeReaddirSync(targetPath);
  for (const entry of entries) {
    const ext = path.extname(entry).slice(1).toLowerCase();
    if (['ts', 'js', 'tsx', 'py'].includes(ext)) {
      files.push(safePath(`${targetPath}${path.sep}${entry}`));
    }
  }
  return files;
}

function resolveSearchFiles(searchPaths: string[] | undefined, absolutePath: string): string[] {
  const targetPaths =
    searchPaths && searchPaths.length > 0
      ? searchPaths.map((p: string) =>
          path.isAbsolute(p)
            ? safePath(p)
            : safePath(`${permissionManager.sandboxDir}${path.sep}${p}`),
        )
      : [path.dirname(absolutePath)];

  const filesToScan = targetPaths.flatMap(scanDirectoryFiles);

  if (filesToScan.length === 0) {
    filesToScan.push(absolutePath);
  }
  return filesToScan;
}

async function handleDocumentSymbol(absolutePath: string, file_path: string) {
  const definitions = await parseDefinitions(absolutePath);
  if (!definitions || definitions.length === 0) {
    return { success: true, message: `No document symbols found in ${file_path}.` };
  }

  const formatted = definitions
    .map((def: LspSymbolDef) => {
      const parentStr = def.parent ? ` (in ${def.parent})` : '';
      return `  [${def.kind.toUpperCase()}] ${def.name}${parentStr} - L${def.startLine + 1} to L${def.endLine + 1}`;
    })
    .join('\n');

  return {
    success: true,
    message: `Symbols defined in ${file_path}:\n${formatted}`,
  };
}

async function handleGoToDefinition(
  absolutePath: string,
  file_path: string,
  symbol_name: string | undefined,
  search_paths: string[] | undefined,
) {
  if (!symbol_name) {
    return {
      success: false,
      message: 'Parameter "symbol_name" is required for goToDefinition operation.',
    };
  }

  const definitions = await parseDefinitions(absolutePath);
  if (definitions) {
    const localDef = definitions.find((d: LspSymbolDef) => d.name === symbol_name);
    if (localDef) {
      return {
        success: true,
        message: `Found local definition of "${symbol_name}" in ${file_path} at L${localDef.startLine + 1} to L${localDef.endLine + 1}:\n  ${localDef.signatureLine.trim()}`,
      };
    }
  }

  const filesToScan = resolveSearchFiles(search_paths, absolutePath);
  const refs = await findSymbolReferences(filesToScan, symbol_name, 'definition');
  if (refs.length === 0) {
    return {
      success: true,
      message: `Definition of symbol "${symbol_name}" not found in surrounding scope.`,
    };
  }

  const formatted = refs
    .map((ref: LspSymbolRef) => {
      const relPath = path.relative(permissionManager.sandboxDir, ref.filePath);
      return `  Definition at ${relPath}:L${ref.line + 1}: ${ref.lineText.trim()}`;
    })
    .join('\n');

  return {
    success: true,
    message: `Definitions of "${symbol_name}" found:\n${formatted}`,
  };
}

async function handleFindReferences(
  absolutePath: string,
  symbol_name: string | undefined,
  search_paths: string[] | undefined,
) {
  if (!symbol_name) {
    return {
      success: false,
      message: 'Parameter "symbol_name" is required for findReferences operation.',
    };
  }

  const filesToScan = resolveSearchFiles(search_paths, absolutePath);
  const refs = await findSymbolReferences(filesToScan, symbol_name, 'reference');
  if (refs.length === 0) {
    return {
      success: true,
      message: `No references found for symbol "${symbol_name}" in surrounding scope.`,
    };
  }

  const formatted = refs
    .map((ref: LspSymbolRef) => {
      const relPath = path.relative(permissionManager.sandboxDir, ref.filePath);
      return `  Reference at ${relPath}:L${ref.line + 1}: ${ref.lineText.trim()}`;
    })
    .join('\n');

  return {
    success: true,
    message: `References of "${symbol_name}" found:\n${formatted}`,
  };
}

async function handleHover(
  absolutePath: string,
  file_path: string,
  symbol_name: string | undefined,
) {
  if (!symbol_name) {
    return { success: false, message: 'Parameter "symbol_name" is required for hover operation.' };
  }

  const funcDetails = (await getFunction(absolutePath, symbol_name)) as LspFuncDetails | null;
  if (funcDetails) {
    const signature = funcDetails.content.split('\n')[0];
    return {
      success: true,
      message: `Symbol "${symbol_name}" (Function):\n  Signature: ${signature.trim()}\n  Defined in ${file_path} at line ${funcDetails.startLine + 1}`,
    };
  }

  const definitions = await parseDefinitions(absolutePath);
  if (definitions) {
    const match = definitions.find((d: LspSymbolDef) => d.name === symbol_name);
    if (match) {
      return {
        success: true,
        message: `Symbol "${symbol_name}" (${match.kind}):\n  Defined in ${file_path} at line ${match.startLine + 1}\n  Signature: ${match.signatureLine.trim()}`,
      };
    }
  }

  return {
    success: true,
    message: `Hover information for "${symbol_name}" is unavailable in this file.`,
  };
}

export default {
  name: 'dev_tools_lsp',
  description: 'Language Server Protocol (LSP) AST-Native tool for navigating code structures.',
  version: '1.0.0',
  enabled: true,

  toolDefinitions: [
    {
      type: 'function',
      function: {
        name: 'lsp_query',
        description:
          'Executes structural symbol-level navigation and queries. Supported operations: goToDefinition, findReferences, hover, documentSymbol.',
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['goToDefinition', 'findReferences', 'hover', 'documentSymbol'],
              description: 'LSP navigation operation to perform.',
            },
            file_path: {
              type: 'string',
              description: 'Relative or absolute file path.',
            },
            symbol_name: {
              type: 'string',
              description:
                'Symbol name to query (required for goToDefinition, findReferences, hover).',
            },
            search_paths: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Directories or files to search for references (optional, defaults to file_path dir).',
            },
          },
          required: ['operation', 'file_path'],
        },
      },
    },
  ],

  async execute(args: LspQueryArgs, _context: ToolContext, toolName: string) {
    if (toolName !== 'lsp_query') return null;

    const { operation, file_path, symbol_name, search_paths } = args;

    if (!file_path) {
      return { success: false, message: 'Parameter "file_path" is required.' };
    }

    const absolutePath = path.isAbsolute(file_path)
      ? safePath(file_path)
      : safePath(`${permissionManager.sandboxDir}${path.sep}${file_path}`);

    if (!safeExistsSync(absolutePath)) {
      return { success: false, message: `File does not exist: ${file_path}` };
    }

    try {
      switch (operation) {
        case 'documentSymbol':
          return handleDocumentSymbol(absolutePath, file_path);
        case 'goToDefinition':
          return handleGoToDefinition(absolutePath, file_path, symbol_name, search_paths);
        case 'findReferences':
          return handleFindReferences(absolutePath, symbol_name, search_paths);
        case 'hover':
          return handleHover(absolutePath, file_path, symbol_name);
        default:
          return { success: false, message: `Unsupported LSP operation: ${operation}.` };
      }
    } catch (error: unknown) {
      return { success: false, message: `LSP Tool AST Error: ${extractErrorMessage(error)}` };
    }
  },
};
