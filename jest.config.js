/** @type {import('ts-jest').JestConfigWithTsJest} */
const jestConfig = {
  // Use the ESM preset for ts-jest
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    // Configure ts-jest to use ESM
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.test.json',
        // Disable ts-jest diagnostics because they produce false positives (TS1378, TS1343)
        // in our ESM test environment. Real type safety is enforced by `tsc --noEmit`.
        diagnostics: false,
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  testMatch: ['**/tests/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/worktrees/'],
};

export default jestConfig;
