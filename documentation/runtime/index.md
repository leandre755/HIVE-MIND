# Domaine 5 : Runtime, Sécurité & Plan de Contrôle (SS-21 à SS-22)

Le domaine **Runtime, Sécurité & Plan de Contrôle** constitue le cadre d'exécution, de régulation sécuritaire, de gouvernance économique et d'ingénierie de contexte de HIVE-MIND. Il garantit qu'aucun appel d'outil ou inférence de modèle ne viole les invariants du système, n'entre dans une boucle infinie de dégradation cognitive (slop) ou ne dépasse les budgets alloués, tout en fournissant une hydratation ultra-rapide (<50ms) du contexte d'invite pour l'orchestrateur.

---

## 🧭 Architecture Synoptique du Domaine

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│              DOMAINE 5 : RUNTIME, SÉCURITÉ & PLAN DE CONTRÔLE                    │
├────────────────────────────────────────┬─────────────────────────────────────────┤
│                                        │                                         │
│   SS-21 : AI RUNTIME CONTROL PLANE     │   SS-22 : TIERED CONTEXT LOADER         │
│   (VIGIL, Ralph, FinOps & Manifold)    │   (Workspace Prompt V3 & Strata)        │
│                                        │                                         │
│   ┌────────────────────────────────┐   │   ┌─────────────────────────────────┐   │
│   │ • Sentinel VIGIL Invariants    │   │   │ • 5 Strates Thermiques Prompt   │   │
│   │ • Ralph Anti-Slop / Anti-Loop  │   │   │ • Assemblage <50ms avec Cache   │   │
│   │ • FinOps Lagrange Lambda (λ)   │   │   │ • Budgétisation Dynamique       │   │
│   │ • Fast Paths & Guardrails      │   │   │ • Détection Seuil GC 80%        │   │
│   └────────────────────────────────┘   │   └─────────────────────────────────┘   │
│                                        │                                         │
└────────────────────────────────────────┴─────────────────────────────────────────┘
```

---

## 📚 Cartographie des Sous-Systèmes & Documentation Diátaxis

Chaque sous-système de ce domaine est documenté selon le triplet canonique Diátaxis :

| Sous-Système | Responsabilité & Fichiers Clés | 🧠 Architecture (*Explanation*) | 📜 Référence API (*Reference*) | 🛠️ Guide Pratique (*How-To*) |
| :--- | :--- | :--- | :--- | :--- |
| **SS-21 : AI Runtime Control Plane (VIGIL, Ralph & FinOps)** | Validation pré-action par invariants Sentinel, garde-fous de permissions, audit anti-slop et anti-boucle Ralph, régulation des coûts par multiplicateur de Lagrange ($\lambda$).<br>`src/services/runtime/` | [runtime-control-plane-explanation.md](./runtime-control-plane-explanation.md) | [runtime-control-plane-reference.md](./runtime-control-plane-reference.md) | [runtime-control-plane-howto.md](./runtime-control-plane-howto.md) |
| **SS-22 : Tiered Context Loader & Prompt Engineering** | Assemblage modulaire du Workspace Prompt V3 en 5 strates thermiques en moins de 50 ms, budgétisation des jetons et déclenchement de la compaction GC à 80%.<br>`src/core/context/TieredContextLoader.ts`<br>`src/services/context/` | [tiered-context-loader-explanation.md](./tiered-context-loader-explanation.md) | [tiered-context-loader-reference.md](./tiered-context-loader-reference.md) | [tiered-context-loader-howto.md](./tiered-context-loader-howto.md) |

---

## 📖 Détail des Sous-Systèmes du Domaine

### SS-21 — AI Runtime Control Plane (Sentinel VIGIL, Ralph & FinOps)
- **🧠 Explication :** [Architecture du Plan de Contrôle Runtime, Invariants VIGIL & Modèle FinOps](./runtime-control-plane-explanation.md)
- **📜 Référence :** [Interfaces RuntimeSentinel, ConstraintManifold, Événements & Schémas](./runtime-control-plane-reference.md)
- **🛠️ Guide Pratique :** [Comment Configurer les Politiques de Sécurité et Auditer les Actions](./runtime-control-plane-howto.md)

### SS-22 — Tiered Context Loader & Prompt Engineering
- **🧠 Explication :** [Architecture des 5 Strates de Contexte & Hydratation Dynamique](./tiered-context-loader-explanation.md)
- **📜 Référence :** [API TieredContextLoader, ContextWindowService & Matrices de Jetons](./tiered-context-loader-reference.md)
- **🛠️ Guide Pratique :** [Comment Monitorer la Consommation de Jetons et Configurer le Garbage Collector](./tiered-context-loader-howto.md)

---

## 🔗 Navigation Inter-Domaines

- **Index Central de la Documentation :** [`../00_index.md`](../00_index.md)
- **Domaine 1 — Cœur d'Orchestration (SS-01 à SS-09) :** [`../core/index.md`](../core/index.md)
- **Domaine 2 — Fournisseurs d'IA & Routage (SS-10 à SS-14) :** [`../providers/index.md`](../providers/index.md)
- **Domaine 3 — Transports & Passerelles (SS-15 à SS-17) :** [`../transport/index.md`](../transport/index.md)
- **Domaine 4 — Mémoire & Cognition (SS-18 à SS-20) :** [`../memory/index.md`](../memory/index.md)
- **Domaine 6 — Outils, Dev Tools & Hardening (SS-23 à SS-26) :** [`../plugins/index.md`](../plugins/index.md)
