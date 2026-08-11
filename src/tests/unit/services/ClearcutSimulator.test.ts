// tests/unit/services/ClearcutSimulator.test.ts

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockImpersonatedRequest = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule('../../../utils/TlsImpersonator.js', () => ({
  impersonatedRequest: mockImpersonatedRequest,
  getImpersonatedAgent: jest.fn(),
}));

const { ClearcutSimulator } = await import('../../../services/telemetry/ClearcutSimulator.js');

describe('ClearcutSimulator', () => {
  beforeEach(() => {
    mockImpersonatedRequest.mockReset();
  });

  it('should successfully track start session event', async () => {
    mockImpersonatedRequest.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'OK',
      json: async () => ({}),
    });

    const success = await ClearcutSimulator.trackStartSession();
    expect(success).toBe(true);

    expect(mockImpersonatedRequest).toHaveBeenCalledTimes(1);
    const [url, options] = mockImpersonatedRequest.mock.calls[0] as unknown as [
      string,
      { method: string; body: string },
    ];
    expect(url).toContain('play.googleapis.com/log');
    expect(options.method).toBe('POST');

    const payload = JSON.parse(options.body);
    expect(payload[0].log_source_name).toBe('CONCORD');

    const logEvent = JSON.parse(payload[0].log_event[0].source_extension_json);
    expect(logEvent.event_name).toBe('start_session');
    expect(logEvent.console_type).toBe('GEMINI_CLI');
    expect(logEvent.application).toBe(102);
  });

  it('should successfully track new prompt event', async () => {
    mockImpersonatedRequest.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'OK',
      json: async () => ({}),
    });

    const promptId = 'test-prompt-123';
    const success = await ClearcutSimulator.trackNewPrompt(promptId);
    expect(success).toBe(true);

    expect(mockImpersonatedRequest).toHaveBeenCalledTimes(1);
    const [, options] = mockImpersonatedRequest.mock.calls[0] as unknown as [
      string,
      { method: string; body: string },
    ];
    const payload = JSON.parse(options.body);
    const logEvent = JSON.parse(payload[0].log_event[0].source_extension_json);
    expect(logEvent.event_name).toBe('new_prompt');

    const promptMeta = logEvent.event_metadata[0].find(
      (m: { gemini_cli_key: number }) => m.gemini_cli_key === 35,
    );
    expect(promptMeta).toBeDefined();
    expect(promptMeta.value).toBe(promptId);
  });

  it('should successfully track tool call event', async () => {
    mockImpersonatedRequest.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'OK',
      json: async () => ({}),
    });

    const success = await ClearcutSimulator.trackToolCall('some_tool', true);
    expect(success).toBe(true);

    expect(mockImpersonatedRequest).toHaveBeenCalledTimes(1);
    const [, options] = mockImpersonatedRequest.mock.calls[0] as unknown as [
      string,
      { method: string; body: string },
    ];
    const payload = JSON.parse(options.body);
    const logEvent = JSON.parse(payload[0].log_event[0].source_extension_json);
    expect(logEvent.event_name).toBe('tool_call');
  });

  it('should handle network failures gracefully and return false', async () => {
    mockImpersonatedRequest.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
      json: async () => ({}),
    });

    const success = await ClearcutSimulator.trackStartSession();
    expect(success).toBe(false);
  });
});
