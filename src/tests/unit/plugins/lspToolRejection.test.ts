import { describe, it, expect, jest } from '@jest/globals';
import * as path from 'path';

jest.unstable_mockModule('../../../core/security/PermissionManager.js', () => ({
  permissionManager: { sandboxDir: path.resolve(process.cwd(), 'Sandbox1') },
}));

jest.unstable_mockModule('../../../services/ast/index.js', () => ({
  parseDefinitions: jest.fn(async () => {
    throw new Error('ast failure');
  }),
  findSymbolReferences: jest.fn(async () => {
    throw new Error('ast failure');
  }),
  getFunction: jest.fn(async () => {
    throw new Error('ast failure');
  }),
}));

const LSPTool = (await import('../../../plugins/base/dev_tools/LSPTool.js')).default;

const targetFile = path.resolve(process.cwd(), 'src/plugins/base/dev_tools/LSPTool.ts');

type ToolResult = { success?: boolean; message?: string };

describe('LSPTool — rejets des handlers asynchrones', () => {
  it("convertit le rejet de handleDocumentSymbol en résultat formaté plutôt qu'en rejection non gérée", async () => {
    const result = (await LSPTool.execute(
      { operation: 'documentSymbol', file_path: targetFile },
      {},
      'lsp_query',
    )) as ToolResult;

    expect(result.success).toBe(false);
    expect(String(result.message)).toContain('LSP Tool AST Error');
  });

  it('convertit de la même façon le rejet de handleFindReferences', async () => {
    const result = (await LSPTool.execute(
      { operation: 'findReferences', file_path: targetFile, symbol_name: 'execute' },
      {},
      'lsp_query',
    )) as ToolResult;

    expect(result.success).toBe(false);
    expect(String(result.message)).toContain('LSP Tool AST Error');
  });
});
