// services/ast/index.ts
// ============================================================================
// AST SERVICE — Barrel export for Tree-sitter based code intelligence
// ============================================================================

export {
  parseDefinitions,
  getFileSkeleton,
  getFunction,
  findSymbolReferences,
  type SymbolDefinition,
  type SymbolReference,
} from './TreeSitterService.js';

export { LANGUAGE_MAP } from './queries.js';
