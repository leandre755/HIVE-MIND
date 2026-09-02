import { describe, it, expect, beforeEach } from '@jest/globals';
import { ContextWindowService } from '../../../services/runtime/ContextWindowService.js';

describe('ContextWindowService (SS-21/SS-22: Runtime Context Management)', () => {
  let service: ContextWindowService;

  beforeEach(() => {
    service = new ContextWindowService();
  });

  describe('Limites des Modèles', () => {
    it('retourne la limite de jetons configurée pour les modèles connus', () => {
      expect(service.getLimit('gemini-3.5-flash')).toBe(1048576);
      expect(service.getLimit('gemini-3.1-pro-preview')).toBe(2097152);
      expect(service.getLimit('codestral-latest')).toBe(32768);
      expect(service.getLimit('kimi-for-coding')).toBe(262144);
    });

    it('applique un repli à 131072 (128k) pour les modèles inconnus', () => {
      expect(service.getLimit('unknown-ollama-model')).toBe(131072);
    });

    it('utilise lastActiveModel lorsque le paramètre de modèle est absent', () => {
      expect(service.getLimit()).toBe(1048576); // modèle par défaut: gemini-3.5-flash
      service.setActiveModel('codestral-latest');
      expect(service.getActiveModel()).toBe('codestral-latest');
      expect(service.getLimit()).toBe(32768);
    });

    it('ignore les chaînes vides lors de setActiveModel', () => {
      service.setActiveModel('gpt-5.2');
      service.setActiveModel('');
      expect(service.getActiveModel()).toBe('gpt-5.2');
    });
  });

  describe('Estimation de Tokens (estimateTokens)', () => {
    it('retourne 0 pour les entrées nulles, non définies ou vides', () => {
      expect(service.estimateTokens(null)).toBe(0);
      expect(service.estimateTokens(undefined)).toBe(0);
      expect(service.estimateTokens('')).toBe(0);
    });

    it('estime les tokens selon la règle 1 token ≈ 4 caractères', () => {
      expect(service.estimateTokens('1234')).toBe(1);
      expect(service.estimateTokens('12345')).toBe(2);
      expect(service.estimateTokens('System prompt standard de validation.')).toBe(10);
    });

    it('sérialise les objets et tableaux pour l estimation', () => {
      const historyMessage = { role: 'user', content: 'Demande utilisateur' };
      const expected = Math.ceil(JSON.stringify(historyMessage).length / 4);
      expect(service.estimateTokens(historyMessage)).toBe(expected);
    });
  });

  describe('Suivi de Consommation & Déclenchement de Seuil (isThresholdReached)', () => {
    it('calcule correctement le pourcentage d occupation du contexte', () => {
      service.setActiveModel('codestral-latest'); // 32768
      service.updateConsumption('chat_test', 16384);

      const usage = service.getUsage('chat_test');
      expect(usage.limit).toBe(32768);
      expect(usage.consumed).toBe(16384);
      expect(usage.percentage).toBeCloseTo(0.5, 3);
      expect(usage.model).toBe('codestral-latest');
      expect(service.isThresholdReached('chat_test', [])).toBe(false);
    });

    it('déclenche le Garbage Collector dès que le seuil de 80% est atteint', () => {
      service.setActiveModel('codestral-latest'); // 32768
      service.updateConsumption('chat_test', 26215); // > 80%

      expect(service.isThresholdReached('chat_test', [])).toBe(true);
    });

    it('met à jour la consommation dynamiquement si un historique est fourni à getUsage', () => {
      service.setActiveModel('codestral-latest');
      const longHistory = [{ role: 'user', content: 'A'.repeat(8000) }];
      const usage = service.getUsage('chat_dynamic', longHistory);

      expect(usage.consumed).toBeGreaterThan(2000);
      expect(usage.percentage).toBeGreaterThan(0);
    });
  });
});
