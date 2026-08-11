import { describe, it, expect } from '@jest/globals';
import { levenshteinDistance } from '../../../utils/fuzzyMatcher.js';

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
