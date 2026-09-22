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

    it('permet de retenter init() après un échec initial sans rester bloqué sur la promesse rejetée', async () => {
      let attempts = 0;
      (container as unknown as { _doInit: () => Promise<void> })._doInit = async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('Transient initialization failure');
        }
      };

      await expect(container.init()).rejects.toThrow('Transient initialization failure');
      await expect(container.init()).resolves.toBeUndefined();
      expect(attempts).toBe(2);
    });

    it('renvoie la même promesse d initialisation si init() est appelé plusieurs fois en parallèle', async () => {
      let resolveInit!: () => void;
      (container as unknown as { _doInit: () => Promise<void> })._doInit = () =>
        new Promise<void>((resolve) => {
          resolveInit = resolve;
        });

      const p1 = container.init();
      const p2 = container.init();
      expect(p1).toBe(p2);

      resolveInit();
      await Promise.all([p1, p2]);
    });

    it('retourne immédiatement si le container est déjà initialisé', async () => {
      (container as unknown as { initialized: boolean }).initialized = true;
      await expect(container.init()).resolves.toBeUndefined();
    });
  });
});
