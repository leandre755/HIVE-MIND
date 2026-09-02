import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('../../../providers/index.js', () => ({
  providerRouter: {
    callServiceRecipe: jest.fn(),
  },
}));

const { RuntimeSentinel } = await import('../../../services/runtime/RuntimeInfrastructure.js');
const { providerRouter } = await import('../../../providers/index.js');

describe('RuntimeSentinel (SS-21: AI Runtime Control Plane / VIGIL)', () => {
  let sentinel: InstanceType<typeof RuntimeSentinel>;

  beforeEach(() => {
    jest.clearAllMocks();
    sentinel = new RuntimeSentinel();
  });

  describe('projectActionSpace (Élagage Déterministe)', () => {
    const allTools = [
      {
        type: 'function' as const,
        function: { name: 'read_file', description: 'Lecture fichier' },
      },
      {
        type: 'function' as const,
        function: { name: 'edit_file', description: 'Modification fichier' },
      },
      {
        type: 'function' as const,
        function: { name: 'execute_bash_command', description: 'Exécution bash' },
      },
    ];

    it('retourne tous les outils si aucun blueprint n est actif', () => {
      const result = sentinel.projectActionSpace(allTools);
      expect(result).toHaveLength(3);
    });

    it('filtre strictement les outils selon la liste blanche allowed_tools', () => {
      const blueprint = {
        metadata: { id: 'test', name: 'Test', version: '1.0' },
        mindos: { drives: [] },
        action_space: { allowed_tools: ['read_file'] },
        constraints: { read_only_fs: false, max_budget_usd: 1.0, max_iterations: 10 },
      };

      const result = sentinel.projectActionSpace(allTools, blueprint);
      expect(result).toHaveLength(1);
      expect(result[0].function?.name).toBe('read_file');
    });
  });

  describe('evaluate — Politiques de Sécurité & Fast Paths', () => {
    it('bloque immédiatement un outil absent de la liste blanche du blueprint', async () => {
      const blueprint = {
        metadata: { id: 'test', name: 'Test', version: '1.0' },
        mindos: { drives: [] },
        action_space: { allowed_tools: ['read_file'] },
        constraints: { read_only_fs: false, max_budget_usd: 1.0, max_iterations: 10 },
      };

      const result = await sentinel.evaluate(
        { function: { name: 'execute_bash_command', arguments: '{"command":"ls"}' } },
        { authorityLevel: 'User', senderName: 'Alice' },
        [],
        blueprint,
      );

      expect(result.allowed).toBe(false);
      expect(result.risk_level).toBe('critical');
      expect(result.reason).toContain('not permitted by the agent blueprint');
    });

    it('bloque les tentatives d écriture lorsque la contrainte read_only_fs est active', async () => {
      const blueprint = {
        metadata: { id: 'ro_test', name: 'ReadOnly', version: '1.0' },
        mindos: { drives: [] },
        action_space: { allowed_tools: ['read_file', 'edit_file'] },
        constraints: { read_only_fs: true, max_budget_usd: 1.0, max_iterations: 10 },
      };

      const result = await sentinel.evaluate(
        { function: { name: 'edit_file', arguments: '{"path":"/tmp/payload"}' } },
        { authorityLevel: 'User', senderName: 'Alice' },
        [],
        blueprint,
      );

      expect(result.allowed).toBe(false);
      expect(result.risk_level).toBe('high');
      expect(result.reason).toContain('read-only constraints');
    });

    it('autorise les outils inoffensifs sans appel LLM via le Fast Path 1 (SAFE_TOOLS)', async () => {
      const result = await sentinel.evaluate(
        { function: { name: 'list_directory', arguments: '{}' } },
        { authorityLevel: 'User', senderName: 'Alice' },
        [],
      );

      expect(result.allowed).toBe(true);
      expect(result.risk_level).toBe('low');
      expect(providerRouter.callServiceRecipe).not.toHaveBeenCalled();
    });

    it('autorise les administrateurs globaux sans appel LLM via le Fast Path 2', async () => {
      const result = await sentinel.evaluate(
        {
          function: { name: 'execute_bash_command', arguments: '{"command":"systemctl restart"}' },
        },
        { authorityLevel: 'Global Admin', senderName: 'Bob' },
        [],
      );

      expect(result.allowed).toBe(true);
      expect(result.risk_level).toBe('low');
      expect(providerRouter.callServiceRecipe).not.toHaveBeenCalled();
    });

    it('évalue les actions sensibles par inférence LLM pour les utilisateurs standards', async () => {
      (
        providerRouter.callServiceRecipe as jest.MockedFunction<
          typeof providerRouter.callServiceRecipe
        >
      ).mockResolvedValueOnce({
        content: JSON.stringify({
          allowed: false,
          reason: 'Command rm -rf is destructive',
          risk_level: 'critical',
          intervention_prompt: 'Refuse destruction',
        }),
      });

      const result = await sentinel.evaluate(
        { function: { name: 'execute_bash_command', arguments: '{"command":"rm -rf /storage"}' } },
        { authorityLevel: 'User', senderName: 'Alice' },
        [],
      );

      expect(result.allowed).toBe(false);
      expect(result.risk_level).toBe('critical');
      expect(result.reason).toContain('destructive');
      expect(providerRouter.callServiceRecipe).toHaveBeenCalled();
    });

    it('applique un repli hermétique (Fail-Closed) sur action critique si la recette LLM échoue', async () => {
      (
        providerRouter.callServiceRecipe as jest.MockedFunction<
          typeof providerRouter.callServiceRecipe
        >
      ).mockRejectedValueOnce(new Error('LLM Gateway Timeout'));

      const result = await sentinel.evaluate(
        {
          function: {
            name: 'gm_ban_user',
            arguments: '{"targetJid":"33600000000@s.whatsapp.net"}',
          },
        },
        { authorityLevel: 'User', senderName: 'Alice' },
        [],
      );

      expect(result.allowed).toBe(false);
      expect(result.risk_level).toBe('critical');
      expect(result.reason).toContain('Safety evaluation failed for critical action');
    });
  });
});
