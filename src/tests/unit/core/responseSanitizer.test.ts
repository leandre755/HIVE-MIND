import { describe, it, expect } from '@jest/globals';
import { detectResponseDefects, sanitizeResponse } from '../../../utils/responseSanitizer.js';

describe('Response Sanitizer Utility', () => {
  describe('Layer 1: detectResponseDefects', () => {
    it('should return 0 defects for a clean, natural response with thoughts', () => {
      const text =
        '<thought>\nI will use the browser tool.\n</thought>\nHere is what I found on the website.';
      const result = detectResponseDefects(text);
      expect(result.defectCount).toBe(0);
      expect(result.hasNoThoughts).toBe(false);
      expect(result.hasLeakedToolCalls).toBe(false);
      expect(result.hasRawCodeDominance).toBe(false);
      expect(result.hasJsonToolObject).toBe(false);
    });

    it('should detect missing <thought> tags', () => {
      const text = 'Here is your answer without any reasoning first.';
      const result = detectResponseDefects(text);
      expect(result.hasNoThoughts).toBe(true);
      expect(result.defectCount).toBe(1);
    });

    it('should detect leaked tool_code_execution(...) syntax', () => {
      const text =
        '<thought>Executing code</thought>\ntool_code_execution(code="""print("Hello")""")';
      const result = detectResponseDefects(text);
      expect(result.hasLeakedToolCalls).toBe(true);
    });

    it('should detect leaked JSON tool objects', () => {
      const text =
        '<thought>Sending message</thought>\n{"name": "send_message", "arguments": {"text": "hello"}}';
      const result = detectResponseDefects(text);
      expect(result.hasJsonToolObject).toBe(true);
    });

    it('should detect raw code dominance', () => {
      // Massive code block with almost no text
      const code = 'a'.repeat(200);
      const text = `<thought>Code</thought>\nHere is the code:\n\`\`\`python\n${code}\n\`\`\``;
      const result = detectResponseDefects(text);
      expect(result.hasRawCodeDominance).toBe(true);
    });

    it('should NOT flag code dominance if there is sufficient explanation', () => {
      const code = 'a'.repeat(200);
      const explanation = 'This is a detailed explanation of how the code works. '.repeat(5); // ~250 chars
      const text = `<thought>Code</thought>\n${explanation}\n\`\`\`python\n${code}\n\`\`\``;
      const result = detectResponseDefects(text);
      expect(result.hasRawCodeDominance).toBe(false);
    });

    it('should handle null/empty gracefully', () => {
      const result = detectResponseDefects('');
      expect(result.defectCount).toBe(0);
    });
  });

  describe('Layer 2: sanitizeResponse', () => {
    const FALLBACK =
      "J'ai rencontré un problème technique en traitant cette tâche. Peux-tu reformuler ta demande ?";

    it('should return text unchanged if no leaked tools exist', () => {
      const text = 'Voici le résultat de ma recherche sur Google.';
      const result = sanitizeResponse(text);
      expect(result.wasModified).toBe(false);
      expect(result.cleaned).toBe(text);
    });

    it('should strip triple-quote tool_code_execution', () => {
      const text = 'Je vais le faire.\ntool_code_execution(code="""import os\nprint("hi")""")';
      const result = sanitizeResponse(text);
      expect(result.wasModified).toBe(true);
      expect(result.strippedItems).toContain('triple_quote_tool_call');
      expect(result.cleaned).toBe('Je vais le faire.');
    });

    it.each([
      ['code_execution(code="print(\'hi\')")\nTerminé.', 'Terminé.'],
      ['tool_browser_screenshot(url="https://example.com")\nRegarde l\'image.', "Regarde l'image."],
      [
        'Voici l\'action:\n{"name": "browser_screenshot", "arguments": {"url": "x"}}\nC\'est fait.',
        "Voici l'action:\n\nC'est fait.",
      ],
    ])('should strip leaked tool syntax: %s', (text, expected) => {
      const result = sanitizeResponse(text);
      expect(result.wasModified).toBe(true);
      expect(result.cleaned).toBe(expected);
    });

    it('should fallback if entire response is stripped', () => {
      const text = 'tool_code_execution(code="""print(1)""")';
      const result = sanitizeResponse(text);
      expect(result.wasModified).toBe(true);
      expect(result.cleaned).toBe(FALLBACK);
    });

    it('should strip dominant orphan code blocks', () => {
      const code = 'a'.repeat(200);
      const text = `\`\`\`python\n${code}\n\`\`\``;
      const result = sanitizeResponse(text);
      expect(result.wasModified).toBe(true);
      expect(result.cleaned).toBe(FALLBACK);
    });

    it('should NOT strip code blocks that are part of an explanation', () => {
      const code = 'a'.repeat(100);
      const text = `Voici comment faire une boucle en Python:\n\`\`\`python\n${code}\n\`\`\`\nC'est très utile !`;
      const result = sanitizeResponse(text);
      expect(result.wasModified).toBe(false);
      expect(result.cleaned).toBe(text);
    });
  });
});
