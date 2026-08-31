# Execution Plan: Restructuration globale de `src/` (hors `src/tui/`)

> **Statut : PLAN — aucune exécution.** Ce document décrit une réorganisation
> *par déplacement et renommage*. Aucune logique métier n'est modifiée.
> Périmètre : **327 fichiers** (`src/**` moins `src/tui/**`).
> Généré le 2026-08-05. Graphe de dépendances : `graphify update . --force`
> (9161 nœuds, 16833 arêtes, 485 communautés).

## 📋 Target Invariant & Pre-requisites

- **Target Invariant #1 — Iso-comportement** : à chaque étape, `npm run build`
  et `tsc --noEmit` restent à 0 erreur, et le démarrage runtime
  (`node dist/main.js --version`) reste fonctionnel. Aucun changement de
  signature, de logique ou de contrat public.
- **Target Invariant #2 — Flux unidirectionnel** : après restructuration,
  aucune arête d'import ne remonte d'un niveau N vers un niveau > N
  (voir §2.3). Vérifiable par script sur le graphe Graphify.
- **Target Invariant #3 — Couverture totale** : les 327 fichiers ont une
  destination explicite (§7). Aucun fichier orphelin, aucune collision de
  chemin cible.
- **Pre-requisites** :
  - `graphify` installé et graphe à jour.
  - Branche Git dédiée + working tree propre avant chaque lot.
  - Les déplacements se font via `git mv` (préservation de l'historique).
  - `tsconfig.json` : `paths` à réécrire (§3.4).

---

## ① Diagnostic factuel

### 1.1 Métriques d'entrée

| Mesure | Valeur |
|---|---|
| Fichiers hors `src/tui/` | **327** |
| dont `.ts` | 303 |
| Fichiers dans `src/tui/` (exclus du périmètre) | 372 |
| Lignes `.ts`/`.tsx` hors tui | 66 006 |
| Arêtes d'import fichier→fichier (hors tui) | 624 |
| Fichiers jamais importés (hors points d'entrée) | 37 |
| Alias TS déclarés / réellement utilisés | 7 / **0** |
| Occurrences `__dirname` / `import.meta.url` | **66** sur 29 fichiers |
| Imports dynamiques relatifs (`await import('./…')`) | **261** |

### 1.2 Répartition actuelle des 327 fichiers

```
 67  src/tests/        64  src/services/     45  src/providers/
 41  src/scripts/      39  src/plugins/      26  src/core/
 22  src/utils/        12  src/config/        3  src/persona/
  2  src/types/         2  src/supabase/      2  src/scheduler/
  1  src/constants/     1  src/bin/
```

### 1.3 Monolithes (top 8 par lignes)

```
3907  src/core/index.ts                        classe BotCore — 96 méthodes
1575  src/plugins/whatsapp/group_manager/index.ts
1460  src/core/transport/baileys.ts
1361  src/providers/index.ts                   classe ProviderRouter — 40 méthodes
1294  src/services/agentic/Planner.ts
 837  src/core/handlers/schedulerHandler.ts
 793  src/core/context/TieredContextLoader.ts
 750  src/services/monitoring/DatabaseMonitor.ts
```

### 1.4 Matrice de couplage inter-dossiers (arêtes A→B)

```
95  core     -> services
36  plugins  -> services
29  core     -> utils
28  services -> utils
16  services -> providers
10  services -> core        ⚠ REMONTANTE
 9  plugins  -> core        ⚠ REMONTANTE
 4  providers-> core        ⚠ REMONTANTE
```

→ **3 cycles structurels** : `services ↔ core`, `providers ↔ core`,
`plugins → core` (retour via chargement dynamique).

### 1.5 Hubs (in-degree — nombre de fichiers importateurs)

```
49  src/utils/safeFs.ts            40  src/services/supabase.ts
35  src/providers/requireModel.ts  34  src/providers/types.ts
23  src/providers/index.ts         22  src/services/redisClient.ts
18  src/core/ServiceContainer.ts   14  src/services/workingMemory.ts
13  src/core/types/BotTypes.ts
```

### 1.6 Problèmes structurels identifiés

| Id | Problème | Preuve |
|---|---|---|
| **P1** | `BotCore` monolithique | 3907 lignes, 96 méthodes, 22 imports dynamiques |
| **P2** | `ProviderRouter` monolithique | 1361 lignes, 40 méthodes |
| **P3** | Les canaux (WhatsApp, CLI, TUI) sont enfouis dans `core/transport/` | ils ne sont pas du « core », ils en sont les consommateurs |
| **P4** | Les outils/plugins sont répartis sur 6 emplacements | `plugins/`, `services/tools/`, `core/handlers/`, `scripts/`, `services/agentic/`, `utils/` |
| **P5** | `services/` est un fourre-tout | 20 fichiers à plat + 15 sous-dossiers, sans axe commun |
| **P6** | **Doublon `audioConverter`** | `utils/audioConverter.ts` (201 l. : `oggToPcm`, `wavToOgg`, `cleanupTempFiles`) vs `services/audio/audioConverter.ts` (117 l. : `convertOggToPcm`) — implémentations **divergentes** |
| **P7** | **Triple ambiguïté `geminiLive`** | `providers/geminiLive.ts` (422 l.), `providers/adapters/geminiLive.ts` (134 l.), `services/audio/geminiLiveProvider.ts` (689 l.) |
| **P8** | **Violation backend → TUI** | `core/transport/TuiServerTransport.ts` et `core/security/PermissionManager.ts` importent `src/tui/transport/HiveTransport.js` |
| **P9** | Shims morts | `src/core/cli.ts` et `src/core/transport/cli.ts` (7 lignes chacun, `@deprecated`) |
| **P10** | Alias TS inutilisés | 7 déclarés dans `tsconfig.json`, 0 référencé dans le code |
| **P11** | 35 adaptateurs LLM « orphelins » | jamais importés statiquement — chargés par nom de fichier au runtime |
| **P12** | `src/scripts/` mélange deux natures | 17 outils d'exploitation + 22 sondes de test manuelles |
| **P13** | Doublon de test | `tests/unit/PermissionManager.test.ts` **et** `tests/unit/core/permissionManager.test.ts` |
| **P14** | Artefacts commités | `src/scripts/tools_output.txt`, `src/tests/scratch-ajv.ts`, `src/temp/voice_cache/` |

### 1.7 Risques runtime invisibles à `tsc` — à traiter en priorité

- **R1 — Chargement dynamique des adaptateurs LLM.**
  `src/providers/index.ts:1330-1345` construit un chemin
  `join(__dirname, 'adapters', fileName + '.js')` puis `pathToFileURL(...)`.
  Le `catch` **avale** `ERR_MODULE_NOT_FOUND` : un adaptateur déplacé cesse de
  fonctionner **sans erreur visible**. `tsc` ne détecte rien.
- **R2 — Scan de répertoires du plugin loader.**
  `src/plugins/loader.ts:151,225,608` fait `safeReaddir(__dirname)` et suppose
  une arborescence à **2 niveaux** (`category/plugin`). L'arborescence cible en
  aurait 3 → chargement silencieusement vide.
- **R3 — 66 occurrences de `__dirname`/`import.meta.url` sur 29 fichiers.**
  Chaque déplacement modifie la résolution des chemins relatifs. Échec au
  runtime uniquement.
- Concentration des imports dynamiques :
  `ServiceContainer.ts` (47), `core/index.ts` (22),
  `plugins/whatsapp/group_manager/index.ts` (13), `schedulerHandler.ts` (13).

---

## ② Architecture cible

### 2.1 Principe directeur

Découpage **par axe de responsabilité**, pas par nature technique. Chaque
dossier de premier niveau répond à une seule question :

| Dossier | Question à laquelle il répond | Fichiers |
|---|---|---|
| `main.ts` | Comment le processus démarre-t-il ? | 1 |
| `bootstrap/` | Comment les dépendances sont-elles câblées ? | 3 |
| `channels/` | Par où entrent et sortent les messages ? | 11 |
| `agent/` | Quelle est la boucle de décision de l'agent ? | 30 |
| `cognition/` | Comment l'agent raisonne-t-il et planifie-t-il ? | 9 |
| `memory/` | Que retient l'agent, et pour combien de temps ? | 13 |
| `tools/` | Que sait faire l'agent dans le monde extérieur ? | 39 |
| `llm/` | Comment parle-t-on aux modèles de langage ? | 45 |
| `media/` | Comment transforme-t-on audio / image / vidéo ? | 7 |
| `platform/` | Quelles APIs tierces non-LLM consomme-t-on ? | 12 |
| `infra/` | Quels sont les I/O techniques (DB, cache, files) ? | 16 |
| `shared/` | Quels utilitaires purs sont réutilisés partout ? | 14 |
| `domain/` | Quels types métier sont indépendants de tout ? | 1 |
| `config/` | Comment la configuration est-elle chargée/validée ? | 12 |
| `ops/` | Quels scripts d'exploitation existent hors runtime ? | 17 |
| `tests/` | Comment vérifie-t-on le système ? | 91 |
| `types/` | Quelles déclarations ambiantes globales existent ? | 2 |
| *(suppression)* | Artefacts et shims morts à retirer | 4 |
| | **Total** | **327** |

### 2.2 Arborescence cible

```
src/
├── main.ts                          ← ex src/bin/hive-mind.ts
│
├── bootstrap/                       (3)  câblage DI, cycle de vie
│   ├── container.ts                 ← core/ServiceContainer.ts
│   ├── lifecycle.ts
│   └── registry.ts
│
├── channels/                        (11) entrées/sorties de messages
│   ├── ChannelPort.ts               interface commune
│   ├── whatsapp/                    baileys, jidHelper, presence, media
│   ├── cli/
│   └── tui/                         adaptateur serveur uniquement
│
├── agent/                           (30) boucle de décision
│   ├── AgentCore.ts                 ← découpe de core/index.ts
│   ├── handlers/
│   ├── pipeline/
│   └── security/
│
├── cognition/                       (9)  raisonnement, planification
│   ├── planner/
│   ├── reflection/
│   └── context/
│
├── memory/                          (13) persistance sémantique
│   ├── working/
│   ├── facts/
│   ├── episodic/
│   └── vector/
│
├── tools/                           (39) capacités actionnables
│   ├── ToolPort.ts
│   ├── registry.ts                  ← plugins/loader.ts (manifeste, cf. R2)
│   ├── whatsapp/
│   ├── web/
│   ├── system/
│   └── media/
│
├── llm/                             (45) accès aux modèles
│   ├── LlmPort.ts                   ← providers/types.ts
│   ├── router/                      ← découpe de providers/index.ts
│   ├── adapters/
│   │   ├── native/
│   │   └── compatible/              (27 adaptateurs OpenAI-compatibles)
│   └── streaming/
│
├── media/                           (7)  transformation de flux binaires
│   ├── audio/
│   └── image/
│
├── platform/                        (12) APIs tierces non-LLM
│
├── infra/                           (16) I/O techniques
│   ├── db/
│   ├── cache/
│   ├── queue/
│   └── observability/
│
├── shared/                          (14) utilitaires purs, zéro dépendance
│   ├── fs/          ← utils/safeFs.ts (49 importateurs)
│   ├── text/
│   ├── lang/
│   ├── net/
│   └── observability/
│
├── domain/                          (1)  types métier agnostiques
├── config/                          (12) schemas/ + runtime/
├── types/                           (2)  déclarations ambiantes
├── ops/                             (17) scripts hors runtime
└── tests/                           (91) unit/ integration/ probes/
```

### 2.3 Règle de dépendance — niveaux

```
Niveau 0 :  shared/   domain/   types/
Niveau 1 :  infra/    config/
Niveau 2 :  llm/      memory/   platform/   media/
Niveau 3 :  cognition/  tools/
Niveau 4 :  agent/
Niveau 5 :  channels/
Niveau 6 :  bootstrap/  main.ts
Hors graphe : ops/   tests/
```

**Invariant** : un module de niveau N peut importer un module de niveau ≤ N,
jamais > N. Toute inversion requise passe par une interface définie au niveau
le plus bas (`ChannelPort`, `ToolPort`, `LlmPort`).

Ceci élimine par construction les 3 cycles de §1.4 :
- `services → core` (10 arêtes) : les ex-`services` deviennent
  `infra/`+`platform/`+`memory/` (niveaux 1-2), le core devient `agent/`
  (niveau 4) → le sens s'inverse naturellement.
- `providers → core` (4 arêtes) : `llm/` (niveau 2) ne peut plus atteindre
  `agent/` (niveau 4) → passage par `LlmPort`.
- `plugins → core` (9 arêtes) : `tools/` (niveau 3) → passage par `ToolPort`.

---

## ③ Décisions de nommage

### 3.1 Renommages de premier niveau

| Actuel | Cible | Justification |
|---|---|---|
| `src/providers/` | `src/llm/` | « provider » est ambigu (provider de quoi ?) ; le dossier ne contient que des accès LLM |
| `src/plugins/` | `src/tools/` | Le vocabulaire du domaine agentique est « tool », pas « plugin » ; aligne avec `ToolPort` |
| `src/core/transport/` | `src/channels/` | Un transport WhatsApp n'est pas du noyau : c'est une frontière d'E/S |
| `src/utils/` | `src/shared/{fs,text,lang,net,media,observability}/` | `utils` est un anti-pattern fourre-tout ; 22 fichiers sans axe commun |
| `src/bin/hive-mind.ts` | `src/main.ts` | Point d'entrée unique, visible à la racine |
| `src/scripts/` (ops) | `src/ops/` | Distingue exploitation et sondes de test |
| `src/scripts/` (sondes) | `src/tests/probes/` | 22 sondes manuelles relèvent des tests |

### 3.2 Renommages ciblés

| Actuel | Cible | Justification |
|---|---|---|
| `src/services/memory.ts` | `src/memory/facts/factsMemory.ts` | Le fichier gère des faits, pas « la mémoire » en général |
| `src/utils/jidHelper.ts` | `src/channels/whatsapp/jidHelper.ts` | Un JID est un identifiant **spécifique WhatsApp** — ce n'est pas un utilitaire générique |
| `src/core/ServiceContainer.ts` | `src/bootstrap/container.ts` | Rôle réel : câblage DI au démarrage |
| `src/providers/types.ts` | `src/llm/LlmPort.ts` | 34 importateurs : c'est le contrat, pas un sac de types |
| `src/plugins/loader.ts` | `src/tools/registry.ts` | Devient un registre explicite (cf. R2) |

### 3.3 Résolutions de doublons/ambiguïtés

- **P6 `audioConverter`** : les deux implémentations divergent. Le plan les
  **conserve toutes deux** sous `media/audio/` avec des noms distincts
  (`pcmConverter.ts` / `oggConverter.ts`). **La fusion est hors périmètre**
  (elle modifie du comportement) et fait l'objet de la question **Q6**.
- **P7 `geminiLive`** : rôles distincts →
  `llm/adapters/native/geminiLive.ts` (adaptateur),
  `llm/streaming/geminiLiveSession.ts` (session temps réel),
  `media/audio/geminiLiveAudio.ts` (pipeline audio).
- **P13 doublon de test** : les deux fichiers sont conservés dans le lot 16 ;
  la déduplication est signalée mais non exécutée (elle supprime des assertions).

### 3.4 Alias TypeScript

Les 7 alias actuels sont **inutilisés (P10)**. Cible : 6 alias, effectivement
adoptés lors de la réécriture des imports.

```jsonc
"paths": {
  "@shared/*":    ["src/shared/*"],
  "@domain/*":    ["src/domain/*"],
  "@infra/*":     ["src/infra/*"],
  "@llm/*":       ["src/llm/*"],
  "@memory/*":    ["src/memory/*"],
  "@config/*":    ["src/config/*"]
}
```

Les niveaux 3-6 (`cognition`, `tools`, `agent`, `channels`, `bootstrap`)
**n'ont volontairement pas d'alias** : leurs imports doivent rester relatifs et
courts, ce qui rend une violation de niveau visible à la lecture
(`../../../agent/` saute aux yeux).

---

## ④ Séquence des lots (L0 → L17)

Format imposé : `Lot N. [Action] -> verify: [Preuve]`

Chaque lot est **atomique** : un commit, une vérification, un point de retour
arrière (`git revert`). Aucun lot ne démarre tant que le précédent n'a pas
produit sa preuve.

### Lot 0 — Filet de sécurité (aucun déplacement)

- **Action** : geler une référence comportementale avant tout mouvement.
  1. `git checkout -b restructure/global`
  2. Générer l'inventaire de référence :
     `node /tmp/mapping.mjs > .GCC/artifacts/mapping_baseline.txt`
  3. Écrire `ops/verify-structure.mjs` : script qui lit le graphe Graphify et
     **échoue** si une arête viole la règle de niveaux (§2.3).
  4. Écrire `ops/verify-dynamic-imports.mjs` : script qui résout les **261**
     imports dynamiques relatifs et **échoue** si une cible n'existe pas sur
     disque. C'est la seule parade à **R1**/**R3**.
  5. Capturer la baseline : `npm run build && tsc --noEmit && npm test`
- **Verify** :
  ```
  node ops/verify-dynamic-imports.mjs   → 261/261 résolus, 0 manquant
  node ops/verify-structure.mjs          → baseline enregistrée
  npm test                               → N tests passés (référence)
  ```
- **Bloquant** : si `verify-dynamic-imports` échoue **déjà** en baseline, le
  problème préexiste et doit être corrigé avant tout déplacement.

### Lot 1 — Point d'entrée (1 fichier)

- **Action** : `git mv src/bin/hive-mind.ts src/main.ts`.
  Mettre à jour `package.json` (`main`, `bin`, `scripts.start`),
  `Dockerfile`, `railway.json`/`Procfile`.
- **Verify** : `npm run build && node dist/main.js --version` → affiche la version.

### Lot 2 — Socle niveau 0-1 : `domain/`, `types/`, `config/` (15 fichiers)

- **Action** : créer `src/domain/`, réorganiser `src/config/` en
  `config/schemas/` (code) + `config/runtime/` (JSON).
  Déplacer `core/types/BotTypes.ts` → `domain/bot/BotTypes.ts` (13 réfs).
- **Verify** : `tsc --noEmit` → 0 erreur ; `node ops/verify-dynamic-imports.mjs` → 0 manquant.
- **Attention** : les 7 fichiers JSON de `config/` sont-ils lus par chemin
  relatif ? Vérifier avant : `grep -rn "config/.*\.json" src/ --include=*.ts`.

### Lot 3 — `shared/` (14 fichiers)

- **Action** : éclater `src/utils/` en `shared/{fs,text,lang,net,media,observability}/`.
  `utils/safeFs.ts` → `shared/fs/safeFs.ts` : **49 importateurs**, le plus gros
  fan-in du projet. `utils/jidHelper.ts` **sort de shared** → lot 5 (`channels/whatsapp/`).
- **Verify** : `tsc --noEmit` → 0 erreur ; `grep -rc "from.*shared/fs/safeFs" src/ | wc -l` → 49.
- **Invariant à vérifier** : `shared/` ne doit importer **aucun** autre dossier
  de `src/`. `node ops/verify-structure.mjs --only=shared` → 0 arête sortante.

### Lot 4 — `infra/` (19 fichiers)

- **Action** : extraire les I/O techniques de `services/` vers
  `infra/{db,cache,queue,observability}/`.
  Concerne notamment `services/supabase.ts` (**40 importateurs**) et
  `services/redisClient.ts` (22 importateurs).
- **Verify** : `tsc --noEmit` → 0 ; `npm run test:unit` → 0 régression.

### Lot 5 — `channels/` (29 fichiers)

- **Action** : `core/transport/` → `channels/`. Définir `channels/ChannelPort.ts`.
  `utils/jidHelper.ts` → `channels/whatsapp/jidHelper.ts`.
  **Traiter P8** : `TuiServerTransport.ts` et `security/PermissionManager.ts`
  importent `src/tui/transport/HiveTransport.js` → inverser via `ChannelPort`.
  ⚠ Ceci **modifie du code** au-delà d'un déplacement → dépend de **Q1**.
- **Verify** : `tsc --noEmit` → 0 ;
  `grep -rn "from.*['\"].*tui/" src/ --include=*.ts | grep -v "^src/tui/"` → **0 résultat**.
- **Risque** : `core/transport/baileys.ts` fait 1460 lignes et concentre la
  connexion WhatsApp. Le déplacer sans le découper (le découpage est au lot 11).

### Lot 6 — `bootstrap/` (11 fichiers)

- **Action** : `core/ServiceContainer.ts` → `bootstrap/container.ts`.
  ⚠ Ce fichier contient **47 imports dynamiques** — le plus fort taux du projet.
- **Verify** : `node ops/verify-dynamic-imports.mjs` → 47/47 résolus ;
  `node dist/main.js --dry-run` → conteneur initialisé sans exception.

### Lot 7 — `memory/` (12 fichiers)

- **Action** : regrouper `services/workingMemory.ts` (14 réfs),
  `services/memory.ts` → `memory/facts/factsMemory.ts`, et les couches
  episodic/vector.
- **Verify** : `tsc --noEmit` → 0 ; `npm run test:unit -- memory` → passe.

### Lot 8 — `media/` (7 fichiers)

- **Action** : rassembler audio/image sous `media/`.
  **Traiter P6** : renommer les deux `audioConverter` en `pcmConverter.ts` et
  `oggConverter.ts` — **sans fusionner** (cf. Q6).
- **Verify** : `tsc --noEmit` → 0 ; test d'un aller-retour ogg→pcm→ogg.

### Lot 9 — `platform/` (9 fichiers)

- **Action** : isoler les intégrations tierces non-LLM.
- **Verify** : `tsc --noEmit` → 0.

### Lot 10 — `cognition/` (13 fichiers)

- **Action** : `services/agentic/Planner.ts` (1294 l.) → `cognition/planner/`,
  `core/context/TieredContextLoader.ts` (793 l.) → `cognition/context/`.
- **Verify** : `tsc --noEmit` → 0 ; `npm run test:unit -- planner` → passe.

### Lot 11 — Découpage des monolithes (2 fichiers → N)

- **Action** : découper `core/index.ts` (3907 l., 96 méthodes) en
  `agent/AgentCore.ts` + modules `agent/pipeline/`, et `providers/index.ts`
  (1361 l., 40 méthodes) en `llm/router/`.
- **⚠ EXÉCUTÉ EN DERNIER** — c'est le seul lot qui modifie la structure interne
  du code, pas seulement l'emplacement des fichiers. Il doit s'appuyer sur une
  arborescence déjà stabilisée et vérifiée.
- **Verify** : `tsc --noEmit` → 0 ; `npm test` → parité stricte avec la
  baseline du lot 0 ; aucun fichier issu du découpage > 400 lignes.

### Lot 12 — Suppressions (4 fichiers)

- **Action** : supprimer `src/core/cli.ts`, `src/core/transport/cli.ts` (P9,
  shims `@deprecated` de 7 lignes), `src/scripts/tools_output.txt`,
  `src/tests/scratch-ajv.ts` (P14). Ajouter `src/temp/` au `.gitignore`.
- **Verify** : `grep -rn "core/cli\|transport/cli" src/` → 0 résultat ;
  `tsc --noEmit` → 0.

### Lot 13 — `llm/` (44 fichiers)

- **Action** : `providers/` → `llm/`. Séparer
  `llm/adapters/native/` (8) et `llm/adapters/compatible/` (27).
  **Traiter R1** : remplacer la construction de chemin
  `join(__dirname,'adapters',fileName+'.js')` par un **manifeste statique**
  `llm/adapters/manifest.ts` exportant une `Map<string, () => Promise<Module>>`.
  Le `catch` qui avale `ERR_MODULE_NOT_FOUND` doit **relancer** l'erreur si
  l'adaptateur est déclaré au manifeste (fail-closed).
- **Verify** : `node ops/verify-dynamic-imports.mjs` → 35/35 adaptateurs résolus ;
  script de fumée chargeant les 35 adaptateurs → 35 succès, 0 silencieux.
- **Risque majeur** : sans le manifeste, ce lot casse le chargement des 35
  adaptateurs **sans aucune erreur de compilation**.

### Lot 14 — `tools/` (39 fichiers)

- **Action** : `plugins/` → `tools/`. Définir `tools/ToolPort.ts`.
  **Traiter R2** : `plugins/loader.ts` → `tools/registry.ts` avec manifeste
  explicite au lieu de `safeReaddir(__dirname)` sur 2 niveaux.
  ⚠ Dépend de **Q2**.
- **Verify** : au démarrage, le nombre d'outils enregistrés est **identique**
  à la baseline du lot 0 (`node dist/main.js --list-tools | wc -l`).
- **Risque majeur** : l'arborescence cible a 3 niveaux, le scan actuel en gère
  2 → sans manifeste, la liste d'outils devient **vide silencieusement**.

### Lot 15 — `ops/` (17 fichiers)

- **Action** : `scripts/` (partie exploitation) → `ops/`.
  Mettre à jour les `scripts` de `package.json` qui les référencent.
- **Verify** : chaque script d'ops s'exécute en `--dry-run` sans erreur de
  résolution de module.

### Lot 16 — `tests/` (91 fichiers)

- **Action** : `tests/{unit,integration,probes}/`. Les 22 sondes manuelles de
  `scripts/` deviennent `tests/probes/`. Mettre à jour les chemins dans la
  config du runner (vitest/jest).
- **Verify** : `npm test` → **même nombre de tests passés qu'au lot 0**, 0 suite
  non découverte.
- **Note** : P13 (doublon `PermissionManager.test.ts`) est signalé mais non
  résolu ici — la déduplication supprimerait des assertions.

### Lot 17 — Adoption des alias & verrouillage

- **Action** : activer les 6 alias (§3.4), réécrire les imports concernés,
  ajouter la règle ESLint `import/no-restricted-paths` encodant la règle de
  niveaux (§2.3), brancher `ops/verify-structure.mjs` sur la CI.
- **Verify** :
  ```
  npx eslint src --max-warnings=0    → 0 erreur, 0 warning
  node ops/verify-structure.mjs       → 0 violation de niveau
  tsc --noEmit                        → 0 erreur
  npm test                            → parité avec le lot 0
  ```

---

## ⑤ Mitigations & Edge Cases

| Id | Risque | Impact | Mitigation |
|---|---|---|---|
| **R1** | Chargement dynamique des 35 adaptateurs LLM par chemin `__dirname` ; le `catch` avale `ERR_MODULE_NOT_FOUND` | Adaptateurs morts **sans erreur** ; `tsc` vert | Manifeste statique `llm/adapters/manifest.ts` (lot 13) + `ops/verify-dynamic-imports.mjs` en CI + `catch` fail-closed |
| **R2** | `plugins/loader.ts` scanne `__dirname` sur 2 niveaux ; la cible en a 3 | Liste d'outils **vide silencieusement** | Registre explicite `tools/registry.ts` (lot 14) + assertion « nombre d'outils == baseline » |
| **R3** | 66 `__dirname`/`import.meta.url` sur 29 fichiers | Chemins cassés au runtime uniquement | Inventaire préalable ligne par ligne ; audit obligatoire de ces 29 fichiers dans le lot qui les déplace |
| **R4** | 261 imports dynamiques relatifs invisibles à `tsc` | Faux sentiment de sécurité | `ops/verify-dynamic-imports.mjs` exécuté **après chaque lot**, pas seulement à la fin |
| **R5** | 7 fichiers JSON de config potentiellement lus par chemin relatif | Config introuvable au démarrage | `grep` préalable (lot 2) ; si chemin relatif détecté, passer par `config/index.ts` |
| **R6** | Perte de l'historique Git | Revue de code dégradée à long terme | `git mv` exclusivement ; un lot = un commit de déplacement pur, jamais mélangé à une modification de contenu |
| **R7** | Conflits de merge sur branches parallèles | Réintégration coûteuse | Exécuter les lots sur une fenêtre courte ; geler les PR touchant `src/` hors tui |
| **R8** | Le lot 13 déplace 44 fichiers que `plan_provider_protocol_families.md` prévoit de supprimer | Travail redondant sur 27 fichiers | Exécuter le lot 13 **avant** le plan familles : celui-ci supprimera ensuite `llm/adapters/compatible/` d'un bloc (cf. Q5) |
| **R9** | Contrainte matérielle (2 cœurs, ~4,4 Go RAM) | OOM sur `npm test` complet à chaque lot | `tsc --noEmit` (léger) après chaque lot ; `npm test` complet uniquement aux lots 0, 11, 16, 17 ; `free -m` avant |

### Arbitrage explicite

Deux contraintes s'opposent : **« ne rien modifier »** (demande utilisateur) et
**« le code doit continuer de fonctionner »** (invariant #1).

**Règle de précédence retenue** : l'invariant #1 prime. Les lots 5, 13 et 14
modifient le **mécanisme de résolution de modules** (imports statiques/manifestes
au lieu de chemins construits dynamiquement). C'est la condition *sine qua non*
pour que le déplacement ne casse rien. Aucune autre modification de logique
n'est autorisée. Ces trois exceptions sont soumises à validation (Q1, Q2).

---

## ⑥ Vérification de couverture

Script de contrôle : `/tmp/mapping.mjs` (règles de mapping ordonnées +
vérificateur). Sortie factuelle :

```
$ cd /home/omni/Code/HIVE-MIND-RAILWAY && node /tmp/mapping.mjs
total fichiers : 327
mappés        : 327
NON mappés    : 0
```

Répartition par lot (Σ = 327) :

| Lot | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Fichiers | 1 | 15 | 14 | 19 | 29 | 11 | 12 | 7 | 9 | 13 | 2 | 4 | 44 | 39 | 17 | 91 |

Contrôles passés :
- **0 fichier non mappé** sur 327.
- **0 collision** de chemin cible.
- Somme des lots = 327 = inventaire `/tmp/all_files.txt`.

---

## ⑦ Mapping exhaustif des 327 fichiers

### Lot 1 — 1 fichiers

| Chemin actuel | Chemin cible | Justification |
|---|---|---|
| `src/bin/hive-mind.ts` | `src/main.ts` | Point d’entrée unique, remonté à la racine de src/ |

### Lot 2 — 15 fichiers

| Chemin actuel | Chemin cible | Justification |
|---|---|---|
| `src/config/blueprints/deep_researcher.json` | `src/config/blueprints/deep_researcher.json` | Inchangé — déjà cohérent |
| `src/config/blueprints/hive_main.json` | `src/config/blueprints/hive_main.json` | Inchangé — déjà cohérent |
| `src/config/config.json` | `src/config/runtime/config.json` | Données de configuration séparées du code de chargement |
| `src/config/config.schema.ts` | `src/config/schemas/config.schema.ts` | Validateurs Zod/Ajv regroupés |
| `src/config/credentials.json` | `src/config/runtime/credentials.json` | Secrets isolés dans runtime/ |
| `src/config/credentials.schema.ts` | `src/config/schemas/credentials.schema.ts` | Validateurs regroupés |
| `src/config/db-reset-tables.json` | `src/config/runtime/db-reset-tables.json` | Données infra DB |
| `src/config/index.ts` | `src/config/index.ts` | Façade de configuration conservée |
| `src/config/keyResolver.ts` | `src/config/keyResolver.ts` | Résolution de clés API — reste dans config |
| `src/config/models_config.json` | `src/config/runtime/models_config.json` | Déclaratif LLM isolé |
| `src/config/pricing.json` | `src/config/runtime/pricing.json` | Données FinOps |
| `src/config/scheduler.json` | `src/config/runtime/scheduler.json` | Données scheduler |
| `src/core/types/BotTypes.ts` | `src/domain/bot/BotTypes.ts` | Types partagés (13 réfs) — couche domaine agnostique |
| `src/types/tui-globals.d.ts` | `src/types/tui-globals.d.ts` | Déclarations ambiantes — inchangé (typeRoots) |
| `src/types/untyped-modules.d.ts` | `src/types/untyped-modules.d.ts` | Déclarations ambiantes — inchangé |

### Lot 3 — 14 fichiers

| Chemin actuel | Chemin cible | Justification |
|---|---|---|
| `src/utils/TlsImpersonator.ts` | `src/shared/net/TlsImpersonator.ts` | Empreinte TLS — réseau bas niveau |
| `src/utils/audioConverter.ts` | `src/shared/media/audioConverter.ts` | DOUBLON à fusionner (cf. §Doublons) |
| `src/utils/collapseReadSearch.ts` | `src/shared/text/collapseReadSearch.ts` | Compaction de sortie texte |
| `src/utils/dnsHelpers.ts` | `src/shared/net/dnsHelpers.ts` | Réseau bas niveau |
| `src/utils/ffmpegBinary.ts` | `src/shared/media/ffmpegBinary.ts` | Résolution du binaire FFmpeg |
| `src/utils/fileStateCache.ts` | `src/shared/fs/fileStateCache.ts` | Cache d’état de fichiers |
| `src/utils/fuzzyMatcher.ts` | `src/shared/text/fuzzyMatcher.ts` | Recherche approximative pure |
| `src/utils/helpers.ts` | `src/shared/lang/helpers.ts` | Utilitaires de langage génériques |
| `src/utils/logger.ts` | `src/shared/observability/logger.ts` | Journalisation transversale |
| `src/utils/messageSplitter.ts` | `src/shared/text/messageSplitter.ts` | Manipulation de texte pure |
| `src/utils/pidLock.ts` | `src/shared/fs/pidLock.ts` | Verrou par PID sur disque |
| `src/utils/readFileInRange.ts` | `src/shared/fs/readFileInRange.ts` | Lecture FS partielle |
| `src/utils/responseSanitizer.ts` | `src/shared/text/responseSanitizer.ts` | Nettoyage de texte pur |
| `src/utils/safeFs.ts` | `src/shared/fs/safeFs.ts` | Le module le plus importé (70 réfs) — socle FS sécurisé |

### Lot 4 — 19 fichiers

| Chemin actuel | Chemin cible | Justification |
|---|---|---|
| `src/core/ServiceContainer.ts` | `src/bootstrap/ServiceContainer.ts` | Injection de dépendances — composition root |
| `src/core/container.ts` | `src/bootstrap/container.ts` | Façade du conteneur |
| `src/services/ast/TreeSitterService.ts` | `src/infra/ast/TreeSitterService.ts` | Parsing Tree-sitter (natif) — IO |
| `src/services/ast/index.ts` | `src/infra/ast/index.ts` | Façade AST |
| `src/services/ast/queries.ts` | `src/infra/ast/queries.ts` | Requêtes Tree-sitter |
| `src/services/browser/BrowserService.ts` | `src/infra/browser/BrowserService.ts` | Pilotage Playwright — IO |
| `src/services/browser/types.ts` | `src/infra/browser/types.ts` | Contrats du service navigateur |
| `src/services/cleanup.ts` | `src/infra/maintenance/cleanup.ts` | Nettoyage de ressources IO |
| `src/services/envResolver.ts` | `src/infra/env/envResolver.ts` | Résolution d’environnement — IO |
| `src/services/mcpClient.ts` | `src/infra/mcp/mcpClient.ts` | Client MCP externe — IO |
| `src/services/monitoring/DatabaseMonitor.ts` | `src/infra/database/DatabaseMonitor.ts` | Surveillance DB — proche du client DB |
| `src/services/redisClient.ts` | `src/infra/cache/redisClient.ts` | Client Redis (30 réfs) — couche IO |
| `src/services/state/IdentityMap.ts` | `src/infra/coordination/IdentityMap.ts` | Table d’identités persistée — IO |
| `src/services/state/LockManager.ts` | `src/infra/coordination/LockManager.ts` | Verrous distribués (Redis) — IO |
| `src/services/state/StateManager.ts` | `src/infra/coordination/StateManager.ts` | État persistant partagé — IO |
| `src/services/supabase.ts` | `src/infra/database/supabase.ts` | Client DB (36 réfs) — couche IO |
| `src/supabase/migrations/20260519130000_cma_boost_memory.sql` | `src/infra/database/migrations/20260519130000_cma_boost_memory.sql` | Migrations sous infra/database |
| `src/supabase/supabase_setup.sql` | `src/infra/database/sql/supabase_setup.sql` | DDL regroupé sous infra/database |
| `src/utils/startup.ts` | `src/bootstrap/startup.ts` | Séquence de démarrage — composition root |

### Lot 5 — 29 fichiers

| Chemin actuel | Chemin cible | Justification |
|---|---|---|
| `src/constants/systemPromptSections.ts` | `src/agent/persona/systemPromptSections.ts` | Sections de prompt système — appartient à la persona |
| `src/core/FairnessQueue.ts` | `src/agent/orchestration/FairnessQueue.ts` | File d’équité entre conversations |
| `src/core/blueprint/AgentBlueprint.ts` | `src/agent/blueprint/AgentBlueprint.ts` | Définition déclarative d’agent |
| `src/core/concurrency/SwarmDispatcher.ts` | `src/agent/orchestration/SwarmDispatcher.ts` | Répartition concurrente |
| `src/core/context/TieredContextLoader.ts` | `src/agent/context/TieredContextLoader.ts` | Chargement de contexte par paliers |
| `src/core/events.ts` | `src/agent/events/eventBus.ts` | Bus d’événements interne (12 réfs) |
| `src/core/handlers/groupHandler.ts` | `src/agent/jobs/groupHandler.ts` | Traitement des événements de groupe |
| `src/core/handlers/index.ts` | `src/agent/jobs/index.ts` | Façade des handlers de jobs |
| `src/core/handlers/schedulerHandler.ts` | `src/agent/jobs/schedulerHandler.ts` | Traitement des tâches planifiées (837 l.) |
| `src/core/orchestrator.ts` | `src/agent/orchestration/orchestrator.ts` | Orchestration des tours d’agent |
| `src/core/security/PermissionManager.ts` | `src/agent/security/PermissionManager.ts` | Autorisations d’outils (fail-closed) |
| `src/persona/README.md` | `src/agent/persona/README.md` | Documentation de la persona |
| `src/persona/lessons_learned.md` | `src/agent/persona/lessons_learned.md` | Corpus de persona |
| `src/persona/prompts/system.md` | `src/agent/persona/prompts/system.md` | Prompt système chargé par TieredContextLoader |
| `src/services/ptc/ProgrammaticExecutor.ts` | `src/agent/ptc/ProgrammaticExecutor.ts` | Exécution de code programmatique (PTC) |
| `src/services/ptc/SafeScriptValidator.ts` | `src/agent/ptc/SafeScriptValidator.ts` | Validation fail-closed des scripts PTC |
| `src/services/ptc/SandboxHelpers.ts` | `src/agent/ptc/SandboxHelpers.ts` | Aides au bac à sable PTC |
| `src/services/ptc/ToolBridge.ts` | `src/agent/ptc/ToolBridge.ts` | Pont outils <-> PTC |
| `src/services/ptc/WakeSystem.ts` | `src/agent/ptc/WakeSystem.ts` | Réveil de tâches PTC |
| `src/services/ptc/index.ts` | `src/agent/ptc/index.ts` | Façade PTC |
| `src/services/ptc/types.ts` | `src/agent/ptc/types.ts` | Contrats PTC |
| `src/services/runtime/ContextWindowService.ts` | `src/agent/context/ContextWindowService.ts` | Gestion de la fenêtre de contexte |
| `src/services/runtime/RuntimeInfrastructure.ts` | `src/agent/runtime/RuntimeInfrastructure.ts` | Infrastructure d’exécution de l’agent |
| `src/utils/ResponseFormatEnforcer.ts` | `src/agent/response/ResponseFormatEnforcer.ts` | Contrat de format de réponse de l’agent |
| `src/utils/botIdentity.ts` | `src/agent/identity/botIdentity.ts` | Identité de l’agent, pas un utilitaire générique |
| `src/utils/toolCallExtractor.ts` | `src/agent/tools/parsing/toolCallExtractor.ts` | Extraction de tool-calls depuis le texte LLM |
| `src/utils/toolErrors.ts` | `src/agent/tools/execution/toolErrors.ts` | Erreurs d’outils — domaine agent |
| `src/utils/toolExecution.ts` | `src/agent/tools/execution/toolExecution.ts` | Exécution d’outils — domaine agent |
| `src/utils/toolValidator.ts` | `src/agent/tools/validation/toolValidator.ts` | Validation d’appels d’outils — domaine agent |

### Lot 6 — 11 fichiers

| Chemin actuel | Chemin cible | Justification |
|---|---|---|
| `src/core/transport/TransportManager.ts` | `src/channels/manager/ChannelManager.ts` | Sélection/cycle de vie des canaux |
| `src/core/transport/TuiServerTransport.ts` | `src/channels/tui/TuiServerChannel.ts` | Canal serveur TUI (WebSocket) |
| `src/core/transport/baileys.ts` | `src/channels/whatsapp/WhatsAppChannel.ts` | Canal WhatsApp (1460 l.) — à découper en Lot 11b |
| `src/core/transport/discord.ts` | `src/channels/discord/DiscordChannel.ts` | Canal Discord |
| `src/core/transport/handlers/antiDeleteHandler.ts` | `src/channels/whatsapp/handlers/antiDeleteHandler.ts` | Anti-suppression WhatsApp |
| `src/core/transport/handlers/audioHandler.ts` | `src/channels/whatsapp/handlers/audioHandler.ts` | Traitement audio entrant WhatsApp |
| `src/core/transport/ink/App.tsx` | `src/channels/cli-ink/App.tsx` | UI Ink du canal CLI (orphelin — statut à trancher) |
| `src/core/transport/ink/InkCLIAdapter.tsx` | `src/channels/cli-ink/InkCLIAdapter.tsx` | Adaptateur Ink (orphelin — statut à trancher) |
| `src/core/transport/interface.ts` | `src/channels/contracts/Channel.ts` | Contrat de canal (7 réfs) — abstraction de la couche |
| `src/core/transport/telegram.ts` | `src/channels/telegram/TelegramChannel.ts` | Canal Telegram |
| `src/utils/jidHelper.ts` | `src/channels/whatsapp/jidHelper.ts` | Spécifique WhatsApp (JID) — appartient au canal |

### Lot 7 — 12 fichiers

| Chemin actuel | Chemin cible | Justification |
|---|---|---|
| `src/services/adminService.ts` | `src/platform/users/adminService.ts` | Droits admin — service applicatif |
| `src/services/events/EventInboxService.ts` | `src/platform/events/EventInboxService.ts` | Boîte de réception d’événements |
| `src/services/events/MailboxWatcher.ts` | `src/platform/events/MailboxWatcher.ts` | Surveillance de boîte d’événements |
| `src/services/feedbackService.ts` | `src/platform/feedback/feedbackService.ts` | Retour utilisateur |
| `src/services/goalsService.ts` | `src/platform/goals/goalsService.ts` | Objectifs utilisateur |
| `src/services/groupService.ts` | `src/platform/groups/groupService.ts` | Entité groupe — service applicatif |
| `src/services/moderationService.ts` | `src/platform/moderation/moderationService.ts` | Modération de contenu |
| `src/services/quotaManager.ts` | `src/platform/quota/quotaManager.ts` | Quotas & FinOps — transversal applicatif |
| `src/services/socialCueWatcher.ts` | `src/platform/events/socialCueWatcher.ts` | Détecteur de signaux sociaux — piloté par événements |
| `src/services/tagService.ts` | `src/platform/tags/tagService.ts` | Étiquetage — orphelin à réintégrer ou supprimer |
| `src/services/telemetry/ClearcutSimulator.ts` | `src/platform/telemetry/ClearcutSimulator.ts` | Télémétrie applicative |
| `src/services/userService.ts` | `src/platform/users/userService.ts` | Entité utilisateur — service applicatif |

### Lot 8 — 7 fichiers

| Chemin actuel | Chemin cible | Justification |
|---|---|---|
| `src/services/audio/audioConverter.ts` | `src/media/audio/audioConverter.ts` | DOUBLON à fusionner avec utils/audioConverter (cf. §Doublons) |
| `src/services/audio/geminiLiveProvider.ts` | `src/media/audio/live/geminiLiveProvider.ts` | Session audio temps réel Gemini Live |
| `src/services/media/MediaIndexer.ts` | `src/media/indexing/MediaIndexer.ts` | Indexation média |
| `src/services/media/MediaSearch.ts` | `src/media/indexing/MediaSearch.ts` | Recherche média |
| `src/services/transcription/groqSTT.ts` | `src/media/transcription/groqSTT.ts` | Transcription STT Groq |
| `src/services/voice/minimax.ts` | `src/media/voice/minimax.ts` | Implémentation TTS MiniMax |
| `src/services/voice/voiceProvider.ts` | `src/media/voice/voiceProvider.ts` | Orchestration TTS multi-fournisseurs |

### Lot 9 — 9 fichiers

| Chemin actuel | Chemin cible | Justification |
|---|---|---|
| `src/services/agentic/ActionEvaluator.ts` | `src/cognition/planning/ActionEvaluator.ts` | Évaluation d’actions planifiées |
| `src/services/agentic/Planner.ts` | `src/cognition/planning/Planner.ts` | Planification (1294 l.) — cœur cognitif |
| `src/services/agentic/SubAgentEngine.ts` | `src/cognition/subagents/SubAgentEngine.ts` | Moteur de sous-agents |
| `src/services/consciousnessService.ts` | `src/cognition/reflection/consciousnessService.ts` | Boucle de réflexion |
| `src/services/consolidationService.ts` | `src/cognition/reflection/consolidationService.ts` | Consolidation mémoire |
| `src/services/dreamService.ts` | `src/cognition/reflection/dreamService.ts` | Consolidation onirique |
| `src/services/knowledgeWeaver.ts` | `src/cognition/knowledge/knowledgeWeaver.ts` | Tissage de connaissances |
| `src/services/learning/LearningEngine.ts` | `src/cognition/learning/LearningEngine.ts` | Apprentissage par retour |
| `src/services/mindos/DriverSystem.ts` | `src/cognition/drivers/DriverSystem.ts` | Système de pulsions/drivers |

### Lot 10 — 13 fichiers

| Chemin actuel | Chemin cible | Justification |
|---|---|---|
| `src/services/agentMemory.ts` | `src/memory/agent/agentMemory.ts` | Mémoire de l’agent |
| `src/services/ai/EmbeddingsService.ts` | `src/memory/embeddings/EmbeddingsService.ts` | Embeddings texte — support de la mémoire |
| `src/services/ai/MultimodalEmbeddingService.ts` | `src/memory/embeddings/MultimodalEmbeddingService.ts` | Embeddings multimodaux |
| `src/services/anchor/AnchorStateManager.ts` | `src/memory/anchor/AnchorStateManager.ts` | Ancrage d’état de fichiers |
| `src/services/anchor/hashDictionary.ts` | `src/memory/anchor/hashDictionary.ts` | Dictionnaire de hachage d’ancres |
| `src/services/anchor/index.ts` | `src/memory/anchor/index.ts` | Façade ancrage |
| `src/services/anchor/lineHashing.ts` | `src/memory/anchor/lineHashing.ts` | Hachage par ligne |
| `src/services/graphMemory.ts` | `src/memory/graph/graphMemory.ts` | Mémoire en graphe |
| `src/services/memory.ts` | `src/memory/facts/factsMemory.ts` | Mémoire factuelle — nom explicite au lieu de memory.ts |
| `src/services/memory/ActionMemory.ts` | `src/memory/action/ActionMemory.ts` | Mémoire d’actions |
| `src/services/memory/MemoryDecay.ts` | `src/memory/lifecycle/MemoryDecay.ts` | Décroissance mémoire |
| `src/services/memory/SemanticMemory.ts` | `src/memory/semantic/SemanticMemory.ts` | Mémoire sémantique vectorielle |
| `src/services/workingMemory.ts` | `src/memory/working/workingMemory.ts` | Mémoire de travail (15 réfs) |

### Lot 11 — 2 fichiers

| Chemin actuel | Chemin cible | Justification |
|---|---|---|
| `src/core/index.ts` | `src/agent/** (DÉCOUPAGE — cf. §Lot 11)` | Monolithe 3907 lignes / 96 méthodes à éclater |
| `src/providers/index.ts` | `src/llm/** (DÉCOUPAGE — cf. §Lot 11)` | Monolithe 1361 lignes (ProviderRouter 40 méthodes) |

### Lot 12 — 4 fichiers

| Chemin actuel | Chemin cible | Justification |
|---|---|---|
| `src/core/cli.ts` | `SUPPRESSION (shim @deprecated)` | Ré-export mort vers scripts/cli-legacy — 7 lignes |
| `src/core/transport/cli.ts` | `SUPPRESSION (shim @deprecated)` | Ré-export mort vers scripts/cli-legacy — 7 lignes |
| `src/scripts/tools_output.txt` | `SUPPRESSION (artefact)` | Sortie de débogage commitée par erreur |
| `src/tests/scratch-ajv.ts` | `SUPPRESSION (brouillon)` | Fichier de brouillon Ajv |

### Lot 13 — 44 fichiers

| Chemin actuel | Chemin cible | Justification |
|---|---|---|
| `src/providers/adapters/ai21.ts` | `src/llm/adapters/compatible/ai21.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/alibaba.ts` | `src/llm/adapters/compatible/alibaba.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/anthropic.ts` | `src/llm/adapters/anthropic/anthropicAdapter.ts` | Adaptateur natif Anthropic |
| `src/providers/adapters/antigravity.ts` | `src/llm/adapters/anthropic/antigravityAdapter.ts` | Adaptateur Antigravity |
| `src/providers/adapters/baseten.ts` | `src/llm/adapters/compatible/baseten.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/cerebras.ts` | `src/llm/adapters/compatible/cerebras.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/cloudflare.ts` | `src/llm/adapters/compatible/cloudflare.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/codestral.ts` | `src/llm/adapters/compatible/codestral.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/codex.ts` | `src/llm/adapters/openai/codexAdapter.ts` | Adaptateur Codex |
| `src/providers/adapters/codexProtocol.ts` | `src/llm/adapters/openai/codexProtocol.ts` | Protocole Codex |
| `src/providers/adapters/cohere.ts` | `src/llm/adapters/compatible/cohere.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/fireworks.ts` | `src/llm/adapters/compatible/fireworks.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/gemini.ts` | `src/llm/adapters/gemini/geminiAdapter.ts` | Adaptateur natif Gemini |
| `src/providers/adapters/geminiCli.ts` | `src/llm/adapters/gemini/geminiCliAdapter.ts` | Adaptateur Gemini CLI (OAuth) |
| `src/providers/adapters/geminiLive.ts` | `src/llm/adapters/gemini/geminiLiveAdapter.ts` | Adaptateur Gemini Live (nom désambiguïsé) |
| `src/providers/adapters/geminiTTS.ts` | `src/llm/adapters/tts/geminiTTS.ts` | TTS Gemini |
| `src/providers/adapters/github.ts` | `src/llm/adapters/compatible/github.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/groq.ts` | `src/llm/adapters/compatible/groq.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/gttsTTS.ts` | `src/llm/adapters/tts/gttsTTS.ts` | TTS gTTS |
| `src/providers/adapters/huggingface.ts` | `src/llm/adapters/compatible/huggingface.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/hyperbolic.ts` | `src/llm/adapters/compatible/hyperbolic.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/inferencenet.ts` | `src/llm/adapters/compatible/inferencenet.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/kimi.ts` | `src/llm/adapters/compatible/kimi.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/minimaxTTS.ts` | `src/llm/adapters/tts/minimaxTTS.ts` | TTS MiniMax |
| `src/providers/adapters/mistral.ts` | `src/llm/adapters/compatible/mistral.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/modal.ts` | `src/llm/adapters/compatible/modal.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/moonshot.ts` | `src/llm/adapters/compatible/moonshot.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/nebius.ts` | `src/llm/adapters/compatible/nebius.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/nlpcloud.ts` | `src/llm/adapters/compatible/nlpcloud.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/novita.ts` | `src/llm/adapters/compatible/novita.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/nvidia.ts` | `src/llm/adapters/compatible/nvidia.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/openai.ts` | `src/llm/adapters/openai/openaiAdapter.ts` | Adaptateur natif OpenAI |
| `src/providers/adapters/opencodezen.ts` | `src/llm/adapters/compatible/opencodezen.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/openrouter.ts` | `src/llm/adapters/compatible/openrouter.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/sambanova.ts` | `src/llm/adapters/compatible/sambanova.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/scaleway.ts` | `src/llm/adapters/compatible/scaleway.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/ttsTypes.ts` | `src/llm/adapters/tts/ttsTypes.ts` | Contrats TTS |
| `src/providers/adapters/upstage.ts` | `src/llm/adapters/compatible/upstage.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/adapters/vercel.ts` | `src/llm/adapters/compatible/vercel.ts` | Adaptateur secondaire — candidat à la suppression par le plan familles (ProtocolFamily x HeaderFamily) |
| `src/providers/geminiLive.ts` | `src/llm/adapters/gemini/GeminiLiveSession.ts` | Session Gemini Live (nom désambiguïsé) |
| `src/providers/geminiTypes.ts` | `src/llm/adapters/gemini/geminiTypes.ts` | Types propres à Gemini |
| `src/providers/requireModel.ts` | `src/llm/contracts/requireModel.ts` | Garde de résolution de modèle (35 réfs) |
| `src/providers/toolIds.ts` | `src/llm/contracts/toolIds.ts` | Identifiants d’outils normalisés |
| `src/providers/types.ts` | `src/llm/contracts/types.ts` | Contrats LLM (34 réfs) |

### Lot 14 — 39 fichiers

| Chemin actuel | Chemin cible | Justification |
|---|---|---|
| `src/plugins/base/admin/index.ts` | `src/tools/catalog/admin/index.ts` | Outils d’administration |
| `src/plugins/base/dev_tools/ASTTools.ts` | `src/tools/catalog/dev/code/ASTTools.ts` | Manipulation d’AST |
| `src/plugins/base/dev_tools/BashTool.ts` | `src/tools/catalog/dev/shell/BashTool.ts` | Exécution shell |
| `src/plugins/base/dev_tools/BrowserTools.ts` | `src/tools/catalog/dev/browser/BrowserTools.ts` | Pilotage de navigateur |
| `src/plugins/base/dev_tools/FileEditTool.ts` | `src/tools/catalog/dev/fs/FileEditTool.ts` | Édition de fichiers |
| `src/plugins/base/dev_tools/FileState.ts` | `src/tools/catalog/dev/fs/FileState.ts` | État de fichiers pour l’édition |
| `src/plugins/base/dev_tools/LSPTool.ts` | `src/tools/catalog/dev/code/LSPTool.ts` | Interrogation LSP |
| `src/plugins/base/dev_tools/PersistentShell.ts` | `src/tools/catalog/dev/shell/PersistentShell.ts` | Shell persistant |
| `src/plugins/base/dev_tools/SearchTools.ts` | `src/tools/catalog/dev/fs/SearchTools.ts` | Recherche dans les fichiers |
| `src/plugins/base/dev_tools/SpawnSubAgentTool.ts` | `src/tools/catalog/dev/agent/SpawnSubAgentTool.ts` | Lancement de sous-agent |
| `src/plugins/base/dev_tools/SystemScratchpadTool.ts` | `src/tools/catalog/dev/agent/SystemScratchpadTool.ts` | Bloc-notes système |
| `src/plugins/base/dev_tools/index.ts` | `src/tools/catalog/dev/index.ts` | Manifeste du paquet d’outils dev |
| `src/plugins/base/goals/index.ts` | `src/tools/catalog/goals/index.ts` | Outils d’objectifs |
| `src/plugins/base/mcp_tools/index.ts` | `src/tools/catalog/mcp/index.ts` | Passerelle d’outils MCP |
| `src/plugins/base/memory/index.ts` | `src/tools/catalog/memory/index.ts` | Outils de mémoire |
| `src/plugins/base/sys_interaction/index.ts` | `src/tools/catalog/sys_interaction/index.ts` | Interaction système (651 l.) |
| `src/plugins/base/system/index.ts` | `src/tools/catalog/system/index.ts` | Outils système |
| `src/plugins/loader.ts` | `src/tools/runtime/PluginLoader.ts` | Chargeur de plugins (scan de répertoires — cf. §Risques) |
| `src/plugins/media/tts/index.ts` | `src/tools/catalog/media/tts/index.ts` | Synthèse vocale exposée comme outil |
| `src/plugins/system/event_manager/index.ts` | `src/tools/catalog/event_manager/index.ts` | Gestion d’événements (aplatissement de system/) |
| `src/plugins/tools/daily_pulse/index.ts` | `src/tools/catalog/productivity/daily_pulse/index.ts` | Bilan quotidien |
| `src/plugins/tools/daily_pulse/journal_generator.ts` | `src/tools/catalog/productivity/daily_pulse/journal_generator.ts` | Génération de journal |
| `src/plugins/tools/send_email/index.ts` | `src/tools/catalog/comms/send_email/index.ts` | Envoi d’e-mail |
| `src/plugins/tools/send_sticker/index.ts` | `src/tools/catalog/comms/send_sticker/index.ts` | Envoi de sticker |
| `src/plugins/tools/shopping/index.ts` | `src/tools/catalog/productivity/shopping/index.ts` | Assistant achats |
| `src/plugins/tools/shopping/shopping_agent.ts` | `src/tools/catalog/productivity/shopping/shopping_agent.ts` | Agent d’achats |
| `src/plugins/tools/translate/index.ts` | `src/tools/catalog/productivity/translate/index.ts` | Traduction |
| `src/plugins/tools/visual_reporter/index.ts` | `src/tools/catalog/productivity/visual_reporter/index.ts` | Rapport visuel |
| `src/plugins/web/crawlfire_web/index.ts` | `src/tools/catalog/knowledge/crawlfire_web/index.ts` | Crawl web |
| `src/plugins/web/deep_research/index.ts` | `src/tools/catalog/knowledge/deep_research/index.ts` | Recherche approfondie |
| `src/plugins/web/deep_research/research_agent.ts` | `src/tools/catalog/knowledge/deep_research/research_agent.ts` | Agent de recherche |
| `src/plugins/web/duckduck_search/index.ts` | `src/tools/catalog/knowledge/duckduck_search/index.ts` | Recherche DuckDuckGo |
| `src/plugins/web/google_ai_search/index.ts` | `src/tools/catalog/knowledge/google_ai_search/index.ts` | Recherche Google AI |
| `src/plugins/web/wikipedia/index.ts` | `src/tools/catalog/knowledge/wikipedia/index.ts` | Recherche Wikipédia |
| `src/plugins/whatsapp/group_manager/actions.ts` | `src/tools/catalog/whatsapp/group_manager/actions.ts` | Actions de groupe |
| `src/plugins/whatsapp/group_manager/database.ts` | `src/tools/catalog/whatsapp/group_manager/database.ts` | Persistance de groupe |
| `src/plugins/whatsapp/group_manager/index.ts` | `src/tools/catalog/whatsapp/group_manager/index.ts` | Gestion de groupe (1575 l.) — à découper en Lot 11c |
| `src/plugins/whatsapp/group_manager/processor.ts` | `src/tools/catalog/whatsapp/group_manager/processor.ts` | Traitement de groupe |
| `src/plugins/whatsapp/sticker/index.ts` | `src/tools/catalog/whatsapp/sticker/index.ts` | Stickers WhatsApp |

### Lot 15 — 17 fichiers

| Chemin actuel | Chemin cible | Justification |
|---|---|---|
| `src/scheduler/dbMonitoring.ts` | `src/ops/scheduler/dbMonitoring.ts` | Surveillance DB planifiée |
| `src/scheduler/index.ts` | `src/ops/scheduler/index.ts` | Planificateur de tâches |
| `src/scripts/audit-group.ts` | `src/ops/cli/audit-group.ts` | Audit de groupe (script npm) |
| `src/scripts/check-redis.ts` | `src/ops/cli/check-redis.ts` | Diagnostic Redis |
| `src/scripts/cli-legacy/cli.ts` | `src/ops/cli-legacy/cli.ts` | CLI héritée (remplacée par le TUI) |
| `src/scripts/cli-legacy/transport-cli.ts` | `src/ops/cli-legacy/transport-cli.ts` | Transport CLI hérité |
| `src/scripts/debug-wa-metadata.js` | `src/ops/debug/debug-wa-metadata.js` | Débogage de métadonnées WhatsApp |
| `src/scripts/fix-missing-usernames.ts` | `src/ops/cli/fix-missing-usernames.ts` | Correctif de données (script npm) |
| `src/scripts/generate-blueprint.js` | `src/ops/codegen/generate-blueprint.js` | Génération de blueprint |
| `src/scripts/health-check.ts` | `src/ops/cli/health-check.ts` | Diagnostic de santé (outil opérationnel) |
| `src/scripts/ingest_docs.js` | `src/ops/codegen/ingest_docs.js` | Ingestion de documentation |
| `src/scripts/ping_bot.ts` | `src/ops/cli/ping_bot.ts` | Sonde de disponibilité |
| `src/scripts/ping_bot_user.ts` | `src/ops/cli/ping_bot_user.ts` | Sonde côté utilisateur |
| `src/scripts/rename_gm.js` | `src/ops/codegen/rename_gm.js` | Renommage de masse |
| `src/scripts/repair-session.ts` | `src/ops/cli/repair-session.ts` | Réparation de session (script npm) |
| `src/scripts/repair-test-sessions.ts` | `src/ops/cli/repair-test-sessions.ts` | Réparation de sessions de test |
| `src/scripts/update_gemma.js` | `src/ops/codegen/update_gemma.js` | Mise à jour de modèle |

### Lot 16 — 91 fichiers

| Chemin actuel | Chemin cible | Justification |
|---|---|---|
| `src/scripts/run_cli_battery.ts` | `src/tests/manual/battery/run_cli_battery.ts` | Lanceur de batterie CLI |
| `src/scripts/test-config.js` | `src/tests/manual/config/test-config.js` | Sonde de configuration |
| `src/scripts/test_10_10.js` | `src/tests/manual/regression/test_10_10.js` | Sonde de régression 10/10 |
| `src/scripts/test_battery/runner.ts` | `src/tests/manual/battery/runner.ts` | Harnais de batterie de tests manuels |
| `src/scripts/test_battery/test_1.ts` | `src/tests/manual/battery/test_1.ts` | Scénario de batterie manuelle |
| `src/scripts/test_battery/test_10.ts` | `src/tests/manual/battery/test_10.ts` | Scénario de batterie manuelle |
| `src/scripts/test_battery/test_2.ts` | `src/tests/manual/battery/test_2.ts` | Scénario de batterie manuelle |
| `src/scripts/test_battery/test_3.ts` | `src/tests/manual/battery/test_3.ts` | Scénario de batterie manuelle |
| `src/scripts/test_battery/test_4.ts` | `src/tests/manual/battery/test_4.ts` | Scénario de batterie manuelle |
| `src/scripts/test_battery/test_5.ts` | `src/tests/manual/battery/test_5.ts` | Scénario de batterie manuelle |
| `src/scripts/test_battery/test_6.ts` | `src/tests/manual/battery/test_6.ts` | Scénario de batterie manuelle |
| `src/scripts/test_battery/test_7.ts` | `src/tests/manual/battery/test_7.ts` | Scénario de batterie manuelle |
| `src/scripts/test_battery/test_8.ts` | `src/tests/manual/battery/test_8.ts` | Scénario de batterie manuelle |
| `src/scripts/test_battery/test_9.ts` | `src/tests/manual/battery/test_9.ts` | Scénario de batterie manuelle |
| `src/scripts/test_cli_e2e.ts` | `src/tests/manual/e2e/test_cli_e2e.ts` | E2E CLI manuel |
| `src/scripts/test_codex_adapter.ts` | `src/tests/manual/llm/test_codex_adapter.ts` | Sonde d’adaptateur Codex |
| `src/scripts/test_codex_connection.ts` | `src/tests/manual/llm/test_codex_connection.ts` | Sonde de connexion Codex |
| `src/scripts/test_email.ts` | `src/tests/manual/tools/test_email.ts` | Sonde d’envoi d’e-mail |
| `src/scripts/test_fixes.ts` | `src/tests/manual/regression/test_fixes.ts` | Sonde de régression |
| `src/scripts/test_fixes2.ts` | `src/tests/manual/regression/test_fixes2.ts` | Sonde de régression (2) |
| `src/scripts/test_full_page_screenshot.ts` | `src/tests/manual/tools/test_full_page_screenshot.ts` | Sonde de capture d’écran |
| `src/scripts/test_models.js` | `src/tests/manual/llm/test_models.js` | Sonde de modèles |
| `src/scripts/test_plugins_e2e.ts` | `src/tests/manual/e2e/test_plugins_e2e.ts` | E2E plugins manuel |
| `src/scripts/test_remaining_e2e.ts` | `src/tests/manual/e2e/test_remaining_e2e.ts` | E2E résiduel manuel |
| `src/scripts/test_wa_e2e.ts` | `src/tests/manual/e2e/test_wa_e2e.ts` | E2E WhatsApp manuel |
| `src/tests/e2e/bot.e2e.test.ts` | `src/tests/e2e/bot.e2e.test.ts` | E2E automatisé — inchangé |
| `src/tests/e2e/harness.test.ts` | `src/tests/e2e/harness.test.ts` | Harnais E2E — inchangé |
| `src/tests/integration/core.test.ts` | `src/tests/integration/agent.test.ts` | Renommé selon la cible src/agent/ |
| `src/tests/integration/services.test.ts` | `src/tests/integration/services.test.ts` | Intégration multi-services — inchangé |
| `src/tests/integration/tui_websocket.test.ts` | `src/tests/integration/tui_websocket.test.ts` | Intégration canal TUI — inchangé |
| `src/tests/smart_router_v2.test.ts` | `src/tests/unit/llm/smart_router_v2.test.ts` | Test unitaire égaré à la racine de tests/ |
| `src/tests/unit/BrowserService.test.ts` | `src/tests/unit/infra/BrowserService.test.ts` | Miroir de src/infra/browser/ |
| `src/tests/unit/PermissionManager.test.ts` | `src/tests/unit/agent/security/PermissionManager.test.ts` | Miroir de src/agent/security/ (doublon à fusionner) |
| `src/tests/unit/blueprint/AgentBlueprint.test.ts` | `src/tests/unit/agent/blueprint/AgentBlueprint.test.ts` | Miroir de src/agent/blueprint/ |
| `src/tests/unit/config/keyResolver.test.ts` | `src/tests/unit/config/keyResolver.test.ts` | Miroir de src/config/ |
| `src/tests/unit/config/models_config_policy.test.ts` | `src/tests/unit/config/models_config_policy.test.ts` | Politique de models_config.json |
| `src/tests/unit/core/compactHistory.test.ts` | `src/tests/unit/agent/history/compactHistory.test.ts` | Miroir du découpage de BotCore (historique) |
| `src/tests/unit/core/cotExtraction.test.ts` | `src/tests/unit/agent/react/cotExtraction.test.ts` | Miroir du découpage de BotCore (ReAct) |
| `src/tests/unit/core/eventBus.test.ts` | `src/tests/unit/agent/events/eventBus.test.ts` | Miroir de src/agent/events/ |
| `src/tests/unit/core/permissionManager.test.ts` | `src/tests/unit/agent/security/permissionManager.test.ts` | Miroir de src/agent/security/ (doublon à fusionner) |
| `src/tests/unit/core/responseSanitizer.test.ts` | `src/tests/unit/shared/text/responseSanitizer.test.ts` | Miroir de src/shared/text/ |
| `src/tests/unit/core/tieredContextLoader.test.ts` | `src/tests/unit/agent/context/tieredContextLoader.test.ts` | Miroir de src/agent/context/ |
| `src/tests/unit/core/toolValidator.test.ts` | `src/tests/unit/agent/tools/toolValidator.test.ts` | Miroir de src/agent/tools/validation/ |
| `src/tests/unit/mindos/DriverSystem.test.ts` | `src/tests/unit/cognition/drivers/DriverSystem.test.ts` | Miroir de src/cognition/drivers/ |
| `src/tests/unit/plugins/LSPTool.test.ts` | `src/tests/unit/tools/dev/LSPTool.test.ts` | Miroir de src/tools/catalog/dev/code/ |
| `src/tests/unit/plugins/SystemScratchpadTool.test.ts` | `src/tests/unit/tools/dev/SystemScratchpadTool.test.ts` | Miroir de src/tools/catalog/dev/agent/ |
| `src/tests/unit/plugins/bashTool.test.ts` | `src/tests/unit/tools/dev/bashTool.test.ts` | Miroir de src/tools/catalog/dev/shell/ |
| `src/tests/unit/plugins/browserTools.test.ts` | `src/tests/unit/tools/dev/browserTools.test.ts` | Miroir de src/tools/catalog/dev/browser/ |
| `src/tests/unit/plugins/dailyPulsePlugin.test.ts` | `src/tests/unit/tools/productivity/dailyPulsePlugin.test.ts` | Miroir de src/tools/catalog/productivity/ |
| `src/tests/unit/plugins/sendEmailPlugin.test.ts` | `src/tests/unit/tools/comms/sendEmailPlugin.test.ts` | Miroir de src/tools/catalog/comms/ |
| `src/tests/unit/plugins/sendStickerPlugin.test.ts` | `src/tests/unit/tools/comms/sendStickerPlugin.test.ts` | Miroir de src/tools/catalog/comms/ |
| `src/tests/unit/plugins/shoppingPlugin.test.ts` | `src/tests/unit/tools/productivity/shoppingPlugin.test.ts` | Miroir de src/tools/catalog/productivity/ |
| `src/tests/unit/plugins/translatePlugin.test.ts` | `src/tests/unit/tools/productivity/translatePlugin.test.ts` | Miroir de src/tools/catalog/productivity/ |
| `src/tests/unit/plugins/visualReporterPlugin.test.ts` | `src/tests/unit/tools/productivity/visualReporterPlugin.test.ts` | Miroir de src/tools/catalog/productivity/ |
| `src/tests/unit/providers/antigravity.test.ts` | `src/tests/unit/llm/adapters/antigravity.test.ts` | Miroir de src/llm/adapters/anthropic/ |
| `src/tests/unit/providers/geminiCli.test.ts` | `src/tests/unit/llm/adapters/geminiCli.test.ts` | Miroir de src/llm/adapters/gemini/ |
| `src/tests/unit/ptc/ProgrammaticExecutor.test.ts` | `src/tests/unit/agent/ptc/ProgrammaticExecutor.test.ts` | Miroir de src/agent/ptc/ |
| `src/tests/unit/ptc/ToolBridge.test.ts` | `src/tests/unit/agent/ptc/ToolBridge.test.ts` | Miroir de src/agent/ptc/ |
| `src/tests/unit/runtime/ConstraintManifold.test.ts` | `src/tests/unit/agent/runtime/ConstraintManifold.test.ts` | Miroir de src/agent/runtime/ |
| `src/tests/unit/services/ClearcutSimulator.test.ts` | `src/tests/unit/platform/telemetry/ClearcutSimulator.test.ts` | Miroir de src/platform/telemetry/ |
| `src/tests/unit/services/LearningEngine.test.ts` | `src/tests/unit/cognition/learning/LearningEngine.test.ts` | Miroir de src/cognition/learning/ |
| `src/tests/unit/services/MediaIndexer.test.ts` | `src/tests/unit/media/indexing/MediaIndexer.test.ts` | Miroir de src/media/indexing/ |
| `src/tests/unit/services/MediaSearch.test.ts` | `src/tests/unit/media/indexing/MediaSearch.test.ts` | Miroir de src/media/indexing/ |
| `src/tests/unit/services/MemoryDecay.test.ts` | `src/tests/unit/memory/lifecycle/MemoryDecay.test.ts` | Miroir de src/memory/lifecycle/ |
| `src/tests/unit/services/MultimodalEmbeddingService.test.ts` | `src/tests/unit/memory/embeddings/MultimodalEmbeddingService.test.ts` | Miroir de src/memory/embeddings/ |
| `src/tests/unit/services/Planner.test.ts` | `src/tests/unit/cognition/planning/Planner.test.ts` | Miroir de src/cognition/planning/ |
| `src/tests/unit/services/RuntimeInfrastructure.test.ts` | `src/tests/unit/agent/runtime/RuntimeInfrastructure.test.ts` | Miroir de src/agent/runtime/ |
| `src/tests/unit/services/SafeScriptValidator.test.ts` | `src/tests/unit/agent/ptc/SafeScriptValidator.test.ts` | Miroir de src/agent/ptc/ |
| `src/tests/unit/services/SubAgentEngine.test.ts` | `src/tests/unit/cognition/subagents/SubAgentEngine.test.ts` | Miroir de src/cognition/subagents/ |
| `src/tests/unit/services/envResolver.test.ts` | `src/tests/unit/infra/env/envResolver.test.ts` | Miroir de src/infra/env/ |
| `src/tests/unit/services/eventSystem.test.ts` | `src/tests/unit/platform/events/eventSystem.test.ts` | Miroir de src/platform/events/ |
| `src/tests/unit/services/identityMap.test.ts` | `src/tests/unit/infra/coordination/identityMap.test.ts` | Miroir de src/infra/coordination/ |
| `src/tests/unit/services/supabaseDb.test.ts` | `src/tests/unit/infra/database/supabaseDb.test.ts` | Miroir de src/infra/database/ |
| `src/tests/unit/services/userService.test.ts` | `src/tests/unit/platform/users/userService.test.ts` | Miroir de src/platform/users/ |
| `src/tests/unit/transport/handlers/antiDeleteHandler.test.ts` | `src/tests/unit/channels/whatsapp/antiDeleteHandler.test.ts` | Miroir de src/channels/whatsapp/handlers/ |
| `src/tests/unit/transport/handlers/audioHandler.test.ts` | `src/tests/unit/channels/whatsapp/audioHandler.test.ts` | Miroir de src/channels/whatsapp/handlers/ |
| `src/tests/unit/tui/text-buffer-pure.test.ts` | `src/tests/unit/tui/text-buffer-pure.test.ts` | HORS PÉRIMÈTRE (teste src/tui/) — inchangé |
| `src/tests/unit/tui/vim-buffer-actions.test.ts` | `src/tests/unit/tui/vim-buffer-actions.test.ts` | HORS PÉRIMÈTRE (teste src/tui/) — inchangé |
| `src/tests/unit/tui/windowTitle.test.ts` | `src/tests/unit/tui/windowTitle.test.ts` | HORS PÉRIMÈTRE (teste src/tui/) — inchangé |
| `src/tests/unit/utils/ResponseFormatEnforcer.test.ts` | `src/tests/unit/agent/response/ResponseFormatEnforcer.test.ts` | Miroir de src/agent/response/ |
| `src/tests/unit/utils/TlsImpersonator.test.ts` | `src/tests/unit/shared/net/TlsImpersonator.test.ts` | Miroir de src/shared/net/ |
| `src/tests/unit/utils/audioConverter.test.ts` | `src/tests/unit/shared/media/audioConverter.test.ts` | Miroir de src/shared/media/ (après fusion du doublon) |
| `src/tests/unit/utils/collapseReadSearch.test.ts` | `src/tests/unit/shared/text/collapseReadSearch.test.ts` | Miroir de src/shared/text/ |
| `src/tests/unit/utils/fileStateCache.test.ts` | `src/tests/unit/shared/fs/fileStateCache.test.ts` | Miroir de src/shared/fs/ |
| `src/tests/unit/utils/fuzzyMatcher.test.ts` | `src/tests/unit/shared/text/fuzzyMatcher.test.ts` | Miroir de src/shared/text/ |
| `src/tests/unit/utils/helpers.test.ts` | `src/tests/unit/shared/lang/helpers.test.ts` | Miroir de src/shared/lang/ |
| `src/tests/unit/utils/jidHelper.test.ts` | `src/tests/unit/channels/whatsapp/jidHelper.test.ts` | Miroir de src/channels/whatsapp/ |
| `src/tests/unit/utils/messageSplitter.test.ts` | `src/tests/unit/shared/text/messageSplitter.test.ts` | Miroir de src/shared/text/ |
| `src/tests/unit/utils/pidLock.test.ts` | `src/tests/unit/shared/fs/pidLock.test.ts` | Miroir de src/shared/fs/ |
| `src/tests/unit/utils/readFileInRange.test.ts` | `src/tests/unit/shared/fs/readFileInRange.test.ts` | Miroir de src/shared/fs/ |
| `src/tests/unit/utils/toolExecution.test.ts` | `src/tests/unit/agent/tools/toolExecution.test.ts` | Miroir de src/agent/tools/execution/ |


---

## ⑧ Questions ouvertes (réponse requise avant exécution)

| Id | Question | Recommandation |
|---|---|---|
| **Q1** | Autoriser l'inversion de dépendance `channels → tui` (lot 5) ? Cela modifie du code au-delà d'un simple déplacement. | **Oui.** C'est la seule voie vers l'invariant de flux unidirectionnel ; sinon le backend reste couplé à la couche de présentation. |
| **Q2** | Remplacer le scan de répertoires du plugin loader par un manifeste explicite (lot 14) ? | **Oui.** Sans cela, l'arborescence à 3 niveaux rend la liste d'outils **vide au runtime**, sans erreur. |
| **Q3** | `core/transport/ink/{App,InkCLIAdapter}.tsx` sont orphelins (jamais importés). Conserver ou supprimer ? | À trancher. Le plan les conserve par défaut (lot 5). |
| **Q4** | `services/tagService.ts` et `services/ast/TreeSitterService.ts` (523 l.) sont orphelins. Conserver ? | À trancher. Le plan les conserve par défaut. |
| **Q5** | `plan_provider_protocol_families.md` supprimera 27 des 44 fichiers du lot 13. Exécuter le lot 13 quand même ? | **Oui.** Le plan familles opérera ensuite sur une base propre et supprimera un dossier entier plutôt que des fichiers épars. |
| **Q6** | P6 : les deux `audioConverter` divergent. Fusionner (change le comportement) ou coexister sous deux noms ? | Le plan les fait **coexister** (lot 8). La fusion serait un travail distinct, à planifier séparément. |

---

## ⑨ Ordre d'exécution recommandé

```
Lot 0   filet de sécurité (baseline + scripts de vérification)
  ↓
Lot 1   main.ts
  ↓
Lot 2   domain/ types/ config/          niveau 0-1
  ↓
Lot 3   shared/                          niveau 0
  ↓
Lot 4   infra/                           niveau 1
  ↓
Lots 7,8,9,10  memory/ media/ platform/ cognition/    niveau 2-3 (parallélisables)
  ↓
Lot 5   channels/                        niveau 5   [dépend de Q1]
  ↓
Lot 6   bootstrap/                       niveau 6
  ↓
Lot 13  llm/                             [manifeste — traite R1]
  ↓
Lot 14  tools/                           [manifeste — traite R2, dépend de Q2]
  ↓
Lot 15  ops/
  ↓
Lot 12  suppressions
  ↓
Lot 16  tests/
  ↓
Lot 17  alias + verrouillage ESLint/CI
  ↓
Lot 11  découpage des monolithes         ⚠ EN DERNIER
```

**Justification de l'ordre** : construction ascendante par niveaux (le socle
avant les consommateurs), afin que chaque lot n'ait à corriger que des imports
vers des emplacements **déjà stabilisés**. Le lot 11 (découpage) arrive en
dernier car c'est le seul qui modifie la structure interne du code : le faire
plus tôt cumulerait deux sources de risque sur un même commit.

---

## ⑩ Critères de succès

| Id | Critère | Commande de preuve |
|---|---|---|
| **C1** | Compilation propre | `tsc --noEmit` → 0 erreur |
| **C2** | Lint propre, sans directive de suppression | `npx eslint src --max-warnings=0` → 0/0, et `grep -rn "eslint-disable\|@ts-ignore\|@ts-nocheck" src/` sans nouvelle occurrence vs baseline |
| **C3** | Parité des tests | `npm test` → nombre de tests passés identique au lot 0 |
| **C4** | Imports dynamiques tous résolus | `node ops/verify-dynamic-imports.mjs` → 261/261, 0 manquant |
| **C5** | Flux unidirectionnel respecté | `node ops/verify-structure.mjs` → 0 arête de niveau N → >N |
| **C6** | Zéro import backend → TUI | `grep -rn "from.*tui/" src/ --include=*.ts \| grep -v "^src/tui/"` → 0 |
| **C7** | Démarrage fonctionnel | `node dist/main.js --version` puis démarrage réel : connexion canal établie, nombre d'outils enregistrés == baseline |
| **C8** | Historique préservé | `git log --follow` sur 10 fichiers déplacés au hasard → historique antérieur visible |

**Distinction statique / fonctionnel** : C1, C2, C5, C8 sont statiques et
constituent le socle minimal. **C3, C4, C6, C7 sont fonctionnels** et seuls
capables de prouver que la restructuration n'a rien cassé. Un `tsc` vert ne
prouve rien sur les 261 imports dynamiques.

---

## 📌 Ce que ce plan ne fait PAS

- Aucune modification de logique métier, de signature ou de contrat public.
- Aucune fusion des doublons `audioConverter` (P6) — signalé, non exécuté.
- Aucune déduplication des tests `PermissionManager` (P13) — signalé.
- Aucune suppression d'orphelins hors Q3/Q4 validées.
- Aucun changement de dépendances npm.

Les seules modifications de code autorisées concernent le **mécanisme de
résolution de modules** (lots 5, 13, 14), condition nécessaire au maintien du
comportement runtime après déplacement.
