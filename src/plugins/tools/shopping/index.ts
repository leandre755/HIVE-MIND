interface FindProductArgs {
  request: string;
}

interface ShoppingTransport {
  sendText(chatId: string, text: string): Promise<void>;
  setPresence(chatId: string, presence: string): Promise<void>;
}

interface ShoppingContext {
  chatId?: string;
  sender?: string;
  transport?: ShoppingTransport;
}

export default {
  name: 'shopping',
  description: 'Intelligent Shopping Assistant (Comparison, Specs, Prices).',
  version: '1.0.0',
  enabled: true,

  toolDefinitions: [
    {
      type: 'function',
      function: {
        name: 'find_product',
        description:
          'Search for products to buy online. Use for requests like "I want to buy...", "Find a price for...", "What is the best...".',
        parameters: {
          type: 'object',
          properties: {
            request: {
              type: 'string',
              description: 'Full user request (product, budget, constraints).',
            },
          },
          required: ['request'],
        },
      },
    },
  ],

  async execute(args: unknown, context: ShoppingContext, toolName: string) {
    const { chatId, sender, transport } = context || {};

    if (!chatId || !transport) {
      return { success: false, message: 'CONTEXT_ERROR: Missing required context.' };
    }

    if (toolName === 'find_product') {
      const { request } = args as FindProductArgs;

      // 1. Start
      await transport.sendText(
        chatId,
        `🛍️ **Shopping Mode Activated**\nSearching for: "${request}"...`,
      );
      await transport.setPresence(chatId, 'composing');

      // 2. Lancement de l'agent via import dynamique
      try {
        const { ShoppingAgent } = await import('./shopping_agent.js');
        const agent = new ShoppingAgent(sender ?? 'unknown', chatId);
        const result = await agent.start(request);

        return {
          success: true,
          message: result,
        };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error('[ShoppingPlugin] Error:', err);
        return { success: false, message: `Shopping search failed: ${err.message}` };
      }
    }
    return { success: false, message: 'Unknown tool' };
  },
};
