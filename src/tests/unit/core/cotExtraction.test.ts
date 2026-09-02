// src/tests/unit/core/cotExtraction.test.ts
// Test unitaire de l extraction CoT et du nettoyage de réponse de BotCore
import { describe, it, expect } from '@jest/globals';

process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'dummy';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.NODE_ENV = 'test';

const { botCore } = await import('../../../core/index.js');

type CoreInternalAccess = {
  _cleanThoughtsAndSanitize: (
    finalResponse: string,
    iterations: number,
  ) => { cleaned: string | null; thoughtsCount: number };
  _extractThoughtsAndStripTags: (rawResponse: string) => { cleaned: string; thoughts: string[] };
  _unwrapSendMessageFormat: (text: string) => string;
};

const coreAccess = botCore as unknown as CoreInternalAccess;

describe('BotCore CoT Extraction & Sanitization Pipeline (MOD 6)', () => {
  describe('_extractThoughtsAndStripTags', () => {
    it.each([
      ['<thought>Analyse des besoins</thought>Voici la solution.', 'Voici la solution.'],
      ['<think>Calcul du résultat</think>Résultat = 42', 'Résultat = 42'],
      ['<thinking>Recherche documentaire</thinking>Document trouvé.', 'Document trouvé.'],
      [
        '<thought>Étape 1</thought>Intermédiaire.<thought>Étape 2</thought>Conclusion.',
        'Intermédiaire.Conclusion.',
      ],
      ['<THOUGHT>Tag majuscule</THOUGHT>Réponse valide.', 'Réponse valide.'],
    ])('extrait les pensées et épure les balises pour : %s', (input, expectedCleaned) => {
      const { cleaned, thoughts } = coreAccess._extractThoughtsAndStripTags(input);
      expect(cleaned).toBe(expectedCleaned);
      expect(thoughts.length).toBeGreaterThan(0);
    });

    it('gère les pensées multilignes avec sauts de lignes et formatage riche', () => {
      const input = '<thought>\n1. Lire le fichier\n2. Parser l AST\n</thought>Analyse effectuée.';
      const { cleaned, thoughts } = coreAccess._extractThoughtsAndStripTags(input);

      expect(cleaned).toBe('Analyse effectuée.');
      expect(thoughts[0]).toContain('1. Lire le fichier');
      expect(thoughts[0]).toContain('2. Parser l AST');
    });

    it('laisse le texte intact s il ne contient aucune balise de pensée', () => {
      const input = 'Texte direct sans balise de raisonnement.';
      const { cleaned, thoughts } = coreAccess._extractThoughtsAndStripTags(input);

      expect(cleaned).toBe(input);
      expect(thoughts).toHaveLength(0);
    });
  });

  describe('_unwrapSendMessageFormat', () => {
    it('déballe la charge utile textuelle d une balise <send_message> JSON', () => {
      const input = '<send_message>{"text":"Message extrait du protocole"}</send_message>';
      const result = coreAccess._unwrapSendMessageFormat(input);
      expect(result).toBe('Message extrait du protocole');
    });

    it('supprime proprement les balises orphelines si le JSON est corrompu', () => {
      const input = '<send_message>bad-json-content</send_message>';
      const result = coreAccess._unwrapSendMessageFormat(input);
      expect(result).toBe('bad-json-content');
    });
  });

  describe('_cleanThoughtsAndSanitize', () => {
    it('retourne le message de repli lorsque l agent a réfléchi sans émettre de texte final', () => {
      const thoughtOnly = '<thought>J ai terminé mes opérations</thought>';
      const result = coreAccess._cleanThoughtsAndSanitize(thoughtOnly, 2);

      expect(result.thoughtsCount).toBe(1);
      expect(result.cleaned).toBe('*(Réflexion terminée sans réponse textuelle)*');
    });

    it('retourne null si aucune pensée ni texte n ont été produits à l itération 0', () => {
      const empty = '';
      const result = coreAccess._cleanThoughtsAndSanitize(empty, 0);

      expect(result.cleaned).toBeNull();
      expect(result.thoughtsCount).toBe(0);
    });
  });
});
