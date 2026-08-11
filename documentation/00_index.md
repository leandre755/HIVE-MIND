# Index de la Documentation — HIVE-MIND-RAILWAY

Bienvenue dans la documentation de HIVE-MIND-RAILWAY. Ce dossier est organisé selon le framework **Diátaxis**, structuré en 4 quadrants distincts pour répondre précisément aux besoins du lecteur.

---

## 🧭 Les 4 Quadrants de la Documentation

### 1. 🎓 Tutoriels (Learning-oriented)

_Apprendre par la pratique à travers des étapes guidées._

- **Statut** : En cours de définition (Tutoriel de premier démarrage en attente de rédaction).

### 2. 🛠️ Guides Pratiques (Task-oriented)

_Comment résoudre des problèmes ou accomplir des tâches spécifiques._

- **Ajouter un Modèle IA** : [how-to/ajouter_modele_ia.md](./how-to/ajouter_modele_ia.md) — Procédure de configuration d'un nouveau LLM.
- **Personnaliser l'IA** : [how-to/personnaliser_persona.md](./how-to/personnaliser_persona.md) — Modification des traits, de l'identité et du system prompt.
- **Choix des LLM** : [how-to/guide-choisir-llm-harnais-agentique.docx](./how-to/guide-choisir-llm-harnais-agentique.docx) — Critères de sélection des modèles.

### 3. 📜 Référence (Information-oriented)

_Fiches techniques factuelles, descriptifs et syntaxes._

- **Commandes Utilisateur & IA** : [reference/commandes_capacites.md](./reference/commandes_capacites.md) — Liste des commandes de modération, TTS et interactions sociales.
- **CLI d'Administration** : [reference/admin_cli.md](./reference/admin_cli.md) — Manuel d'utilisation du terminal d'administration (debug, Redis, db, RAG).
- **Mises à jour des Plugins** : [reference/mises_a_jour_plugins.md](./reference/mises_a_jour_plugins.md) — Notes de version des plugins (ex. Firecrawl v2, DuckDuckGo search).
- **Rapport des Besoins** : [reference/rapport-besoins-hive-mind.docx](./reference/rapport-besoins-hive-mind.docx) — Exigences et spécifications initiales.

### 🧠 4. Explications (Understanding-oriented)

_Comprendre les concepts, l'architecture et les choix de conception._

- **01 — [Architecture Générale](./explanations/01_architecture_generale.md)** : Articulation des 5 couches et flux de données.
- **02 — [Orchestrateur Central & Boucle ReAct](./explanations/02_orchestrateur_react.md)** : Moteur d'inférence itérative, IoC et équité multi-utilisateurs.
- **03 — [Couche Transport & Smart Router](./explanations/03_transport_smart_router.md)** : Normalisation des protocoles et cascade de modèles IA.
- **04 — [Sécurité, PTC & Supervision Runtime](./explanations/04_securite_runtime.md)** : Bac à sable AST, supervision Sentinel/Ralph et budgets KKT.
- **05 — [Mémoire Cognitive & Bases de Données](./explanations/05_memoire_cognitive.md)** : Stockage L1/L2, taxonomie MAPLE et déclin des souvenirs.
- **06 — [TUI & Système de Plugins](./explanations/06_tui_plugins.md)** : WebSocket TUI-Core, saisie non-bloquante et chargement des plugins.
- **Distribution de HIVE-MIND** : [explanations/distribution_hive_mind.md](./explanations/distribution_hive_mind.md) — Options de packaging, implications code et traitement des auth providers OAuth.

---

## 📂 Organisation Physique du Dossier

```
documentation/
├── 00_index.md                     # Cet index général
├── explanations/                   # [Explications] Architecture et design
│   ├── 01_architecture_generale.md
│   ├── 02_orchestrateur_react.md
│   ├── 03_transport_smart_router.md
│   ├── 04_securite_runtime.md
│   ├── 05_memoire_cognitive.md
│   ├── 06_tui_plugins.md
│   └── distribution_hive_mind.md
├── how-to/                         # [Guides Pratiques] Guides orientés tâches
│   ├── ajouter_modele_ia.md
│   ├── personnaliser_persona.md
│   └── guide-choisir-llm-harnais-agentique.docx
├── reference/                      # [Références] Fiches techniques et spécifications
│   ├── admin_cli.md
│   ├── commandes_capacites.md
│   ├── mises_a_jour_plugins.md
│   └── rapport-besoins-hive-mind.docx
└── tutorials/                      # [Tutoriels] Pas-à-pas d'apprentissage
```
