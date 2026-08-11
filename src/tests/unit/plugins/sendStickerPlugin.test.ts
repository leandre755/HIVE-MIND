import { jest, describe, beforeEach, beforeAll, it, expect } from '@jest/globals';

// ─── Test fixtures ──────────────────────────────────────────────────────────

const STICKER_FILES = [
  'bravo__applaudissement_felicitation_cynique__homme_jaune_applaudissant.webp',
  'rire__mdr_lol_drole__chat_qui_rit.webp',
  'triste__pleure_decu_melancolie__bonhomme_larme.webp',
  'ok__accord_valide_pouce__pouce_en_haut.webp',
  'colere__enerve_furieux_rage__personnage_rouge.webp',
];

// ─── Mock fs/promises to use our test directory ─────────────────────────────

// WHY: We need to override STICKERS_DIR which is a const computed at module load.
// We mock readdir and readFile to point to our test fixtures.
jest.unstable_mockModule('fs/promises', () => ({
  readdir: jest.fn<() => Promise<Awaited<ReturnType<typeof readdir>>>>(),
  readFile: jest.fn<() => Promise<Buffer>>(),
}));

let readdir: typeof import('fs/promises').readdir;
let readFile: typeof import('fs/promises').readFile;
let SendStickerPlugin: typeof import('../../../plugins/tools/send_sticker/index.js').default;

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockTransport() {
  return {
    sendSticker: jest.fn<(chatId: string, buffer: Buffer) => Promise<object>>(async () => ({})),
  };
}

function buildContext(transport = mockTransport()) {
  return { transport, chatId: 'test-chat@g.us' };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('SendStickerPlugin — Metadata & Init', () => {
  beforeAll(async () => {
    const fsMod = await import('fs/promises');
    readdir = fsMod.readdir;
    readFile = fsMod.readFile;
    const stickerMod = await import('../../../plugins/tools/send_sticker/index.js');
    SendStickerPlugin = stickerMod.default;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('plugin metadata', () => {
    it('should have correct name and version', () => {
      expect(SendStickerPlugin.name).toBe('send_sticker');
      expect(SendStickerPlugin.version).toBe('1.0.0');
      expect(SendStickerPlugin.enabled).toBe(true);
    });

    it('should have a toolDefinition with function schema', () => {
      const def = SendStickerPlugin.toolDefinition as {
        type: string;
        function: { name: string; parameters: { properties: Record<string, unknown> } };
      };
      expect(def.type).toBe('function');
      expect(def.function.name).toBe('send_sticker');
      expect(def.function.parameters.properties).toHaveProperty('intent');
      expect(def.function.parameters.properties).toHaveProperty('sticker_name');
    });
  });

  describe('init()', () => {
    it('should load stickers from directory and build tag cloud', async () => {
      // Arrange
      (readdir as jest.MockedFunction<typeof readdir>).mockResolvedValue(
        STICKER_FILES as unknown as Awaited<ReturnType<typeof readdir>>,
      );

      // Act
      await SendStickerPlugin.init();

      // Assert
      const def = SendStickerPlugin.toolDefinition as {
        function: { description: string };
      };
      expect(def.function.description).toContain('Available moods:');
      expect(def.function.description).toContain('applaudissement');
      expect(def.function.description).toContain('mdr');
      expect(def.function.description).toContain('pleure');
    });

    it('should handle missing stickers directory gracefully', async () => {
      // Arrange
      (readdir as jest.MockedFunction<typeof readdir>).mockRejectedValue(
        new Error('ENOENT: no such file or directory'),
      );

      // Act — should NOT throw
      await SendStickerPlugin.init();

      // Assert
      const def = SendStickerPlugin.toolDefinition as {
        function: { description: string };
      };
      expect(def.function.description).toContain('No stickers loaded yet');
    });

    it('should ignore non-supported file extensions', async () => {
      // Arrange
      (readdir as jest.MockedFunction<typeof readdir>).mockResolvedValue([
        'readme.txt',
        'notes.md',
        'valid__tag__desc.webp',
      ] as unknown as Awaited<ReturnType<typeof readdir>>);

      // Act
      await SendStickerPlugin.init();

      // Assert — only 1 sticker (the .webp one)
      const def = SendStickerPlugin.toolDefinition as {
        function: { description: string };
      };
      expect(def.function.description).toContain('tag');
    });
  });
});

describe('SendStickerPlugin — Execution Modes', () => {
  beforeAll(async () => {
    const fsMod = await import('fs/promises');
    readdir = fsMod.readdir;
    readFile = fsMod.readFile;
    const stickerMod = await import('../../../plugins/tools/send_sticker/index.js');
    SendStickerPlugin = stickerMod.default;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('execute() — search mode', () => {
    beforeEach(async () => {
      (readdir as jest.MockedFunction<typeof readdir>).mockResolvedValue(
        STICKER_FILES as unknown as Awaited<ReturnType<typeof readdir>>,
      );
      await SendStickerPlugin.init();
    });

    it('should return top matches when intent is provided', async () => {
      // Act
      const result = await SendStickerPlugin.execute({ intent: 'rire' }, buildContext());

      // Assert
      expect(result.success).toBe(true);
      expect(result.matches).toBeDefined();
      expect(result.matches!.length).toBeGreaterThanOrEqual(1);
      expect(result.matches![0].id).toBe('rire');
    });

    it('should return multiple matches for broad queries', async () => {
      // Act — "drole" matches "rire" sticker
      const result = await SendStickerPlugin.execute({ intent: 'drole' }, buildContext());

      // Assert
      expect(result.success).toBe(true);
      expect(result.matches).toBeDefined();
      expect(result.matches!.some((m: { id: string }) => m.id === 'rire')).toBe(true);
    });

    it('should return failure with available moods when no match found', async () => {
      // Act
      const result = await SendStickerPlugin.execute(
        { intent: 'xyztotallyrandom' },
        buildContext(),
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('No stickers match');
      expect(result.message).toContain('Available moods:');
    });

    it('should return failure when catalog is empty', async () => {
      // Arrange — reinit with empty directory
      (readdir as jest.MockedFunction<typeof readdir>).mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof readdir>>,
      );
      await SendStickerPlugin.init();

      // Act
      const result = await SendStickerPlugin.execute({ intent: 'bravo' }, buildContext());

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('No stickers available');
    });
  });

  describe('execute() — send mode', () => {
    beforeEach(async () => {
      (readdir as jest.MockedFunction<typeof readdir>).mockResolvedValue(
        STICKER_FILES as unknown as Awaited<ReturnType<typeof readdir>>,
      );
      await SendStickerPlugin.init();
    });

    it('should send sticker when exact sticker_name is provided', async () => {
      // Arrange
      const fakeBuffer = Buffer.from('fake-sticker-data');
      (readFile as jest.MockedFunction<typeof readFile>).mockResolvedValue(fakeBuffer);
      const transport = mockTransport();

      // Act
      const result = await SendStickerPlugin.execute(
        { sticker_name: 'bravo' },
        buildContext(transport),
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('Sticker "bravo" sent');
      expect(transport.sendSticker).toHaveBeenCalledTimes(1);
      expect(transport.sendSticker).toHaveBeenCalledWith('test-chat@g.us', fakeBuffer);
    });

    it('should return fuzzy suggestions when sticker_name not found', async () => {
      // Act — "applaudir" is not an exact ID, but should fuzzy match "bravo" via tags
      const result = await SendStickerPlugin.execute(
        { sticker_name: 'applaudissement' },
        buildContext(),
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
      expect(result.matches).toBeDefined();
      expect(result.matches!.some((m: { id: string }) => m.id === 'bravo')).toBe(true);
    });

    it('should return error when sticker_name not found and no fuzzy matches', async () => {
      // Act
      const result = await SendStickerPlugin.execute(
        { sticker_name: 'xyztotallyrandom' },
        buildContext(),
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
      expect(result.matches).toBeUndefined();
    });

    it('should handle readFile errors gracefully', async () => {
      // Arrange
      (readFile as jest.MockedFunction<typeof readFile>).mockRejectedValue(
        new Error('EACCES: permission denied'),
      );

      // Act
      const result = await SendStickerPlugin.execute({ sticker_name: 'bravo' }, buildContext());

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to send sticker');
      expect(result.message).toContain('permission denied');
    });

    it('should handle transport.sendSticker errors gracefully', async () => {
      // Arrange
      (readFile as jest.MockedFunction<typeof readFile>).mockResolvedValue(Buffer.from('data'));
      const transport = mockTransport();
      transport.sendSticker.mockRejectedValue(new Error('Socket not initialized'));

      // Act
      const result = await SendStickerPlugin.execute(
        { sticker_name: 'bravo' },
        buildContext(transport),
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to send sticker');
    });
  });

  describe('execute() — edge cases', () => {
    it('should return error when no arguments provided', async () => {
      const result = await SendStickerPlugin.execute({}, buildContext());
      expect(result.success).toBe(false);
      expect(result.message).toContain('Provide either');
    });

    it('should return error when transport is missing', async () => {
      const result = await SendStickerPlugin.execute({ intent: 'bravo' }, { chatId: 'test@g.us' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('Transport or chatId missing');
    });

    it('should return error when chatId is missing', async () => {
      const result = await SendStickerPlugin.execute(
        { intent: 'bravo' },
        { transport: mockTransport() },
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain('Transport or chatId missing');
    });

    it('should prioritize sticker_name over intent when both provided', async () => {
      // Arrange
      (readdir as jest.MockedFunction<typeof readdir>).mockResolvedValue(
        STICKER_FILES as unknown as Awaited<ReturnType<typeof readdir>>,
      );
      await SendStickerPlugin.init();
      const fakeBuffer = Buffer.from('data');
      (readFile as jest.MockedFunction<typeof readFile>).mockResolvedValue(fakeBuffer);
      const transport = mockTransport();

      // Act — both provided, sticker_name wins
      const result = await SendStickerPlugin.execute(
        { sticker_name: 'bravo', intent: 'triste' },
        buildContext(transport),
      );

      // Assert — sent "bravo", not searched "triste"
      expect(result.success).toBe(true);
      expect(result.message).toContain('bravo');
      expect(transport.sendSticker).toHaveBeenCalledTimes(1);
    });
  });
});
