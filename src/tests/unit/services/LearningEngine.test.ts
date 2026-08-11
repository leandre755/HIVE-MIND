// tests/unit/services/LearningEngine.test.ts
import { describe, it, beforeEach, beforeAll, jest, expect } from '@jest/globals';

// Set dummy env vars for Supabase and Redis BEFORE any imports
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'dummy-key';
process.env.REDIS_URL = 'redis://localhost:6379';

// Define mocks for fs/promises
const mockReaddir = jest.fn<() => Promise<unknown[]>>();
const mockReadFile = jest.fn<() => Promise<string>>();

jest.unstable_mockModule('fs/promises', () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
}));

type LearningEngineModule = typeof import('../../../services/learning/LearningEngine.js');
type ProviderModule = typeof import('../../../providers/index.js');
type FactsMemoryModule = typeof import('../../../services/memory.js');
type WorkingMemoryModule = typeof import('../../../services/workingMemory.js');

let learningEngine: LearningEngineModule['learningEngine'];
let providerRouter: ProviderModule['providerRouter'];
let factsMemory: FactsMemoryModule['factsMemory'];
let workingMemory: WorkingMemoryModule['workingMemory'];

describe('LearningEngine unit tests', () => {
  beforeAll(async () => {
    // Import redis client and mock connect immediately
    const redisModule = await import('../../../services/redisClient.js');
    jest
      .spyOn(redisModule.redis as { connect: () => Promise<unknown> }, 'connect')
      .mockImplementation(async () => redisModule.redis);

    // Import the services
    const leModule = await import('../../../services/learning/LearningEngine.js');
    learningEngine = leModule.learningEngine;

    const providersModule = await import('../../../providers/index.js');
    providerRouter = providersModule.providerRouter;

    const memoryModule = await import('../../../services/memory.js');
    factsMemory = memoryModule.factsMemory;

    const wmModule = await import('../../../services/workingMemory.js');
    workingMemory = wmModule.workingMemory;
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    mockReaddir.mockReset();
    mockReadFile.mockReset();
  });

  describe('MAPLE Insights Extraction', () => {
    it('should not extract insights if conversation context is too short', async () => {
      const getContextMock = jest
        .spyOn(workingMemory, 'getContext')
        .mockImplementation(async () => {
          return [{ role: 'user' as const, content: 'hello', timestamp: 0 }];
        });

      const chatSpy = jest.spyOn(providerRouter, 'chat');

      await learningEngine.extractInsights('123@s.whatsapp.net');

      expect(getContextMock).toHaveBeenCalledTimes(1);
      expect(chatSpy).not.toHaveBeenCalled();
    });

    it('should parse LLM JSON response and remember insights using MAPLE taxonomy', async () => {
      const mockContext = [
        { role: 'user' as const, content: 'Je suis un développeur Senior React.', timestamp: 0 },
        {
          role: 'assistant' as const,
          content: 'Super ! Comment puis-je vous aider ?',
          timestamp: 1,
        },
        {
          role: 'user' as const,
          content: 'Je préfère les explications très courtes.',
          timestamp: 2,
        },
        { role: 'assistant' as const, content: "D'accord.", timestamp: 3 },
        { role: 'user' as const, content: "Mon objectif est d'apprendre Go.", timestamp: 4 },
      ];

      const getContextMock = jest
        .spyOn(workingMemory, 'getContext')
        .mockImplementation(async () => {
          return mockContext;
        });

      const mockLLMResponse = {
        content: `\`\`\`json
[
  {"type": "fact", "key": "role", "value": "Senior React Developer"},
  {"type": "pref", "key": "tone", "value": "very short explanations"},
  {"type": "goal", "key": "learn", "value": "learn Go"}
]
\`\`\``,
      };

      const chatMock = jest.spyOn(providerRouter, 'chat').mockImplementation(async () => {
        return mockLLMResponse;
      });

      const rememberMock = jest.spyOn(factsMemory, 'remember').mockImplementation(async () => {
        return;
      });

      await learningEngine.extractInsights('123@s.whatsapp.net');

      expect(getContextMock).toHaveBeenCalledTimes(1);
      expect(chatMock).toHaveBeenCalledTimes(1);
      expect(rememberMock).toHaveBeenCalledTimes(3);

      expect(rememberMock).toHaveBeenNthCalledWith(
        1,
        '123@s.whatsapp.net',
        'fact:role',
        'Senior React Developer',
      );
      expect(rememberMock).toHaveBeenNthCalledWith(
        2,
        '123@s.whatsapp.net',
        'pref:tone',
        'very short explanations',
      );
      expect(rememberMock).toHaveBeenNthCalledWith(
        3,
        '123@s.whatsapp.net',
        'goal:learn',
        'learn Go',
      );
    });
  });

  describe('Skill System Routing & Advisory', () => {
    it('should retrieve all expert skills excluding survival skills', async () => {
      mockReaddir.mockResolvedValue([
        { isDirectory: () => true, name: 'theme-factory' },
        { isDirectory: () => true, name: 'survival' },
      ] as unknown[]);

      mockReadFile.mockResolvedValue(`---
name: theme-factory
description: "A skill to style artifacts with beautiful themes"
---
Instruction detail here.`);

      const skills = await learningEngine.getAllExpertSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('theme-factory');
      expect(skills[0].description).toBe('A skill to style artifacts with beautiful themes');
      expect(skills[0].path).toContain('skills/theme-factory/SKILL.md');
      expect(skills[0].yamlBlock).toContain('path: "skills/theme-factory/SKILL.md"');
    });

    it('should return null if no expert skills match the user message sementically', async () => {
      mockReaddir.mockResolvedValue([
        { isDirectory: () => true, name: 'theme-factory' },
      ] as unknown[]);

      mockReadFile.mockResolvedValue(`---
name: theme-factory
description: "A skill to style artifacts with beautiful themes"
---`);

      const chatMock = jest.spyOn(providerRouter, 'chat').mockImplementation(async () => {
        return { content: '{"selected_skill": null}' };
      });

      const result = await learningEngine.routeSkills('Dis-moi bonjour', '123@s.whatsapp.net');

      expect(result).toBeNull();
      expect(chatMock).toHaveBeenCalledTimes(1);
    });

    it('should route user message to theme-factory and retrieve user guidelines', async () => {
      mockReaddir.mockResolvedValue([
        { isDirectory: () => true, name: 'theme-factory' },
      ] as unknown[]);

      mockReadFile.mockResolvedValue(`---
name: theme-factory
description: "A skill to style artifacts with beautiful themes"
---`);

      const chatMock = jest
        .spyOn(providerRouter, 'chat')
        .mockImplementationOnce(async () => {
          return { content: '{"selected_skill": "theme-factory"}' };
        })
        .mockImplementationOnce(async () => {
          return { content: '["user dark theme is better in this situation, do ..."]' };
        });

      const getAllFactsMock = jest.spyOn(factsMemory, 'getAll').mockImplementation(async () => {
        return {
          'pref:theme': 'dark mode',
          'fact:some': 'irrelevant fact',
        };
      });

      const result = await learningEngine.routeSkills(
        'Génère un thème sombre',
        '123@s.whatsapp.net',
      );

      expect(result).not.toBeNull();
      expect(result!.yamlBlock).toContain('name: theme-factory');
      expect(result!.comments).toEqual(['user dark theme is better in this situation, do ...']);
      expect(getAllFactsMock).toHaveBeenCalledTimes(1);
      expect(chatMock).toHaveBeenCalledTimes(2);
    });
  });
});
