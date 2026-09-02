// src/tests/e2e/harness.test.ts
// Exhaustive Test Suite for SS-07 SubAgentEngine (Swarm / ReAct Harness)
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { SubAgentEngine } from '../../services/agentic/SubAgentEngine.js';
import { pluginLoader } from '../../plugins/loader.js';
import { providerRouter, type ChatResponse } from '../../providers/index.js';
import { blueprintManager } from '../../core/blueprint/AgentBlueprint.js';

function setupToolDefinitionsMock() {
  jest.spyOn(pluginLoader, 'getToolDefinitions').mockReturnValue([
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Lit un fichier',
        parameters: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Écrit un fichier',
        parameters: {
          type: 'object',
          properties: { file_path: { type: 'string' }, content: { type: 'string' } },
          required: ['file_path', 'content'],
        },
      },
    },
  ]);
}

describe('SubAgentEngine Lifecycle (SS-07: ReAct Core Branches)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupToolDefinitionsMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Branche 1 : Résolution nominale en 1 itération sans appel d outil', async () => {
    jest.spyOn(providerRouter, 'chat').mockResolvedValueOnce({
      content: '<thought>Réflexion interne</thought>Rapport direct terminé avec succès.',
      toolCalls: [],
    } as ChatResponse);

    const engine = new SubAgentEngine({
      name: 'DirectWorker',
      systemPrompt: 'Résous la tâche directement.',
      allowedTools: ['read_file'],
      maxIterations: 5,
    });

    const result = await engine.run('Tâche simple', { chatId: 'c1' });

    expect(result.success).toBe(true);
    expect(result.message).toContain('[Rapport de DirectWorker] :');
    expect(result.message).toContain('Rapport direct terminé avec succès.');
    expect(result.message).not.toContain('<thought>');
  });

  it('Branche 2 : Enchaînement multi-étapes avec appel d outil réussi', async () => {
    let callCount = 0;
    jest.spyOn(providerRouter, 'chat').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: JSON.stringify({ file_path: 'config.json' }),
              },
            },
          ],
        } as ChatResponse;
      }
      return {
        content: 'Fichier lu. Données : { "port": 8080 }',
        toolCalls: [],
      } as ChatResponse;
    });

    jest.spyOn(pluginLoader, 'execute').mockResolvedValueOnce({
      success: true,
      message: 'ok',
      data: { port: 8080 },
    });

    const engine = new SubAgentEngine({
      name: 'FileReaderAgent',
      systemPrompt: 'Lis le fichier et rapporte les infos.',
      allowedTools: ['read_file'],
      maxIterations: 5,
    });

    const result = await engine.run('Lire config', { chatId: 'c1' });

    expect(result.success).toBe(true);
    expect(result.message).toContain('{ "port": 8080 }');
    expect(pluginLoader.execute).toHaveBeenCalledWith(
      'read_file',
      { file_path: 'config.json' },
      expect.any(Object),
    );
  });

  it('Branche 3 : Récupération après erreur de validation de paramètres d outil', async () => {
    let callCount = 0;
    jest.spyOn(providerRouter, 'chat').mockImplementation(async (history: unknown[]) => {
      callCount++;
      if (callCount === 1) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'call_bad',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: JSON.stringify({ wrong_param: 'foo' }),
              },
            },
          ],
        } as ChatResponse;
      }

      const msgs = history as Array<{ role: string; content: string }>;
      const errorMsg = msgs[msgs.length - 1];
      expect(errorMsg.role).toBe('tool');
      expect(errorMsg.content).toMatch(/validation failed|required|file_path/i);

      return {
        content: 'Erreur détectée et rectifiée.',
        toolCalls: [],
      } as ChatResponse;
    });

    const engine = new SubAgentEngine({
      name: 'ResilientAgent',
      systemPrompt: 'Agent résilient',
      allowedTools: ['read_file'],
      maxIterations: 3,
    });

    const result = await engine.run('Tâche avec paramètres invalides', { chatId: 'c1' });

    expect(result.success).toBe(true);
    expect(result.message).toContain('Erreur détectée et rectifiée.');
    expect(callCount).toBe(2);
  });

  it('Branche 4 : Blocage immédiat d un outil non autorisé dans allowedTools', async () => {
    let callCount = 0;
    jest.spyOn(providerRouter, 'chat').mockImplementation(async (history: unknown[]) => {
      callCount++;
      if (callCount === 1) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'call_unauthorized',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({ file_path: 'hack.sh', content: 'rm -rf /' }),
              },
            },
          ],
        } as ChatResponse;
      }

      const msgs = history as Array<{ role: string; content: string }>;
      const lastMsg = msgs[msgs.length - 1];
      expect(lastMsg.role).toBe('tool');
      expect(lastMsg.content).toContain('non autorisé pour cet agent');

      return {
        content: 'J ai pris note du refus.',
        toolCalls: [],
      } as ChatResponse;
    });

    const engine = new SubAgentEngine({
      name: 'RestrictedAgent',
      systemPrompt: 'Lecture seule',
      allowedTools: ['read_file'],
      maxIterations: 3,
    });

    const result = await engine.run('Tenter écriture', { chatId: 'c1' });

    expect(result.success).toBe(true);
    expect(result.message).toContain('J ai pris note du refus.');
  });
});

describe('SubAgentEngine Resilience (SS-07: Error Handling & Termination)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupToolDefinitionsMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Branche 5 : Limite d itérations atteinte avec conclusion forcée', async () => {
    jest.spyOn(providerRouter, 'chat').mockImplementation(async () => {
      return {
        content: 'Boucle infinie...',
        toolCalls: [
          {
            id: 'call_loop',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: JSON.stringify({ file_path: 'loop.txt' }),
            },
          },
        ],
      } as ChatResponse;
    });

    jest.spyOn(pluginLoader, 'execute').mockResolvedValue({
      success: true,
      message: 'ok',
      data: 'ok',
    });

    const engine = new SubAgentEngine({
      name: 'LoopAgent',
      systemPrompt: 'Agent bouclant',
      allowedTools: ['read_file'],
      maxIterations: 2,
    });

    const result = await engine.run('Boucler indéfiniment', { chatId: 'c1' });

    expect(result.success).toBe(true);
    expect(result.message).toContain('[Rapport de LoopAgent]');
  });

  it('Branche 6 : Gestion d exception fatale dans la boucle ReAct (Fail-Safe)', async () => {
    jest
      .spyOn(providerRouter, 'chat')
      .mockRejectedValueOnce(new Error('Modèle indisponible (503 Service Unavailable)'));

    const engine = new SubAgentEngine({
      name: 'CrashAgent',
      systemPrompt: 'Agent vulnérable',
      allowedTools: ['read_file'],
      maxIterations: 3,
    });

    const result = await engine.run('Exécuter tâche crash', { chatId: 'c1' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('[ERREUR SOUS-AGENT]');
    expect(result.message).toContain('503 Service Unavailable');
  });

  it('Branche 7 : Fork d agent avec conservation de parentHistory et nettoyage de blueprint', async () => {
    const registerSpy = jest.spyOn(blueprintManager, 'registerEphemeral');
    const cleanupSpy = jest.spyOn(blueprintManager, 'cleanupEphemeral');

    jest.spyOn(providerRouter, 'chat').mockResolvedValueOnce({
      content: 'Mission fork accomplie.',
      toolCalls: [],
    } as ChatResponse);

    const parentHistory = [
      { role: 'user', content: 'Message parent 1' },
      { role: 'assistant', content: 'Réponse parent 1' },
    ];

    const engine = new SubAgentEngine({
      name: 'ForkWorker',
      systemPrompt: 'Agent issu de fork',
      allowedTools: ['read_file'],
      parentHistory,
    });

    const result = await engine.run('Sous-tâche déléguée', { chatId: 'c1' });

    expect(result.success).toBe(true);
    expect(registerSpy).toHaveBeenCalled();
    expect(cleanupSpy).toHaveBeenCalled();
  });
});
