import { describe, beforeAll, afterAll, it, expect, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

// Mock explicit for permissionManager and TreeSitterService
jest.unstable_mockModule('../../../core/security/PermissionManager.js', () => ({
  permissionManager: {
    sandboxDir: path.resolve(process.cwd(), 'Sandbox1'),
  },
}));

const LSPTool = (await import('../../../plugins/base/dev_tools/LSPTool.js')).default;

describe('LSPTool', () => {
  const testDir = path.resolve(process.cwd(), 'src/tests/unit/plugins/temp_test_lsp');
  const testFile = path.join(testDir, 'helper.ts');

  beforeAll(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    // Create a simple TS file for parsing
    const code = `
export class Helper {
    constructor() {}
    
    public performTask(data: string): boolean {
        return data.length > 0;
    }
}

export function globalUtil(): void {
    console.log("Util call");
}
`;
    fs.writeFileSync(testFile, code, 'utf8');
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should throw an error if file_path is missing', async () => {
    const result = await LSPTool.execute({ operation: 'documentSymbol' }, {}, 'lsp_query');
    expect(result).toEqual({ success: false, message: 'Parameter "file_path" is required.' });
  });

  it('should throw an error if file does not exist', async () => {
    const result = await LSPTool.execute(
      { operation: 'documentSymbol', file_path: 'ghost.ts' },
      {},
      'lsp_query',
    );
    expect(result?.success).toBe(false);
    expect(result?.message).toContain('File does not exist');
  });

  it('should extract document symbols using documentSymbol operation', async () => {
    const result = await LSPTool.execute(
      { operation: 'documentSymbol', file_path: testFile },
      {},
      'lsp_query',
    );
    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Helper');
    expect(result?.message).toContain('performTask');
    expect(result?.message).toContain('globalUtil');
  });

  it('should go to definition of local symbol using goToDefinition operation', async () => {
    const result = await LSPTool.execute(
      {
        operation: 'goToDefinition',
        file_path: testFile,
        symbol_name: 'performTask',
      },
      {},
      'lsp_query',
    );

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Found local definition');
    expect(result?.message).toContain('performTask(data: string)');
  });

  it('should find symbol references using findReferences operation', async () => {
    const result = await LSPTool.execute(
      {
        operation: 'findReferences',
        file_path: testFile,
        symbol_name: 'performTask',
      },
      {},
      'lsp_query',
    );

    expect(result?.success).toBe(true);
    // It should locate the declaration itself as a reference/usage in this scope
    expect(result?.message).toContain('performTask');
  });

  it('should provide hover information using hover operation', async () => {
    const result = await LSPTool.execute(
      {
        operation: 'hover',
        file_path: testFile,
        symbol_name: 'performTask',
      },
      {},
      'lsp_query',
    );

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Symbol "performTask" (Function)');
    expect(result?.message).toContain('performTask(data: string)');
  });
});
