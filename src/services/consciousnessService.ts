// services/consciousnessService.js
// LE MODULE DE CONSCIENCE (Global Workspace) - 2026 Architecture
// Centralise : Identité, Émotions (Annoyance), Mission, et État cognitif.

import { redis } from './redisClient.js';
import { extractNumericId } from '../utils/jidHelper.js';
import { userService } from './userService.js';
import { botIdentity } from '../utils/botIdentity.js';

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

interface BotIdentity {
  name: string;
  jid: string | null;
  lid: string | null;
  phoneNumber: string | null;
}

interface MemoryItem {
  content: string;
}

interface BotMissionResult {
  title: string | null;
  description: string | null;
  author: string | null;
}

interface GlobalState {
  identity: BotIdentity;
  emotionalState: { annoyance: number; mood: string };
  mission: BotMissionResult | null;
  activeMemory: string[];
  uptime: number;
}

// Le nom du persona est extrait dynamiquement via botIdentity (depuis system.md)
const personaName = botIdentity.fullName;

class ConsciousnessService {
  identity: BotIdentity;
  startTime: number;

  constructor() {
    this.identity = {
      name: 'HIVE-MIND',
      jid: null,
      lid: null,
      phoneNumber: null,
    };
    this.startTime = Date.now();
  }

  /**
   * Initialise l'identité du bot (Appelé par le transport au démarrage)
   */
  async setIdentity(user: { id: string; lid?: string } | null) {
    if (!user) return;

    this.identity.phoneNumber = extractNumericId(user.id);
    this.identity.jid = `${this.identity.phoneNumber}@s.whatsapp.net`;
    this.identity.lid = user.lid ?? null;
    this.identity.name = personaName;

    console.log(`[Consciousness] 🧠 JE SUIS : ${this.identity.name} (${this.identity.jid})`);

    try {
      const existing = await userService.getProfile(this.identity.jid);
      if (existing && existing.interaction_count > 0) {
        console.log('[Consciousness] ✅ Identité déjà présente en DB.');
      } else {
        await userService.recordInteraction(this.identity.jid, this.identity.name);
        console.log('[Consciousness] ✅ Identité enregistrée dans la DB User.');
      }
    } catch (error: unknown) {
      console.error('[Consciousness] ❌ Erreur enregistrement DB:', extractErrorMessage(error));
    }
  }

  /**
   * Récupère l'état global de la conscience pour un chat donné
   * C'est le "snapshot" de l'esprit du bot à l'instant T
   */
  async getGlobalState(chatId: string, senderJid: string): Promise<GlobalState> {
    const annoyance = await this.getAnnoyance(chatId, senderJid);

    let mission: BotMissionResult | null = null;
    if (chatId.endsWith('@g.us')) {
      const { groupService } = await import('./groupService.js');
      mission = await groupService.getBotMission(chatId);
    }

    let recentMemories: MemoryItem[] = [];
    try {
      const { semanticMemory } = await import('./memory.js');
      recentMemories = (await semanticMemory.recall(chatId, 'contexte actuel', 3)) as MemoryItem[];
    } catch {
      /* Ignore */
    }

    return {
      identity: this.identity,
      emotionalState: {
        annoyance,
        mood: this._deriveMood(annoyance),
      },
      mission,
      activeMemory: recentMemories.map((m) => m.content),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  /**
   * Déduit l'humeur du score d'agacement
   */
  _deriveMood(annoyance: number): string {
    if (annoyance > 80) return 'FURIEUX 🤬';
    if (annoyance > 50) return 'AGACÉ 😤';
    if (annoyance > 20) return 'DÉRANGÉ 😒';
    return 'CALME 😌';
  }

  // =================================================================
  // MIGRATION EMOTIONAL ENGINE (Depuis workingMemory)
  // =================================================================

  /**
   * Met à jour le niveau d'agacement
   */
  async updateAnnoyance(chatId: string, userId: string, delta: number): Promise<number> {
    try {
      if (!redis.isReady) return 0;

      const key = `consciousness:${chatId}:${userId}:annoyance`;
      const oldKey = `emotion:${chatId}:${userId}:annoyance`;
      let current = 0;

      const oldVal = await redis.get(oldKey);
      if (oldVal) {
        current = parseInt(oldVal);
        await redis.del(oldKey);
      } else {
        current = parseInt((await redis.get(key)) || '0');
      }

      const newValue = Math.max(0, Math.min(100, current + delta));

      if (newValue === 0) {
        await redis.del(key);
      } else {
        await redis.set(key, newValue.toString(), { EX: 3600 });
      }

      if (Math.abs(newValue - current) >= 10 || newValue > 50) {
        console.log(
          `[Consciousness] 🧠 Emotion Shift (${userId.split('@')[0]}): ${current} -> ${newValue} (${this._deriveMood(newValue)})`,
        );
      }

      return newValue;
    } catch (error: unknown) {
      console.error('[Consciousness] updateAnnoyance error:', extractErrorMessage(error));
      return 0;
    }
  }

  /**
   * Récupère le niveau d'agacement
   */
  async getAnnoyance(chatId: string, userId: string): Promise<number> {
    try {
      if (!redis.isReady) return 0;
      const key = `consciousness:${chatId}:${userId}:annoyance`;
      const val = await redis.get(key);

      if (!val) {
        const oldKey = `emotion:${chatId}:${userId}:annoyance`;
        const oldVal = await redis.get(oldKey);
        if (oldVal) return parseInt(oldVal);
      }

      return val ? parseInt(val) : 0;
    } catch {
      return 0;
    }
  }
}

export const consciousness = new ConsciousnessService();
export default consciousness;
