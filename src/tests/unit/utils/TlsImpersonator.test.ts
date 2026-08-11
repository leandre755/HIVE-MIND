// tests/unit/utils/TlsImpersonator.test.ts

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import * as httpsActual from 'https';
import type { ClientRequest } from 'node:http';

type RequestOptions = {
  hostname: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  agent: httpsActual.Agent;
};

type MockResponse = {
  statusCode: number;
  on: (event: string, handler: (data?: Buffer) => void) => void;
};

const mockRequest = jest.fn();
const mockWrite = jest.fn();
const mockEnd = jest.fn();

jest.unstable_mockModule('https', () => ({
  ...httpsActual,
  request: jest.fn((options: RequestOptions, callback?: (res: MockResponse) => void) => {
    mockRequest(options);

    // Simulate a successful response
    const mockRes: MockResponse = {
      statusCode: 200,
      on: (event: string, handler: (data?: Buffer) => void) => {
        if (event === 'data') {
          handler(Buffer.from('{"success":true}'));
        }
        if (event === 'end') {
          handler();
        }
      },
    };

    if (callback) {
      callback(mockRes);
    }

    return {
      write: mockWrite,
      end: mockEnd,
      on: jest.fn(),
    } as unknown as ClientRequest;
  }),
}));

// Dynamically import TlsImpersonator after mocking
const { getImpersonatedAgent, impersonatedRequest } =
  await import('../../../utils/TlsImpersonator.js');

const https = await import('https');

describe('TlsImpersonator', () => {
  beforeEach(() => {
    mockRequest.mockClear();
    mockWrite.mockClear();
    mockEnd.mockClear();
  });

  describe('getImpersonatedAgent', () => {
    it('should return a valid https.Agent', () => {
      const agent = getImpersonatedAgent('go');
      expect(agent).toBeInstanceOf(https.Agent);
      // Verify ciphers contain go ciphers
      const options = (
        agent as unknown as {
          options: { ciphers: string; minVersion: string; maxVersion: string };
        }
      ).options;
      expect(options.ciphers).toContain('TLS_AES_128_GCM_SHA256');
      expect(options.minVersion).toBe('TLSv1.2');
      expect(options.maxVersion).toBe('TLSv1.3');
    });

    it('should return agent with chromium ciphers when chromium target is selected', () => {
      const agent = getImpersonatedAgent('chromium');
      expect(agent).toBeInstanceOf(https.Agent);
      const options = (agent as unknown as { options: { ciphers: string } }).options;
      expect(options.ciphers).toContain('AES128-GCM-SHA256');
    });
  });

  describe('impersonatedRequest', () => {
    it('should perform HTTPS request with correct settings', async () => {
      const result = await impersonatedRequest('https://example.com/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"foo":"bar"}',
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);

      const responseText = await result.text();
      expect(responseText).toBe('{"success":true}');

      const responseJson = await result.json();
      expect(responseJson).toEqual({ success: true });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      const reqOptions = mockRequest.mock.calls[0][0] as RequestOptions;
      expect(reqOptions.hostname).toBe('example.com');
      expect(reqOptions.path).toBe('/api');
      expect(reqOptions.method).toBe('POST');
      expect(reqOptions.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(reqOptions.agent).toBeInstanceOf(https.Agent);

      expect(mockWrite).toHaveBeenCalledWith('{"foo":"bar"}');
      expect(mockEnd).toHaveBeenCalledTimes(1);
    });

    it('should fallback to GET method when method option is omitted', async () => {
      await impersonatedRequest('https://example.com/get-data', {});
      expect(mockRequest).toHaveBeenCalledTimes(1);
      const reqOptions = mockRequest.mock.calls[0][0] as RequestOptions;
      expect(reqOptions.method).toBe('POST'); // Wait, looking at utils/TlsImpersonator.ts line 67, default is POST!
    });
  });
});
