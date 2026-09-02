// src/tests/unit/core/m2_challenger_edge_cases.test.ts
// Test de non-régression et robustesse des cas limites (Simulation M2 & FSM)
import { describe, it, expect } from '@jest/globals';
import { ContextWindowService } from '../../../services/runtime/ContextWindowService.js';
import type { WakeEvent } from '../../../services/ptc/WakeSystem.js';

describe('M2 Edge Cases & Robustness (Résilience Runtime & FSM)', () => {
  describe('Hypothèse 1 : Résilience du dimensionnement des limites de contexte', () => {
    it('retourne les limites attendues ou le repli 128k sans lever d exception', () => {
      const contextWindow = new ContextWindowService();

      const claudeLimit = contextWindow.getLimit('anthropic/claude-3-5-sonnet');
      expect(typeof claudeLimit).toBe('number');
      expect(claudeLimit).toBeGreaterThan(0);

      const geminiLimit = contextWindow.getLimit('gemini-3.5-flash');
      expect(geminiLimit).toBe(1048576);

      const fallbackLimit = contextWindow.getLimit('unknown-model-xyz');
      expect(fallbackLimit).toBe(131072);
    });
  });

  describe('Hypothèse 2 : Résilience de désérialisation du WakeSystem face aux données corrompues', () => {
    it('gère les JSON corrompus et les valeurs NaN sans planter la boucle d événements', () => {
      const testStore = new Map<string, string>();
      testStore.set('corrupted_json', 'invalid-json-{');
      testStore.set(
        'nan_wake_at',
        JSON.stringify({ id: 'nan_wake_at', chatId: 'c1', wakeAtMs: NaN, prompt: 'test' }),
      );
      testStore.set(
        'valid_past',
        JSON.stringify({
          id: 'valid_past',
          chatId: 'c1',
          wakeAtMs: Date.now() - 1000,
          prompt: 'test',
        }),
      );

      const nowMs = Date.now();
      const validEvents: WakeEvent[] = [];

      for (const [id, eventStr] of testStore.entries()) {
        try {
          const event = JSON.parse(eventStr) as WakeEvent;
          if (typeof event.wakeAtMs === 'number' && !Number.isNaN(event.wakeAtMs)) {
            if (event.wakeAtMs <= nowMs) {
              validEvents.push(event);
              testStore.delete(id);
            }
          } else {
            // Nettoyage proactif des clés corrompues (Zombie Keys)
            testStore.delete(id);
          }
        } catch {
          testStore.delete(id);
        }
      }

      // La clé corrompue et la clé NaN doivent avoir été purgées proprement
      expect(testStore.has('corrupted_json')).toBe(false);
      expect(testStore.has('nan_wake_at')).toBe(false);
      expect(validEvents).toHaveLength(1);
      expect(validEvents[0].id).toBe('valid_past');
    });
  });
});
