interface DailyPulseTransport {
  sendText(chatId: string, text: string): Promise<void>;
  sendVoiceNote(chatId: string, filePath: string, options?: { caption?: string }): Promise<void>;
}

interface DailyPulseContext {
  chatId?: string;
  transport?: DailyPulseTransport;
}

export default {
  name: 'daily_pulse',
  description: 'Generates an audio news brief (Daily Pulse) summarizing group activity.',
  version: '1.1.0',
  enabled: true,

  toolDefinitions: [
    {
      type: 'function',
      function: {
        name: 'generate_daily_pulse',
        description:
          'Generates a narrative audio summary (Podcast/Journal) of recent group activity. Use when the user asks: "What\'s new?", "Summary of the day?", "Start the Daily Pulse", or "Make the news brief".',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
  ],

  async execute(_args: unknown, context: DailyPulseContext, toolName: string) {
    const { chatId, transport } = context || {};

    if (!chatId || !transport) {
      return { success: false, message: 'CONTEXT_ERROR: Missing required context.' };
    }

    if (toolName === 'generate_daily_pulse') {
      await transport.sendText(
        chatId,
        '🎙️ **The Daily Pulse**\nAnalyzing logs... Tuning microphones...',
      );

      try {
        // 1. Generate the script via dynamic import
        const { journalGenerator } = await import('./journal_generator.js');
        const script = await journalGenerator.generateDailyScript(chatId);

        if (!script) {
          return { success: false, message: 'Not enough activity for a Daily Pulse today. 😴' };
        }

        // 2. Audio Production via Gemini Live
        console.log('[DailyPulse] 🎙️ Audio production in progress...');
        const audioPath = await journalGenerator.produceAudio(script);

        if (audioPath) {
          // 3. Send as PTT voice note
          await transport.sendVoiceNote(chatId, audioPath, {
            caption: '📻 The Daily Pulse',
          });

          console.log('[DailyPulse] ✅ Audio sent successfully');
          return { success: true, message: 'Daily Pulse audio sent! 🎙️' };
        } else {
          // Fallback: send script as text if audio fails
          console.warn('[DailyPulse] ⚠️ Audio failed, fallback to text');
          await transport.sendText(
            chatId,
            `📻 **Radio Script of the Day:**\n\n${script}\n\n*(Audio not available this time)*`,
          );
          return {
            success: true,
            message: 'Daily Pulse generated (Text Mode - Audio unavailable)',
          };
        }
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error('[DailyPulse] Error:', err);
        return { success: false, message: 'Error during Daily Pulse production.' };
      }
    }
    return { success: false, message: 'Unknown tool' };
  },
};
