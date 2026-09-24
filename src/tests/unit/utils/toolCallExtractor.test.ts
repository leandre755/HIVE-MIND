// tests/unit/utils/toolCallExtractor.test.ts
// Issue #112 Palier 1 — couverture de `src/utils/toolCallExtractor.ts`.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  extractToolCallsFromText,
  extractToolCallsFromOpenAI,
  isValidToolCall,
  parseToolArguments,
  formatToolCall,
  deduplicateToolCalls,
  getToolCallStats,
} from '../../../utils/toolCallExtractor.js';

describe('extractToolCallsFromText', () => {
  it('retourne un tableau vide sur entrées nulles ou non-string', () => {
    expect(extractToolCallsFromText(null)).toEqual([]);
    expect(extractToolCallsFromText(undefined)).toEqual([]);
    expect(extractToolCallsFromText('')).toEqual([]);
    expect(extractToolCallsFromText(42 as unknown as string)).toEqual([]);
  });

  it('extrait les appels sys_interaction.name(args) en mode includeSys', () => {
    const matches = extractToolCallsFromText('avant sys_interaction.read_file(path="a.txt") après');
    expect(matches).toEqual([
      {
        name: 'read_file',
        arguments: 'path="a.txt"',
        raw: 'sys_interaction.read_file(path="a.txt")',
        index: 6,
      },
    ]);
  });

  it('extrait les appels nus name(args) hors includeSys', () => {
    expect(extractToolCallsFromText('send_message(to="x")', true)).toHaveLength(0);
    const matches = extractToolCallsFromText('send_message(to="x")', false);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ name: 'send_message', arguments: 'to="x"' });
  });

  it('extrait les balises <function> et <tool_call>', () => {
    const matches = extractToolCallsFromText(
      '<function>get_weather</function> puis <tool_call> lookup(q="paris") </tool_call>',
    );
    const names = matches.map((m) => m.name);
    expect(names).toContain('get_weather');
    expect(names).toContain('lookup');
    expect(matches.find((m) => m.name === 'get_weather')?.arguments).toBe('{}');
  });

  it('extrait les balises XML génériques en ignorant les tags exclus et les chevauchements', () => {
    const matches = extractToolCallsFromText(
      '<thought>ne pas compter</thought><search_query>chat</search_query><function>ignored</function>',
    );
    // `<function>nom</function>` est collecté par collectFunctionTags (appel
    // valide) ; le collecteur XML exclut en revanche le tag `function` en doublon.
    expect(matches.map((m) => m.name)).toEqual(['search_query', 'ignored']);
    expect(matches[0].arguments).toBe('chat');
  });

  it('trie les matches par position dans le texte', () => {
    const matches = extractToolCallsFromText('<b>second</b> <a>premier</a>', false);
    const names = matches.map((m) => m.name);
    expect(names).toEqual(['b', 'a']);
  });
});

describe('extractToolCallsFromOpenAI', () => {
  it('retourne [] sur entrée non-tableau et mappe les calls valides', () => {
    expect(extractToolCallsFromOpenAI(null)).toEqual([]);
    expect(extractToolCallsFromOpenAI('x' as unknown as unknown[])).toEqual([]);
    const calls = extractToolCallsFromOpenAI([
      { id: 'c1', function: { name: 'f', arguments: '{}' } },
      { type: 'custom', function: { name: 'g', arguments: '{"a":1}' } },
      { function: { name: 'incomplet' } },
      {},
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ id: 'c1', name: 'f', arguments: '{}', type: 'function' });
    expect(calls[1]).toMatchObject({ name: 'g', type: 'custom' });
  });
});

describe('isValidToolCall', () => {
  it('valide les noms \\w+ de 1..100 caractères avec arguments string', () => {
    expect(isValidToolCall({ name: 'read_file', arguments: '{}' })).toBe(true);
    expect(isValidToolCall({ name: '', arguments: '{}' })).toBe(false);
    expect(isValidToolCall({ name: 'a-b', arguments: '{}' })).toBe(false);
    expect(isValidToolCall({ name: 'x'.repeat(101), arguments: '{}' })).toBe(false);
    expect(isValidToolCall({ name: 'ok', arguments: 3 as unknown as string })).toBe(false);
    expect(isValidToolCall(null as unknown as Record<string, never>)).toBe(false);
  });
});

describe('parseToolArguments', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retourne null sur entrée vide et parse le JSON valide', () => {
    expect(parseToolArguments(null)).toBeNull();
    expect(parseToolArguments(undefined)).toBeNull();
    expect(parseToolArguments('')).toBeNull();
    expect(parseToolArguments('{"a":1}')).toEqual({ a: 1 });
  });

  it('découpe le JSON entouré de texte avant parsing', () => {
    expect(parseToolArguments('voici {"a":2} merci')).toEqual({ a: 2 });
    expect(parseToolArguments('pas de fermeture {')).toBeNull();
  });

  it('répare les JSON quasi-valides (guillemets simples, clés nues, virgule finale)', () => {
    expect(parseToolArguments("{a: 'b', c: 1,}")).toEqual({ a: 'b', c: 1 });
  });

  it('retombe sur un objet texte quand aucune accolade n est présente', () => {
    const repaired = parseToolArguments<{ text: string }>('hello world');
    expect(repaired).toMatchObject({ text: 'hello world', message: 'hello world' });
    expect(console.error).toHaveBeenCalled();
  });

  it('échoue en null sur JSON irréparable contenant une accolade', () => {
    expect(parseToolArguments('{"broken": ')).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('formatToolCall / deduplicateToolCalls / getToolCallStats', () => {
  it('formate avec troncature à 50 caractères d arguments', () => {
    expect(formatToolCall(null as unknown as Record<string, never>)).toBe('Invalid tool call');
    expect(formatToolCall({ name: 'f', arguments: '{"a":1}' })).toBe('f({"a":1})');
    const long = formatToolCall({ name: 'f', arguments: 'x'.repeat(60) });
    expect(long).toContain('...');
    expect(long.endsWith(')')).toBe(true);
    expect(long.length).toBeLessThan(70);
  });

  it('déduplique sur name:arguments et filtre les calls invalides', () => {
    expect(deduplicateToolCalls(null as unknown as never[])).toEqual([]);
    const deduped = deduplicateToolCalls([
      { name: 'a', arguments: '1' },
      { name: 'a', arguments: '1' },
      { name: 'a', arguments: '2' },
      { name: '', arguments: 'x' },
    ]);
    expect(deduped).toHaveLength(2);
  });

  it('calcule les statistiques par nom', () => {
    expect(getToolCallStats(null as unknown as never[])).toEqual({
      total: 0,
      valid: 0,
      unique: 0,
      byName: {},
    });
    const stats = getToolCallStats([
      { name: 'a', arguments: '{}' },
      { name: 'a', arguments: '{}' },
      { name: 'b', arguments: '{}' },
      { name: 'in-valide', arguments: '{}' },
    ]);
    expect(stats).toEqual({ total: 4, valid: 3, unique: 2, byName: { a: 2, b: 1 } });
  });
});
