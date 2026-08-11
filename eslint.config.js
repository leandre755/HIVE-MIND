import js from '@eslint/js';
import { config as tseslintConfig, configs as tseslintConfigs } from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { configs as sonarjsConfigs } from 'eslint-plugin-sonarjs';
import security from 'eslint-plugin-security';
import boundaries from 'eslint-plugin-boundaries';
import { flatConfigs as importFlatConfigs } from 'eslint-plugin-import-x';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslintConfig(
  {
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
  },

  js.configs.recommended,
  ...tseslintConfigs.recommended,
  sonarjsConfigs.recommended,
  security.configs.recommended,
  importFlatConfigs.recommended,
  importFlatConfigs.typescript,

  {
    // Restrict react-hooks rules exclusively to JSX/TSX files or files within the src/tui/ React UI directory
    // to prevent false positives in core code (e.g. Baileys' useMultiFileAuthState)
    files: [
      '**/*.tsx',
      '**/*.jsx',
      'src/tui/**/*.ts',
      'src/tui/**/*.tsx',
      'src/tui/**/*.js',
      'src/tui/**/*.jsx',
    ],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Test/verification scripts in .agents/ legitimately scan dynamic directory paths
    files: ['.agents/**/*.ts'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/session/**',
      '**/temp/**',
      '**/*.min.js',
      'dist/**',
      'coverage/**',
      'graphify-out/**',
      'excalidraw/**',
      'llm_as_*/**',
      'Sandbox1/**',
      'TEST_RESULT/**',
      'scratch/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
    plugins: {
      boundaries,
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx', '.d.ts'],
        },
      },
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Node.js Global variables
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'writable',
        module: 'readonly',
        require: 'readonly',
      },
    },
    rules: {
      // ── TypeScript ──────────────────────────────────────
      '@typescript-eslint/ban-ts-comment': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      // ── Logique & Qualité ───────────────────────────────
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'warn',
      'no-duplicate-imports': 'error',
      'no-empty': 'error',
      'no-unused-expressions': 'error',
      'no-warning-comments': [
        'error',
        {
          terms: ['todo', 'fixme', 'stub'],
          location: 'anywhere',
        },
      ],
      'no-constant-condition': 'error',
      complexity: ['error', 30],
      'max-depth': ['error', 5],
      'max-lines-per-function': [
        'error',
        {
          max: 200,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      'no-param-reassign': 'error',

      // ── Sécurité ────────────────────────────────────────
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-shadow': 'error',

      // ── Style ───────────────────────────────────────────
      // INTENTIONNELLEMENT ABSENT : Prettier gère 100% du style
      // (indent, semi, quotes, comma-dangle, trailing-spaces,
      //  eol-last, no-multiple-empty-lines, arrow-spacing)
      // eslint-config-prettier (ci-dessous) désactive tout résidu
    },
  },

  // Filet de sécurité : désactive toute règle ESLint en conflit avec Prettier
  eslintConfigPrettier
);
