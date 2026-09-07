import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Configuration de l'environnement test avant import
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'dummy';
process.env.NODE_ENV = 'test';

const { db } = await import('../../../services/supabase.js');

describe('db.resolveContextFromLegacyId (SS-18: Multi-Tier Memory / Supabase)', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('retourne null si le legacyId est vide ou non défini', async () => {
    const result = await db.resolveContextFromLegacyId('');
    expect(result).toBeNull();
  });

  it('résout un utilisateur WhatsApp (@s.whatsapp.net) en appelant resolveUser', async () => {
    const spy = jest.spyOn(db, 'resolveUser').mockResolvedValueOnce('uuid-user-wa');

    const context = await db.resolveContextFromLegacyId('33612345678@s.whatsapp.net');
    expect(spy).toHaveBeenCalledWith('whatsapp', '33612345678@s.whatsapp.net');
    expect(context).toEqual({ context_id: 'uuid-user-wa', type: 'user' });
  });

  it('résout un groupe WhatsApp (@g.us) en appelant resolveGroup', async () => {
    const spy = jest.spyOn(db, 'resolveGroup').mockResolvedValueOnce('uuid-group-wa');

    const context = await db.resolveContextFromLegacyId('120363123456789@g.us');
    expect(spy).toHaveBeenCalledWith('whatsapp', '120363123456789@g.us');
    expect(context).toEqual({ context_id: 'uuid-group-wa', type: 'group' });
  });

  it('résout un salon Discord comme groupe', async () => {
    const spy = jest.spyOn(db, 'resolveGroup').mockResolvedValueOnce('uuid-channel-discord');

    const context = await db.resolveContextFromLegacyId('discord-channel-12345');
    expect(spy).toHaveBeenCalledWith('discord', 'discord-channel-12345');
    expect(context).toEqual({ context_id: 'uuid-channel-discord', type: 'group' });
  });

  it('résout un utilisateur Telegram comme user', async () => {
    const spy = jest.spyOn(db, 'resolveUser').mockResolvedValueOnce('uuid-user-tg');

    const context = await db.resolveContextFromLegacyId('telegram_user_99');
    expect(spy).toHaveBeenCalledWith('telegram', 'telegram_user_99');
    expect(context).toEqual({ context_id: 'uuid-user-tg', type: 'user' });
  });

  it.each([
    {
      description: 'une URL malveillante avec @whatsapp.net dans le chemin',
      input: 'https://evil.example/path/@whatsapp.net',
    },
    {
      description: 'un domaine malveillant se terminant par .evil.com',
      input: 'https://whatsapp.net.evil.com',
    },
    {
      description: 'un chemin relatif de type hôte (whatsapp.net/path)',
      input: 'whatsapp.net/path',
    },
    {
      description: 'un identifiant avec plusieurs @ (bad@actor@s.whatsapp.net)',
      input: 'bad@actor@s.whatsapp.net',
    },
    {
      description: 'une URL avec identifiants utilisateur (https://evil@whatsapp.net/path)',
      input: 'https://evil@whatsapp.net/path',
    },
    {
      description: 'un courriel standard ou domaine tiers (evil@example.com)',
      input: 'evil@example.com',
    },
    {
      description:
        'un sous-domaine arbitraire se terminant par whatsapp.net (user@attacker.whatsapp.net)',
      input: 'user@attacker.whatsapp.net',
    },
  ])('ne classe pas $description comme WhatsApp et résout en CLI', async ({ input }) => {
    const spy = jest.spyOn(db, 'resolveUser').mockResolvedValueOnce('uuid-cli-user');

    const context = await db.resolveContextFromLegacyId(input);
    expect(spy).toHaveBeenCalledWith('cli', input);
    expect(context).toEqual({ context_id: 'uuid-cli-user', type: 'user' });
  });

  it('résout un JID WhatsApp multi-device valide (33612345678:12@s.whatsapp.net) en appelant resolveUser', async () => {
    const spy = jest.spyOn(db, 'resolveUser').mockResolvedValueOnce('uuid-user-wa');

    const input = '33612345678:12@s.whatsapp.net';
    const context = await db.resolveContextFromLegacyId(input);
    expect(spy).toHaveBeenCalledWith('whatsapp', input);
    expect(context).toEqual({ context_id: 'uuid-user-wa', type: 'user' });
  });

  it.each([
    {
      description: 'avec tiret (123456789-987654@g.us)',
      input: '123456789-987654@g.us',
    },
    {
      description: 'avec domaine en majuscules (120363123456789@G.US)',
      input: '120363123456789@G.US',
    },
    {
      description: 'avec préfixe chat_ (chat_group_123@g.us)',
      input: 'chat_group_123@g.us',
    },
  ])(
    'résout un JID de groupe WhatsApp $description en appelant resolveGroup',
    async ({ input }) => {
      const spy = jest.spyOn(db, 'resolveGroup').mockResolvedValueOnce('uuid-group-wa');

      const context = await db.resolveContextFromLegacyId(input);
      expect(spy).toHaveBeenCalledWith('whatsapp', input);
      expect(context).toEqual({ context_id: 'uuid-group-wa', type: 'group' });
    },
  );

  it.each([
    {
      description: 'un JID utilisateur WhatsApp avec tiret (user-123@s.whatsapp.net)',
      input: 'user-123@s.whatsapp.net',
    },
    {
      description: 'un JID utilisateur WhatsApp avec préfixe chat_ (chat_support@s.whatsapp.net)',
      input: 'chat_support@s.whatsapp.net',
    },
    {
      description:
        'un JID utilisateur WhatsApp avec tiret et préfixe chat- (chat-ops@s.whatsapp.net)',
      input: 'chat-ops@s.whatsapp.net',
    },
    {
      description:
        'un JID utilisateur WhatsApp avec tiret et préfixe chat- (chat-admin@s.whatsapp.net)',
      input: 'chat-admin@s.whatsapp.net',
    },
    {
      description:
        'un JID utilisateur WhatsApp avec tiret et underscore (my_user-name@s.whatsapp.net)',
      input: 'my_user-name@s.whatsapp.net',
    },
    {
      description:
        'un JID utilisateur WhatsApp multi-device avec tiret (user-name:1@s.whatsapp.net)',
      input: 'user-name:1@s.whatsapp.net',
    },
    {
      description:
        'un JID utilisateur WhatsApp multi-device avec underscore (user_bob:1@s.whatsapp.net)',
      input: 'user_bob:1@s.whatsapp.net',
    },
    {
      description:
        'un JID utilisateur WhatsApp multi-device avec préfixe chat_ (chat_user:2@s.whatsapp.net)',
      input: 'chat_user:2@s.whatsapp.net',
    },
    {
      description: 'un JID utilisateur WhatsApp avec tiret en majuscules (USER-123@S.WHATSAPP.NET)',
      input: 'USER-123@S.WHATSAPP.NET',
    },
  ])(
    'résout $description comme utilisateur WhatsApp en appelant resolveUser',
    async ({ input }) => {
      const spy = jest.spyOn(db, 'resolveUser').mockResolvedValueOnce('uuid-user-wa');

      const context = await db.resolveContextFromLegacyId(input);
      expect(spy).toHaveBeenCalledWith('whatsapp', input);
      expect(context).toEqual({ context_id: 'uuid-user-wa', type: 'user' });
    },
  );

  it.each([
    {
      description: 'un identifiant CLI avec tiret (my-group) comme groupe',
      input: 'my-group',
      expectedType: 'group',
      expectedFn: 'resolveGroup',
      mockId: 'uuid-cli-group',
    },
    {
      description: 'un identifiant CLI avec préfixe chat_ (chat_room) comme groupe',
      input: 'chat_room',
      expectedType: 'group',
      expectedFn: 'resolveGroup',
      mockId: 'uuid-cli-group',
    },
    {
      description: 'un identifiant CLI utilisateur standard sans tiret ni chat_ (alice) comme user',
      input: 'alice',
      expectedType: 'user',
      expectedFn: 'resolveUser',
      mockId: 'uuid-cli-user',
    },
  ])('résout $description sur CLI', async ({ input, expectedType, expectedFn, mockId }) => {
    const spy = jest
      .spyOn(db, expectedFn as 'resolveGroup' | 'resolveUser')
      .mockResolvedValueOnce(mockId);

    const context = await db.resolveContextFromLegacyId(input);
    expect(spy).toHaveBeenCalledWith('cli', input);
    expect(context).toEqual({ context_id: mockId, type: expectedType });
  });
});
