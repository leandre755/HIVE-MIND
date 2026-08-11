import { describe, it, expect } from '@jest/globals';
import { validateCode, autoRepairCode } from '../../../services/ptc/SafeScriptValidator.js';

describe('SafeScriptValidator', () => {
  const availableTools = ['duckduck_search', 'read_file'];

  describe('validateCode', () => {
    it('should pass for valid JS code using available tools', () => {
      const code = 'const result = await duckduck_search({ query: "node.js" });';
      const res = validateCode(code, availableTools);
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('should catch syntax errors in malformed JS', () => {
      const code = 'const x = ;';
      const res = validateCode(code, availableTools);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.type === 'SYNTAX')).toBe(true);
    });

    it('should flag unsafe constructs like eval or require', () => {
      const code = 'eval("console.log(1)");';
      const res = validateCode(code, availableTools);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.type === 'UNSAFE_CONSTRUCT')).toBe(true);
    });

    it('should catch undefined variables or unknown tools', () => {
      const code = 'await unknownTool({ arg: 1 });';
      const res = validateCode(code, availableTools);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.type === 'UNKNOWN_TOOL' || e.type === 'UNDEFINED_VAR')).toBe(
        true,
      );
    });
  });

  describe('autoRepairCode', () => {
    it('should auto-repair code with missing semicolon or parentheses if possible', () => {
      const code = 'const res = duckduck_search({ query: "test" });';
      const validation = validateCode(code, availableTools);
      const repair = autoRepairCode(code, validation.errors);
      expect(repair.appliedFixes.length).toBeGreaterThan(0);
    });
  });
});
