// tests/unit/plugins/shoppingPlugin.test.ts
import { describe, it, beforeEach, beforeAll, jest, expect } from '@jest/globals';

const mockStart = jest.fn();

jest.unstable_mockModule('../../../plugins/tools/shopping/shopping_agent.js', () => ({
  ShoppingAgent: jest.fn().mockImplementation(() => ({
    start: mockStart,
  })),
}));

let ShoppingPlugin: typeof import('../../../plugins/tools/shopping/index.js').default;

describe('Shopping Plugin', () => {
  type TransportLike = {
    sendText: (chatId: string, text: string) => Promise<void>;
    setPresence: (chatId: string, presence: string) => Promise<void>;
  };

  let mockTransport: {
    sendText: jest.MockedFunction<(chatId: string, text: string) => Promise<void>>;
    setPresence: jest.MockedFunction<(chatId: string, presence: string) => Promise<void>>;
  };
  let baseContext: { chatId: string; sender: string; transport: TransportLike };

  beforeAll(async () => {
    const shopModule = await import('../../../plugins/tools/shopping/index.js');
    ShoppingPlugin = shopModule.default;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockTransport = {
      sendText: jest.fn(),
      setPresence: jest.fn(),
    };
    baseContext = {
      chatId: '123@g.us',
      sender: 'user@g.us',
      transport: mockTransport,
    };
  });

  it('should validate context', async () => {
    const result = await ShoppingPlugin.execute({}, {}, 'find_product');
    expect(result.success).toBe(false);
    expect(result.message).toContain('CONTEXT_ERROR');
  });

  it('should execute shopping agent and return result', async () => {
    mockStart.mockResolvedValue('Here are some products' as never);

    const args = { request: 'I want a phone' };
    const result = await ShoppingPlugin.execute(args, baseContext, 'find_product');

    expect(result.success).toBe(true);
    expect(result.message).toBe('Here are some products');
    expect(mockTransport.sendText).toHaveBeenCalledWith(
      '123@g.us',
      expect.stringContaining('Shopping Mode Activated'),
    );
    expect(mockTransport.setPresence).toHaveBeenCalledWith('123@g.us', 'composing');
  });

  it('should handle errors thrown by shopping agent', async () => {
    mockStart.mockRejectedValue(new Error('Agent crashed') as never);

    const args = { request: 'I want a phone' };
    const result = await ShoppingPlugin.execute(args, baseContext, 'find_product');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Shopping search failed: Agent crashed');
  });

  it('should ignore unknown tools', async () => {
    const result = await ShoppingPlugin.execute({}, baseContext, 'unknown_tool');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown tool');
  });
});
