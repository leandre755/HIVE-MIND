# Domaine 6 : Outils, Dev Tools & Hardening Système (SS-23 à SS-26)

Le domaine **Outils, Dev Tools & Hardening Système** constitue la couche motrice et le socle de sécurité opérationnelle de HIVE-MIND. Il fournit à l'agent autonome un ensemble d'outils de pointe pour inspecter, manipuler et modifier le code source avec une précision déterministe, tout en garantissant l'isolation matérielle, la sécurité des entrées/sorties et l'interopérabilité avec les serveurs d'outils externes (MCP).

---

## Architecture Synoptique du Domaine

```
+---------------------------------------------------------------------------------------+
|                 DOMAINE 6 : OUTILS, DEV TOOLS & HARDENING SYSTEME                     |
+-------------------------------------------+-------------------------------------------+
                                            │
        +-----------------------------------+-----------------------------------+
        │                                                                       │
        ▼                                                                       ▼
+-----------------------------------------------+   +-----------------------------------------------+
| 1. OUTILLAGE DEVELOPPEUR (DEV TOOLS)          |   | 2. INFRASTRUCTURE & FONDATIONS (SYSTEM)       |
|                                               |   |                                               |
| - SS-23 : Hash-Anchored Line Editing Engine   |   | - SS-25 : Dynamic Plugin Pipeline             |
|   (Édition par ancres de hachage FNV-1a)      |   |   (Découverte, validation Ajv, Tool RAG, MCP) |
|                                               |   |                                               |
| - SS-24 : AST Code Intelligence & LSP         |   | - SS-26 : Hardening Foundations & Exec Libs   |
|   (Parsing WebTreeSitter WASM, squelettes, LSP)|   |   (SafeFs anti-traversal, Redlock, bash -i)   |
+-----------------------------------------------+   +-----------------------------------------------+
```

---

## Inventaire Diátaxis des 4 Sous-Systèmes

Chaque sous-système de ce domaine est documenté selon le triplet canonique Diátaxis :

1. **Explication (`*-explanation.md`)** : Modèle mental, motivations d'ingénierie, compromis et diagrammes de flux.
2. **Référence (`*-reference.md`)** : Interfaces TypeScript réelles, signatures de méthodes, schémas de configuration et codes d'erreur.
3. **Guide Pratique (`*-howto.md`)** : Recettes concrètes d'intégration pas-à-pas, commandes de tests unitaires et tableau de dépannage.

---

### SS-23 : Moteur d'Édition Fichier par Ancrage Hash (Stateful Hash-Anchored Line Editor)

Éditeur algorithmique de code source éliminant les dérives de numéros de ligne et les ambiguïtés textuelles grâce à un dictionnaire mnémonique, des empreintes FNV-1a 32-bit (`Uint32Array`), un algorithme de Myers diff et une application atomique multi-fichiers.

- **Architecture & Concepts :** [`hash-line-editor-explanation.md`](./hash-line-editor-explanation.md)
- **Contrats d'Interface & Types :** [`hash-line-editor-reference.md`](./hash-line-editor-reference.md)
- **Guide Pratique d'Intégration :** [`hash-line-editor-howto.md`](./hash-line-editor-howto.md)

---

### SS-24 : Intelligence de Code AST & Serveur LSP Embarqué (AST Code Intelligence & Embedded LSP)

Moteur d'analyse syntaxique arborescente multi-langages fondé sur WebAssembly (`web-tree-sitter`) permettant l'extraction de squelettes condensés (-90% de jetons), l'isolation chirurgicale de fonctions et la navigation sémantique de type IDE (`goToDefinition`, `findReferences`, `documentSymbol`).

- **Architecture & Concepts :** [`ast-code-intel-explanation.md`](./ast-code-intel-explanation.md)
- **Contrats d'Interface & Types :** [`ast-code-intel-reference.md`](./ast-code-intel-reference.md)
- **Guide Pratique d'Intégration :** [`ast-code-intel-howto.md`](./ast-code-intel-howto.md)

---

### SS-25 : Pipeline Modulaire de Plugins & Validation Dynamique (Dynamic Plugin Pipeline)

Gestionnaire de cycle de vie et de découverte automatique d'outils par catégories, validation pré-exécution stricte par schémas Ajv/Zod avec diagnostics d'auto-correction pour LLM, filtrage sémantique par RAG (`match_tools`) et client MCP universel (`stdio`/`sse`).

- **Architecture & Concepts :** [`plugin-pipeline-explanation.md`](./plugin-pipeline-explanation.md)
- **Contrats d'Interface & Types :** [`plugin-pipeline-reference.md`](./plugin-pipeline-reference.md)
- **Guide Pratique d'Intégration :** [`plugin-pipeline-howto.md`](./plugin-pipeline-howto.md)

---

### SS-26 : Fondations de Durcissement Système & Utilitaires d'Exécution (Hardening Foundations)

Socle d'infrastructure bas niveau garantissant l'immunité contre les attaques par traversée de répertoires (`safeFs.ts`), le verrouillage distribué Redlock avec script Lua atomique (`LockManager`), la réparation résiliente de structures JSON (`ResponseFormatEnforcer`), l'alignement d'empreinte TLS JA3 (`TlsImpersonator`) et la persistance de sessions bash interactives (`PersistentShell`).

- **Architecture & Concepts :** [`system-hardening-explanation.md`](./system-hardening-explanation.md)
- **Contrats d'Interface & Types :** [`system-hardening-reference.md`](./system-hardening-reference.md)
- **Guide Pratique d'Intégration :** [`system-hardening-howto.md`](./system-hardening-howto.md)

---

## Liens & Navigation Globale

- **Index Général du Système :** [`../00_index.md`](../00_index.md)
- **Domaine 1 (Cœur & Orchestration) :** [`../core/index.md`](../core/index.md)
- **Domaine 2 (Fournisseurs & Routage) :** [`../providers/index.md`](../providers/index.md)
- **Domaine 3 (Transports & Multi-Canal) :** [`../transport/index.md`](../transport/index.md)
- **Domaine 4 (Mémoire & Cognition) :** [`../memory/index.md`](../memory/index.md)
- **Domaine 5 (Plan de Contrôle & Runtime) :** [`../runtime/index.md`](../runtime/index.md)
