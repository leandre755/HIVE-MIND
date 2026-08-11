import { jest, describe, it, expect } from '@jest/globals';
import { enforceFormat } from '../../../utils/ResponseFormatEnforcer.js';

describe('ResponseFormatEnforcer', () => {
  it('should successfully parse valid JSON on the first attempt', async () => {
    const executeCall = jest
      .fn<(retryPromptModifier?: string) => Promise<string>>()
      .mockResolvedValue('{"status": "ok", "value": 42}');
    const validate = (parsed: { status: string; value?: number }) => {
      if (parsed.status !== 'ok') return 'Status must be ok';
      return true;
    };

    const result = await enforceFormat<{ status: string; value: number }>(executeCall, {
      validate,
      maxRetries: 2,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: 'ok', value: 42 });
    expect(result.rawResponse).toBe('{"status": "ok", "value": 42}');
    expect(executeCall).toHaveBeenCalledTimes(1);
  });

  it('should successfully repair slightly malformed JSON', async () => {
    // JSON mal formé (guillemets simples, clé sans guillemets, commentaires)
    const malformedJson = `{
            // un commentaire
            status: 'ok',
            'value': 42
        }`;
    const executeCall = jest
      .fn<(retryPromptModifier?: string) => Promise<string>>()
      .mockResolvedValue(malformedJson);
    const validate = (parsed: { status: string; value?: number }) => {
      if (typeof parsed.value !== 'number') return 'Value must be a number';
      return true;
    };

    const result = await enforceFormat<{ status: string; value: number }>(executeCall, {
      validate,
      maxRetries: 2,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: 'ok', value: 42 });
    expect(executeCall).toHaveBeenCalledTimes(1);
  });

  it('should retry when JSON is unparseable, and succeed on retry', async () => {
    const executeCall = jest
      .fn<(retryPromptModifier?: string) => Promise<string>>()
      .mockResolvedValueOnce('This is not JSON at all')
      .mockResolvedValueOnce('{"status": "ok", "value": 100}');

    const result = await enforceFormat<{ status: string; value: number }>(executeCall, {
      maxRetries: 2,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: 'ok', value: 100 });
    expect(executeCall).toHaveBeenCalledTimes(2);
    // La deuxième fois, il doit recevoir la correction d'erreur
    expect(executeCall).toHaveBeenLastCalledWith(expect.stringContaining('[SYSTEM REJECTION]'));
  });

  it('should retry when validation fails, and fail if retries exhausted', async () => {
    const executeCall = jest
      .fn<(retryPromptModifier?: string) => Promise<string>>()
      .mockResolvedValue('{"status": "error", "value": 10}');

    const validate = (parsed: { status: string; value?: number }) => {
      if (parsed.status !== 'ok') return 'Status must be ok';
      return true;
    };

    const result = await enforceFormat<{ status: string; value: number }>(executeCall, {
      validate,
      maxRetries: 2,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Status must be ok');
    // Initial attempt (1) + 2 retries = 3 calls total
    expect(executeCall).toHaveBeenCalledTimes(3);
  });
});
