import { describe, it, test, expect } from '@jest/globals';
import { validateCode } from '../../../services/ptc/SafeScriptValidator.js';
import { ProgrammaticExecutor } from '../../../services/ptc/ProgrammaticExecutor.js';
import type { ToolFunction } from '../../../services/ptc/types.js';

describe('SafeScriptValidator & ProgrammaticExecutor Security', () => {
  describe('AST Prototype & Sandbox Escape Protection', () => {
    test.each([
      {
        desc: 'l accès à this dans le sandbox',
        code: 'const self = this; return self;',
        expected: 'this',
      },
      {
        desc: 'l accès à constructor via syntaxe pointée',
        code: 'const c = Object.constructor; return c;',
        expected: 'constructor',
      },
      {
        desc: 'l accès à constructor via accès calculé Literal',
        code: "const c = Object['constructor']; return c;",
        expected: 'constructor',
      },
      {
        desc: 'l accès à __proto__ via accès calculé Literal',
        code: "const p = Object['__proto__']; return p;",
        expected: '__proto__',
      },
      {
        desc: 'les tentatives d évasion via TemplateLiteral interpolé',
        code: 'const target = {}; const c = target[`${"c"}onstructor`]; return c;',
        expected: 'constructor',
      },
      {
        desc: 'les tentatives d évasion via séquence d échappement Unicode',
        code: 'const target = {}; const c = target["\\u0063onstructor"]; return c;',
        expected: 'constructor',
      },
      {
        desc: 'les tentatives d évasion via TemplateLiteral avec échappement Unicode',
        code: 'const target = {}; const c = target[`\\u0063onstructor`]; return c;',
        expected: 'constructor',
      },
    ])('bloque $desc', ({ code, expected }) => {
      const result = validateCode(code, ['read_file']);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.message.includes(expected))).toBe(true);
    });

    it('bloque l accès à prototype via syntaxe pointée et accès calculé', () => {
      const dotted = validateCode('const p = read_file.prototype; return p;', ['read_file']);
      expect(dotted.isValid).toBe(false);
      expect(dotted.errors.some((e) => e.message.includes('prototype'))).toBe(true);

      const computed = validateCode("const p = read_file['prototype']; return p;", ['read_file']);
      expect(computed.isValid).toBe(false);
      expect(computed.errors.some((e) => e.message.includes('prototype'))).toBe(true);
    });

    it('bloque l appel direct et l instanciation de Function', () => {
      const callFn = validateCode("const f = Function('return 1'); return f();", ['read_file']);
      expect(callFn.isValid).toBe(false);
      expect(callFn.errors.some((e) => e.message.includes('Function()'))).toBe(true);

      const newFn = validateCode("const f = new Function('return 1'); return f();", ['read_file']);
      expect(newFn.isValid).toBe(false);
      expect(newFn.errors.some((e) => e.message.includes('Function()'))).toBe(true);
    });

    it('bloque le vecteur d attaque complet RCE / VM escape', () => {
      const code =
        "const p = this['constructor']['constructor']('return process')(); return p.pid;";
      const result = validateCode(code, ['read_file']);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });

    it('bloque l évasion par déstructuration d objet (const { constructor } = fn)', () => {
      const code = 'const { constructor: F } = read_file; return F;';
      const result = validateCode(code, ['read_file']);
      expect(result.isValid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes('Déstructuration de "constructor"')),
      ).toBe(true);
    });

    it('bloque l évasion par déstructuration de prototype (const { __proto__ } = fn)', () => {
      const code = 'const { __proto__: P } = read_file; return P;';
      const result = validateCode(code, ['read_file']);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Déstructuration de "__proto__"'))).toBe(
        true,
      );
    });

    it('autorise les scripts PTC standards et légitimes', () => {
      const code = `
        const file = await read_file({ path: "test.txt" });
        const parsed = JSON.parse(file.content);
        return { count: parsed.items.length };
      `;
      const result = validateCode(code, ['read_file']);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('autorise les identifiants légitimes contenant constructor (constructorIndex, constructorArgs) y compris en déstructuration', () => {
      const code = `
        const constructorIndex = 0;
        const items = [1, 2, 3];
        const res = items[constructorIndex];
        const cfg = { constructorArgs: [1] };
        const { constructorIndex: idx } = { constructorIndex: 42 };
        const { constructorArgs } = cfg;
        return { res, args: constructorArgs, idx };
      `;
      const result = validateCode(code, ['read_file']);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('autorise les motifs de déstructuration AssignmentPattern et RestElement dans les tableaux et objets', () => {
      const code = `
        const [first = 1, ...restList] = [10, 20, 30];
        const { defaultKey = 'default_val', ...restObj } = { foo: 'bar' };
        return { first, restList, defaultKey, restObj };
      `;
      const result = validateCode(code, ['read_file']);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('autorise les clés crochetées littérales contenant constructor (obj["constructorIndex"])', () => {
      const code = `
        const obj = { constructorIndex: 42 };
        const val = obj["constructorIndex"];
        return val;
      `;
      const result = validateCode(code, ['tool1']);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('autorise les paramètres de FunctionExpression anonyme standard sans erreur de variable non définie', () => {
      const code = `
        const items = [{ id: 1 }, { id: 2 }];
        const ids = items.map(function(item) { return item.id; });
        return ids;
      `;
      const result = validateCode(code, ['tool1']);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Runtime Guarded Context Isolation', () => {
    it('bloque l accès au constructeur hôte lors de l exécution dans le VM même en contournant l AST par clé dynamique', async () => {
      const executor = new ProgrammaticExecutor();
      const tools = new Map<string, ToolFunction>();
      tools.set('read_file', async () => ({ content: 'hello' }));

      // Payload utilisant String.fromCharCode pour contourner la validation AST statique
      const attackPayload = `
        const k = String.fromCharCode(99,111,110,115,116,114,117,99,116,111,114);
        const obj = {};
        const c = obj[k];
        return c;
      `;
      await expect(executor.execute(attackPayload, tools)).rejects.toThrow(
        /Accès prototype ou constructeur interdit/,
      );
    });

    it('rejette l accès à constructor, __proto__ et prototype via clés dynamiques dans le VM', async () => {
      const executor = new ProgrammaticExecutor();
      const tools = new Map<string, ToolFunction>();
      tools.set('read_file', async () => ({ content: 'hello' }));

      // Test __proto__ sur objet ordinaire du realm VM
      const protoPayload = `
        const k = ['_', '_', 'p', 'r', 'o', 't', 'o', '_', '_'].join('');
        const obj = {};
        return obj[k];
      `;
      await expect(executor.execute(protoPayload, tools)).rejects.toThrow(
        /Accès prototype ou constructeur interdit/,
      );

      // Test prototype sur fonction d outil injectée
      const prototypePayload = `
        const k = ['p', 'r', 'o', 't', 'o', 't', 'y', 'p', 'e'].join('');
        return read_file[k];
      `;
      await expect(executor.execute(prototypePayload, tools)).rejects.toThrow(
        /Accès interdit à "prototype"/,
      );

      // Test __proto__ sur fonction d outil injectée
      const toolProtoPayload = `
        const k = ['_', '_', 'p', 'r', 'o', 't', 'o', '_', '_'].join('');
        return read_file[k];
      `;
      await expect(executor.execute(toolProtoPayload, tools)).rejects.toThrow(
        /Accès interdit à "__proto__"/,
      );
    });
  });
});
