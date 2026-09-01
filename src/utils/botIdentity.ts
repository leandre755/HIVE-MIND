/**
 * utils/botIdentity.ts
 * Module de gestion de l'identité du bot (nom, variantes, détection)
 * Centralise le nom et génère automatiquement les variantes
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { safeReadFileSync } from './safeFs.js';

const currentDir = dirname(fileURLToPath(import.meta.url));

export interface BotProfile {
  name: string;
  [key: string]: unknown;
}

interface PhoneticRule {
  from: RegExp;
  to: string;
}

/**
 * Classe de gestion de l'identité du bot
 */
export class BotIdentity {
  private _profile: BotProfile | null = null;
  private _nameParts: string[] = [];
  private _textVariants: string[] = [];
  private _vocalVariants: string[] = [];

  constructor() {}

  /**
   * Extrait le nom dynamiquement depuis system.md
   */
  private _loadProfile(): BotProfile {
    if (this._profile) return this._profile;

    let botName = 'HIVE-MIND'; // Fallback
    try {
      const promptPath = join(currentDir, '..', 'persona', 'prompts', 'system.md');
      const promptContent = safeReadFileSync(promptPath, 'utf-8');

      // Extraction dynamique via la balise XML <name>
      const nameMatch = promptContent.match(/<name>([\s\S]*?)<\/name>/);
      if (nameMatch && nameMatch[1]) {
        botName = nameMatch[1].trim();
      }
    } catch (e) {
      console.warn('[BotIdentity] Erreur lecture system.md pour extraire le nom:', e);
    }

    this._profile = {
      name: botName,
    };

    return this._profile;
  }

  /**
   * Retourne le nom complet du bot
   */
  public get fullName(): string {
    const profile = this._loadProfile();
    return profile.name || 'Bot';
  }

  /**
   * Retourne les parties du nom (max 2 mots)
   * Ex: "Erina Nakiri" → ["Erina", "Nakiri"]
   */
  public get nameParts(): string[] {
    if (this._nameParts.length > 0) return this._nameParts;

    const parts = this.fullName.split(/\s+/).slice(0, 2);
    this._nameParts = parts.filter((p) => p.length > 0);
    return this._nameParts;
  }

  /**
   * Retourne le prénom (premier mot du nom)
   */
  public get firstName(): string {
    return this.nameParts[0] || 'Bot';
  }

  /**
   * Retourne le nom de famille (second mot)
   */
  public get lastName(): string | null {
    return this.nameParts[1] || null;
  }

  /**
   * Génère les variantes textuelles pour la détection de mention
   */
  public get textVariants(): string[] {
    if (this._textVariants.length > 0) return this._textVariants;

    const variants = new Set<string>();

    // Ajouter chaque partie du nom
    for (const part of this.nameParts) {
      variants.add(part);
      variants.add(part.toLowerCase());
    }

    // Ajouter le nom complet
    variants.add(this.fullName);
    variants.add(this.fullName.toLowerCase());

    this._textVariants = Array.from(variants);
    return this._textVariants;
  }

  /**
   * Génère les variantes vocales (pour la transcription STT)
   */
  public get vocalVariants(): string[] {
    if (this._vocalVariants.length > 0) return this._vocalVariants;

    const variants = new Set<string>();

    // Ajouter les variantes textuelles de base
    for (const v of this.textVariants) {
      variants.add(v.toLowerCase());
    }

    // Générer des variantes phonétiques pour chaque partie
    for (const part of this.nameParts) {
      const generated = this._generatePhoneticVariants(part);
      for (const g of generated) {
        variants.add(g.toLowerCase());
      }
    }

    this._vocalVariants = Array.from(variants);
    return this._vocalVariants;
  }

  /**
   * Génère des variantes phonétiques d'un mot
   */
  private _generatePhoneticVariants(word: string): string[] {
    const variants = new Set<string>([word.toLowerCase()]);
    const lower = word.toLowerCase();

    // Règles de transformation phonétique (erreurs courantes STT)
    const rules: PhoneticRule[] = [
      { from: /e/g, to: 'a' },
      { from: /i/g, to: 'e' },
      { from: /a/g, to: 'e' },
      { from: /r/g, to: 'l' },
      { from: /n/g, to: 'm' },
      { from: /(.)(.)/, to: '$1 $2' }, // "Erina" → "Er ina"
      { from: /a$/, to: 'ah' },
      { from: /i$/, to: 'y' },
      { from: /e$/, to: 'é' },
      { from: /(.)\1/, to: '$1' }, // "Anna" → "Ana"
    ];

    // Appliquer chaque règle
    for (const rule of rules) {
      const newVariant = lower.replace(rule.from, rule.to);
      if (newVariant !== lower && newVariant.length > 2) {
        variants.add(newVariant);
      }
    }

    // Variantes avec espaces (erreur de transcription)
    if (lower.length > 4) {
      const mid = Math.floor(lower.length / 2);
      variants.add(lower.slice(0, mid) + ' ' + lower.slice(mid));
    }

    // Préfixe "et" (erreur courante: "et Rina" au lieu de "Erina")
    if (lower.startsWith('e')) {
      variants.add('et ' + lower.slice(1));
    }

    return Array.from(variants);
  }

  /**
   * Vérifie si un texte mentionne le bot (textuel)
   */
  public isMentioned(text: string | null | undefined): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    return this.textVariants.some((v) => lower.includes(v.toLowerCase()));
  }

  /**
   * Vérifie si une transcription vocale mentionne le bot
   */
  public isVocallyMentioned(transcription: string | null | undefined): boolean {
    if (!transcription) return false;
    const lower = transcription.toLowerCase();
    return this.vocalVariants.some((v) => lower.includes(v));
  }

  /**
   * Retourne le profil complet
   */
  public get profile(): BotProfile {
    return this._loadProfile();
  }

  /**
   * Affiche les variantes générées (debug)
   */
  public debug(): void {
    console.log('\n[BotIdentity] Debug:');
    console.log(`  Nom complet: ${this.fullName}`);
    console.log(`  Parties: ${this.nameParts.join(', ')}`);
    console.log(`  Variantes textuelles: ${this.textVariants.join(', ')}`);
    console.log(
      `  Variantes vocales (${this._vocalVariants.length}): ${this.vocalVariants.slice(0, 10).join(', ')}...`,
    );
  }
}

export const botIdentity = new BotIdentity();
export default botIdentity;
