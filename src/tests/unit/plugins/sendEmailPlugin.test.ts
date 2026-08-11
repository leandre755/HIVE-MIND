// tests/unit/plugins/sendEmailPlugin.test.ts
import { describe, it, beforeEach, jest, expect } from '@jest/globals';
import SendEmailPlugin from '../../../plugins/tools/send_email/index.js';

// We need to mock global fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('Send Email Plugin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should validate required fields', async () => {
    const result = await SendEmailPlugin.execute(
      {} as Parameters<typeof SendEmailPlugin.execute>[0],
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain('Missing required fields');
  });

  it('should validate email format', async () => {
    const result = await SendEmailPlugin.execute({
      email: 'invalid-email',
      header: 'Test',
      message: 'Hello',
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid email address format');
  });

  it('should send email successfully', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
    } as Partial<Response> as Response);

    const result = await SendEmailPlugin.execute({
      email: 'test@example.com',
      header: 'Test Subject',
      message: 'Hello World',
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('successfully');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('webhook/hive-send-email'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          header: 'Test Subject',
          message: 'Hello World',
        }),
      }),
    );
  });

  it('should handle non-ok responses', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as Partial<Response> as Response);

    const result = await SendEmailPlugin.execute({
      email: 'test@example.com',
      header: 'Test Subject',
      message: 'Hello World',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('HTTP 500: Internal Server Error');
  });

  it('should handle network errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network disconnected'));

    const result = await SendEmailPlugin.execute({
      email: 'test@example.com',
      header: 'Test',
      message: 'Hello',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Could not send email: Network disconnected');
  });
});
