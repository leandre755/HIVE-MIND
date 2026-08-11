// services/ast/queries.ts
// ============================================================================
// TREE-SITTER QUERIES — Per-language S-expression queries for AST extraction
// Ported from Dirac (Apache-2.0) and adapted for HIVE-MIND server-side usage.
// These queries capture function/method/class definitions and references.
// ============================================================================

export const typescriptQuery = `
(function_signature
  name: (identifier) @name.definition.function) @definition.function

(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(method_signature
  name: [(property_identifier) (identifier)] @name.definition.method) @definition.method

(method_definition
  name: [(property_identifier) (identifier)] @name.definition.method) @definition.method

(abstract_method_signature
  name: [(property_identifier) (identifier)] @name.definition.method) @definition.method

(abstract_class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(interface_declaration
  name: (type_identifier) @name.definition.interface) @definition.interface

(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum

(type_alias_declaration
  name: (type_identifier) @name.definition.type) @definition.type

;; Arrow functions assigned to variables
(lexical_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)])) @definition.function

(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)])) @definition.function

;; References
(identifier) @name.reference
(property_identifier) @name.reference
(type_identifier) @name.reference
`;

export const javascriptQuery = `
(method_definition
  name: [(property_identifier) (identifier)] @name.definition.method) @definition.method

[
  (class
    name: (_) @name.definition.class)
  (class_declaration
    name: (_) @name.definition.class)
] @definition.class

[
  (function_declaration
    name: (identifier) @name.definition.function)
  (generator_function_declaration
    name: (identifier) @name.definition.function)
] @definition.function

;; Arrow functions assigned to variables
[
  (lexical_declaration
    (variable_declarator
      name: (identifier) @name.definition.function
      value: [(arrow_function) (function_expression)]))
  (variable_declaration
    (variable_declarator
      name: (identifier) @name.definition.function
      value: [(arrow_function) (function_expression)]))
] @definition.function

;; References
(identifier) @name.reference
(property_identifier) @name.reference
`;

export const pythonQuery = `
;; Classes
(class_definition
  name: (identifier) @name.definition.class) @definition.class

;; Methods (functions inside classes)
(class_definition
  body: (block
    (function_definition
      name: (identifier) @name.definition.method) @definition.method))

;; Top-level Functions
(function_definition
  name: (identifier) @name.definition.function) @definition.function

;; Decorated definitions
(decorated_definition
  definition: [
    (class_definition
      name: (identifier) @name.definition.class)
    (function_definition
      name: (identifier) @name.definition.function)
  ]) @definition.function

;; References
(identifier) @name.reference
(attribute attribute: (identifier) @name.reference)
`;

/** Map file extension → (tree-sitter language name, query text) */
export const LANGUAGE_MAP: Record<string, { langName: string; query: string }> = {
  ts: { langName: 'typescript', query: typescriptQuery },
  tsx: { langName: 'tsx', query: typescriptQuery },
  js: { langName: 'javascript', query: javascriptQuery },
  jsx: { langName: 'javascript', query: javascriptQuery },
  py: { langName: 'python', query: pythonQuery },
};
