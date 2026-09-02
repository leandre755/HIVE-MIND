import { describe, it, expect, beforeEach } from '@jest/globals';
import { ServiceContainer } from '../../../core/ServiceContainer.js';

describe('ServiceContainer (SS-01: Core / IoC Container)', () => {
  let container: ServiceContainer;

  beforeEach(() => {
    container = new ServiceContainer();
  });

  describe('Enregistrement & Résolution de Services', () => {
    it('enregistre et instancie un service transitoire (nouvelle instance à chaque get)', () => {
      let counter = 0;
      container.register('transientCounter', () => ++counter, { singleton: false });

      expect(container.has('transientCounter')).toBe(true);
      expect(container.get('transientCounter')).toBe(1);
      expect(container.get('transientCounter')).toBe(2);
    });

    it('enregistre et conserve un singleton unique à travers les résolutions', () => {
      let counter = 0;
      container.register('singletonCounter', () => ({ id: ++counter }), { singleton: true });

      const first = container.get<{ id: number }>('singletonCounter');
      const second = container.get<{ id: number }>('singletonCounter');

      expect(first.id).toBe(1);
      expect(second.id).toBe(1);
      expect(first).toBe(second);
    });

    it('lève une exception explicite lors de la demande d un service non enregistré', () => {
      expect(() => container.get('unknown_service')).toThrow(/Service non trouvé: unknown_service/);
    });
  });

  describe('Métriques & Écrasement Contrôlé', () => {
    it('fournit des statistiques fidèles sur l état des singletons et instances', () => {
      container.register('t1', () => 1, { singleton: false });
      container.register('s1', () => ({ test: true }), { singleton: true });

      let stats = container.getStats();
      expect(stats.total).toBe(2);
      expect(stats.singletons).toBe(1);
      expect(stats.instances).toBe(0);

      container.get('s1');
      stats = container.getStats();
      expect(stats.instances).toBe(1);
    });

    it('permet le remplacement dynamique d un service enregistré', () => {
      container.register('serviceX', () => 'initial');
      container.register('serviceX', () => 'remplacé');

      expect(container.get('serviceX')).toBe('remplacé');
    });
  });
});
