import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  levenshteinDistance,
  findBestMatch,
  extractMentions,
  resolveMentionsInText,
  resolveImplicitMentions,
  type Member,
} from '../../../utils/fuzzyMatcher.js';

describe('fuzzyMatcher - levenshteinDistance', () => {
  it.each([
    // Empty strings
    ['', '', 0],
    ['a', '', 1],
    ['', 'a', 1],
    ['abc', '', 3],
    ['', 'abc', 3],

    // Identical strings
    ['a', 'a', 0],
    ['abc', 'abc', 0],
    ['hello world', 'hello world', 0],

    // Single operations (Insertion, Deletion, Substitution)
    ['a', 'b', 1], // Substitution
    ['ab', 'ac', 1], // Substitution
    ['a', 'ab', 1], // Insertion
    ['ab', 'a', 1], // Deletion

    // Multiple operations
    ['kitten', 'sitting', 3],
    ['flaw', 'lawn', 2],
    ['intention', 'execution', 5],
    ['rosettacode', 'raisethysword', 8],

    // Case sensitivity
    ['A', 'a', 1],
    ['hello', 'Hello', 1],

    // Prefix / Suffix
    ['hello', 'helloworld', 5],
    ['world', 'helloworld', 5],

    // Same length but completely different
    ['abc', 'def', 3],
    ['abcdef', 'uvwxyz', 6],
  ])(
    'levenshteinDistance("%s", "%s") should return %i',
    (a: string, b: string, expected: number) => {
      expect(levenshteinDistance(a, b)).toBe(expected);
    },
  );
});

const ALEX: Member = { name: 'Alexandre', jid: '111@s.whatsapp.net' };
const ALEX_SHORT: Member = { name: 'Alex', jid: '222@s.whatsapp.net' };
const ELODIE: Member = { name: 'Élodie', jid: '333@s.whatsapp.net', phoneNumber: '333' };

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('findBestMatch', () => {
  it('retourne un match nul sans query ni candidats', () => {
    expect(findBestMatch('', [ALEX])).toEqual({ match: null, score: 0, exact: false });
    expect(findBestMatch('a', [])).toEqual({ match: null, score: 0, exact: false });
    expect(findBestMatch('a', null as unknown as Member[])).toEqual({
      match: null,
      score: 0,
      exact: false,
    });
  });

  it('match numérique par phoneNumber puis par JID, en ignorant les @lid', () => {
    expect(findBestMatch('333', [ALEX, ELODIE]).match).toBe(ELODIE);
    expect(findBestMatch('111', [ALEX]).match).toBe(ALEX);
    const lidOnly: Member = { name: 'LidUser', jid: '999:12@lid' };
    expect(findBestMatch('999', [lidOnly]).match).toBeNull();
    expect(findBestMatch('555', [ALEX]).match).toBeNull();
  });

  it('match exact de nom (accents/casse normalisés) → score 1, exact', () => {
    const res = findBestMatch('elodie', [ALEX, ELODIE]);
    expect(res.match).toBe(ELODIE);
    expect(res.exact).toBe(true);
    expect(res.score).toBe(1);
  });

  it('match par préfixe/diminutif et par inclusion', () => {
    const alexandra: Member = { name: 'Alexandra', jid: '444@s.whatsapp.net' };
    const prefix = findBestMatch('Alex', [ELODIE, alexandra]);
    expect(prefix.match?.name).toBe('Alexandra');
    const included = findBestMatch('and', [ELODIE, ALEX]);
    expect(included.match).toBe(ALEX);
    // partScore = 0.7 + (3/9) * 0.15
    expect(included.score).toBeCloseTo(0.75, 10);
    expect(included.exact).toBe(false);
  });

  it('évalue aussi les parties de nom composé', () => {
    const multi: Member = { name: 'Jean Claude', jid: '555@s.whatsapp.net' };
    const res = findBestMatch('claude', [multi]);
    expect(res.match).toBe(multi);
    expect(res.exact).toBe(true);
  });

  it('soumet le meilleur score au seuil (match nul mais score conservé)', () => {
    const res = findBestMatch('zzzzzz', [ALEX], 0.99);
    expect(res.match).toBeNull();
    expect(res.score).toBeGreaterThanOrEqual(0);
  });

  it('match par similarité levenshtein quand le seuil est atteint', () => {
    const res = findBestMatch('Alexndre', [ALEX], 0.8);
    expect(res.match).toBe(ALEX);
  });
});

describe('extractMentions', () => {
  it('extrait toutes les mentions @Nom unicode et gère les entrées vides', () => {
    expect(extractMentions(null)).toEqual([]);
    expect(extractMentions('')).toEqual([]);
    expect(extractMentions('salut @Élodie et @Alex2 !')).toEqual(['Élodie', 'Alex2']);
  });
});

describe('resolveMentionsInText', () => {
  it('retourne neutre sans texte ni membres ni mention', () => {
    expect(resolveMentionsInText(null, [ALEX])).toEqual({ text: '', mentions: [], resolved: [] });
    expect(resolveMentionsInText('x', [])).toEqual({ text: 'x', mentions: [], resolved: [] });
    expect(resolveMentionsInText('bonjour tout le monde', [ALEX])).toEqual({
      text: 'bonjour tout le monde',
      mentions: [],
      resolved: [],
    });
  });

  it('remplace la mention par @phone et déduplique les JIDs', () => {
    const res = resolveMentionsInText('@Alex fais ça stp, @Alexandre bis', [ALEX]);
    // Les deux mentions résolvent vers le même membre : les deux occurrences
    // sont réécrites et le JID n'apparaît qu'une fois.
    expect(res.text).toBe('@111 fais ça stp, @111 bis');
    expect(res.mentions).toEqual(['111@s.whatsapp.net']);
    expect(res.resolved).toEqual([ALEX]);
    expect(console.log).toHaveBeenCalledTimes(2);
  });
});

describe('resolveImplicitMentions', () => {
  it('retourne neutre sans texte ni membres', () => {
    expect(resolveImplicitMentions(null, [ALEX])).toEqual({
      text: '',
      mentions: [],
      resolved: [],
    });
    expect(resolveImplicitMentions('rien', [])).toEqual({
      text: 'rien',
      mentions: [],
      resolved: [],
    });
  });

  it('ignore les noms trop courts et remplace les noms entiers détectés', () => {
    const al: Member = { name: 'Al', jid: '000@s.whatsapp.net' };
    const res = resolveImplicitMentions('Al pense qu Alexandre est en retard', [al, ALEX]);
    expect(res.text).toContain('@111');
    expect(res.text).not.toContain('@000');
    expect(res.mentions).toEqual(['111@s.whatsapp.net']);
    expect(res.resolved).toEqual([ALEX]);
    expect(console.log).toHaveBeenCalled();
  });

  it('priorise les noms les plus longs et déduplique les JIDs', () => {
    const res = resolveImplicitMentions('Alexandre alias Alex présent', [ALEX, ALEX_SHORT]);
    expect(res.mentions).toEqual(['111@s.whatsapp.net', '222@s.whatsapp.net']);
    expect(res.resolved).toHaveLength(2);
  });
});
