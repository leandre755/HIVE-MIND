/**
 * Tests unitaires pour le registre statique des adaptateurs providers (Issue #132).
 * Vérifie l'exhaustivité des 8 adaptateurs natifs, leur conformité au contrat
 * ProviderAdapter, et l'élimination des imports dynamiques calculés.
 */

import { fileURLToPath } from 'node:url';
import { safeReadFileSync } from '../../../utils/safeFs.js';
import { adapterRegistry } from '../../../providers/adapters/registry.js';
import { providerRouter, loadAdapters } from '../../../providers/index.js';
import type { ProviderAdapter } from '../../../providers/types.js';

describe('Adapter Static Registry (#132)', () => {
  const EXPECTED_ADAPTER_KEYS = [
    'openai',
    'gemini',
    'anthropic',
    'groq',
    'huggingface',
    'cohere',
    'cloudflare',
    'modal',
  ] as const;

  it('expose exactement les 8 adaptateurs natifs attendus', () => {
    const keys = Object.keys(adapterRegistry).sort();
    const expected = [...EXPECTED_ADAPTER_KEYS].sort();

    expect(keys).toEqual(expected);
    expect(keys).toHaveLength(8);
  });

  it('est immuable via Object.freeze', () => {
    expect(Object.isFrozen(adapterRegistry)).toBe(true);
  });

  it.each(EXPECTED_ADAPTER_KEYS)(
    'fournit un adaptateur conforme pour la famille %s',
    (adapterName) => {
      const adapter = Reflect.get(adapterRegistry, adapterName) as ProviderAdapter | undefined;

      expect(adapter).toBeDefined();
      expect(typeof adapter?.name).toBe('string');
      expect(adapter?.name).toBe(adapterName);
      expect(typeof adapter?.chat).toBe('function');
    },
  );

  it('inclut la méthode embed pour les adaptateurs compatibles', () => {
    const openai = adapterRegistry.openai;
    expect(typeof openai.embed).toBe('function');
  });
});

describe('Provider Router Adapter Loading (#132)', () => {
  beforeAll(async () => {
    await loadAdapters();
  });

  it('enregistre tous les adaptateurs du registre statique dans providerRouter.adapters', () => {
    for (const [name, adapter] of Object.entries(adapterRegistry)) {
      expect(providerRouter.adapters.has(name)).toBe(true);
      expect(providerRouter.adapters.get(name)).toBe(adapter);
    }
  });

  it('enregistre les familles configurées sans adaptateur natif via GenericProviderAdapter', () => {
    expect(providerRouter.adapters.has('mistral')).toBe(true);
  });

  it('est idempotent lors d appels répétés à loadAdapters()', async () => {
    const firstCall = loadAdapters();
    const secondCall = loadAdapters();

    expect(firstCall).toBe(secondCall);
    await expect(firstCall).resolves.toBeUndefined();
    await expect(secondCall).resolves.toBeUndefined();
  });

  it('garantit l absence d import dynamique calculé sur adapters/ dans src/providers/index.ts', () => {
    const indexPath = fileURLToPath(new URL('../../../providers/index.ts', import.meta.url));
    const content = safeReadFileSync(indexPath);

    // Vérifie qu'aucun pathToFileURL ni import calculé sur adapters n'existe
    expect(content).not.toContain('pathToFileURL');
    expect(content).not.toMatch(/join\(__dirname,\s*['"]adapters['"]/);
    // Rejette tout import() dynamique dont l'argument n'est pas une chaîne littérale statique
    expect(content).not.toMatch(/import\(\s*(?!['"][^'"]+['"]\s*\))/);
  });
});
