// src/tests/unit/core/compactHistory.test.ts
// Test unitaire exhaustif de BotCore._optimizeHistory (Production Code)
import { describe, it, expect } from '@jest/globals';

process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'dummy';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.NODE_ENV = 'test';

const { botCore } = await import('../../../core/index.js');

type CoreInternalAccess = {
  _optimizeHistory: (history: Record<string, unknown>[]) => Record<string, unknown>[];
};

const coreAccess = botCore as unknown as CoreInternalAccess;

describe('BotCore._optimizeHistory (MOD 1 Context Compaction)', () => {
  it('laisse l historique rigoureusement intact lorsque la taille totale est inférieure à 25 000 caractères', () => {
    const compactHistory = [
      { role: 'system', content: 'Tu es HIVE-MIND.' },
      { role: 'user', content: 'Donne-moi la météo.' },
      { role: 'assistant', content: 'Il fait 22°C.' },
    ];

    const result = coreAccess._optimizeHistory(compactHistory);
    expect(result).toEqual(compactHistory);
  });

  it('tronque les tool outputs excédant 2000 caractères lors d un dépassement du seuil de 25k caractères', () => {
    const hugeToolOutput = 'Z'.repeat(6000);
    const padding = 'P'.repeat(21000);

    const heavyHistory = [
      { role: 'system', content: 'Prompt système initial.' },
      { role: 'user', content: padding },
      { role: 'tool', content: hugeToolOutput },
      { role: 'assistant', content: 'Observation en cours...' },
      { role: 'user', content: 'Autre question' },
      { role: 'assistant', content: 'Fin' },
    ];

    const optimized = coreAccess._optimizeHistory(heavyHistory);

    const toolMsg = optimized[2] as { role: string; content: string };
    expect(toolMsg.content.length).toBeLessThan(hugeToolOutput.length);
    expect(toolMsg.content).toContain('[TRONQUÉ: 4000 chars masqués]');
    expect(toolMsg.content.startsWith('Z'.repeat(2000))).toBe(true);
  });

  it('préserve strictement les zones protégées (2 premiers et 2 derniers messages)', () => {
    const hugeMsg = 'T'.repeat(5000);
    const padding = 'X'.repeat(22000);

    const heavyHistory = [
      { role: 'tool', content: hugeMsg }, // Index 0: protégé
      { role: 'tool', content: hugeMsg }, // Index 1: protégé
      { role: 'tool', content: hugeMsg }, // Index 2: ÉLIGIBLE à la troncature
      { role: 'user', content: padding }, // Index 3
      { role: 'tool', content: hugeMsg }, // Index 4 (avant-dernier): protégé
      { role: 'assistant', content: 'Fin' }, // Index 5 (dernier): protégé
    ];

    const optimized = coreAccess._optimizeHistory(heavyHistory);

    // Index 0 et 1 doivent rester intacts
    expect((optimized[0] as { content: string }).content).toBe(hugeMsg);
    expect((optimized[1] as { content: string }).content).toBe(hugeMsg);

    // Index 2 doit être tronqué
    expect((optimized[2] as { content: string }).content).toContain('[TRONQUÉ:');

    // Index 4 doit rester intact car dans safeZoneEnd
    expect((optimized[4] as { content: string }).content).toBe(hugeMsg);
  });

  it('interrompt la boucle de troncature dès que la taille repasse sous les 25k caractères', () => {
    const toolMsg1 = 'A'.repeat(5000);
    const toolMsg2 = 'B'.repeat(5000);
    const padding = 'Y'.repeat(22000);

    const history = [
      { role: 'system', content: 'Sys' },
      { role: 'user', content: padding },
      { role: 'tool', content: toolMsg1 }, // Tronqué -> libère 3000 chars, total passe à ~24k
      { role: 'tool', content: toolMsg2 }, // Ne doit PAS être tronqué car seuil atteint
      { role: 'assistant', content: 'ok' },
      { role: 'assistant', content: 'fin' },
    ];

    const optimized = coreAccess._optimizeHistory(history);

    expect((optimized[2] as { content: string }).content).toContain('[TRONQUÉ:');
    expect((optimized[3] as { content: string }).content).toBe(toolMsg2); // Intact
  });
});
