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

  it('ne classe pas une URL malveillante comme WhatsApp même si elle contient @whatsapp.net dans le chemin', async () => {
    const spy = jest.spyOn(db, 'resolveUser').mockResolvedValueOnce('uuid-cli-user');

    const maliciousUrl = 'https://evil.example/path/@whatsapp.net';
    const context = await db.resolveContextFromLegacyId(maliciousUrl);
    expect(spy).toHaveBeenCalledWith('cli', maliciousUrl);
    expect(context).toEqual({ context_id: 'uuid-cli-user', type: 'user' });
  });

  it('ne classe pas un domaine malveillant se terminant par .evil.com comme WhatsApp', async () => {
    const spy = jest.spyOn(db, 'resolveUser').mockResolvedValueOnce('uuid-cli-user');

    const maliciousDomain = 'https://whatsapp.net.evil.com';
    const context = await db.resolveContextFromLegacyId(maliciousDomain);
    expect(spy).toHaveBeenCalledWith('cli', maliciousDomain);
    expect(context).toEqual({ context_id: 'uuid-cli-user', type: 'user' });
  });
});
