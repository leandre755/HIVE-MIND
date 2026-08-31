# Execution Plan: Architecture Smart Provider à 2 Couches (Layer 1 x Layer 0) & Évolutions GenerationParams

## 📋 Target Invariant & Pre-requisites

- **Target Invariant**: Le provider est découpé en deux couches indépendantes :
  1. **Layer 1 (Smart Service & Reliability Layer)** : Gère les recettes de services applicatifs (`services_config.json`), les fallbacks en cascade, le score de fiabilité/malus dynamique, et le circuit breaker.
  2. **Layer 0 (Execution & Wire Transport Layer)** : Gère la configuration d'endpoint (`models_config.json`), l'assemblage des protocoles/headers, l'exécution HTTP et la conversion des erreurs.
- **Deux Modes d'Appel**:
  - `completerService(serviceName, params)` -> Passe par Layer 1 puis Layer 0.
  - `completerDirect(modelId, params)` -> Appel direct à Layer 0 sans fallback.
- **Convertisseur Intelligent `GenerationParams`**:
  - Ne doit pas purger aveuglément les paramètres spécifiques lors d'un fallback entre familles de modèles, mais les **convertir** (ex: `thinking_budget` Anthropic (nombre de tokens) <-> `reasoning_effort` OpenAI/DeepSeek (`low`/`medium`/`high`)).
- **Règle Stricte SSE Streaming**:
  - Le fallback automatique par Layer 1 n'est autorisé que si **0 octet (0 token)** n'a été transmis au client. Dès l'émission du 1er chunk SSE, la tentative est verrouillée.

---

## 🛠️ Step-by-Step Sequence

### Step 1: Découplage de la Configuration (`services_config.json` vs `models_config.json`)

- [x] **Action**: Isoler `services_config.json` pour la Layer 1 (définitions de `services` comme `AGENTIC`, `FAST_CHAT` avec `primary`, `fallbacks`, `max_retries`, `reliability_rules`) et conserver `models_config.json` uniquement pour la Layer 0 (`protocol_family`, `header_family`, `base_url`, `capabilities`).
- [x] **Verify**: `npx tsc --noEmit`.
- **Verification Proof**:

```text
npx tsc --noEmit -> Exit 0 (Clean)
```

### Step 2: Implémenter Layer 0 (Execution Layer - Mode Direct API)

- [x] **Action**: Créer/refondre le module d'exécution Layer 0 pour prendre un `modelId` explicite, sérialiser via `ProtocolFamily` x `HeaderFamily`, et émettre des erreurs domaine typées (`RateLimitError`, `ServerError`, `NetworkError`, `InvalidRequestError`).
- [x] **Verify**: `npx tsc --noEmit && npm test -- --grep "Layer 0"`.
- **Verification Proof**:

```text
npx tsc --noEmit -> Exit 0
src/tests/unit/providers/layer0.test.ts -> PASS
```

### Step 3: Implémenter Layer 1 (Smart Layer - Service Recipes, Malus & Circuit Breaker)

- [x] **Action**: Créer le gestionnaire de services et de fiabilité Layer 1. Implémenter le registre de santé (`ModelHealthRegistry`), l'application des malus sur HTTP 5xx/Timeout/429, et la boucle de fallback séquentielle avec verrouillage SSE (fallback refusé si stream entamé).
- [x] **Verify**: `npx tsc --noEmit && npm test -- --grep "Layer 1"`.
- **Verification Proof**:

```text
npx tsc --noEmit -> Exit 0
src/tests/unit/providers/layer1.test.ts -> 12/12 PASS
```

### Step 4: Refonte Intelligente de `GenerationParams` (Conversion vs Purge)

- [x] **Action**: Mettre à jour `src/providers/GenerationParams.ts` pour intégrer des règles de conversion bidirectionnelle (`adaptParamsForTargetModel`) :
  - `thinking_budget` (Anthropic, float/int) <-> `reasoning_effort` (OpenAI/DeepSeek, enum `low`|`medium`|`high`).
  - Maintien de la cohérence de température et plafonds `max_output_tokens` selon la famille cible.
- [x] **Verify**: `npx tsc --noEmit && npm test -- --grep "GenerationParams"`.
- **Verification Proof**:

```text
npx tsc --noEmit -> Exit 0
npx eslint src/providers/ -> 0 error 0 warning
```

---

## 🚀 Ingénierie Avancée `GenerationParams` (Backlog / À Faire)

- [ ] **Prompt-Caching Automatique** : Détection et pose dynamique des marqueurs de cache (`cache_control: { type: "ephemeral" }` pour Anthropic, structures adaptées pour OpenAI/DeepSeek) sur les instructions système et contextes longs.
- [ ] **Température Dynamique par Type de Tâche** : Ajustement automatique de la température selon la catégorie d'agent (`AGENTIC`/Code -> 0.1-0.2, Fast Chat/Synthèse -> 0.7, Créatif -> 0.9).
- [ ] **Niveau de Réflexion Adaptatif** : Calcul dynamique du budget de raisonnement selon la taille et la complexité du prompt utilisateur.
- [ ] **Plafond Dynamique `max_tokens`** : Calcul automatique des tokens de réponse restants par rapport aux limites de fenêtres d'entrée/sortie du provider.

---

## ⚠️ Mitigations & Edge Cases

- **Risk SSE Mid-Stream Failure** : Interruption de connexion pendant le streaming SSE après émission partielle.
  - **Mitigation** : Verrouiller `streamStarted = true` au premier token. Si une erreur survient après `streamStarted = true`, rejeter l'erreur directement sans exécuter la boucle de fallback Layer 1.
- **Risk Incompatible Params on Fallback** : Un paramètre spécifique fait crasher l'API de fallback.
  - **Mitigation** : Conversion systématique dans `GenerationParams` vers le dialecte du modèle cible, avec dégradation gracieuse uniquement pour les clés strictly inconvertibles.

---

## 🔍 AUDIT DE L'EXISTANT — "Mensonges" constatés (lecture seule, 2026-08-05)

> Constats factuels relevés dans `src/providers/index.ts` (1475 lignes, classe `ProviderRouter`) et les adapters.

### M1. Classification d'erreur par regex sur le message — faux positifs garantis
- **Fichier** : `src/providers/index.ts:222` → `const QUOTA_ERROR_PATTERN = /(quota|limit|rate|429|insufficient)/;`
- **Preuve d'exécution** :
  ```text
  $ node -e "const p=/(quota|limit|rate|429|insufficient)/; ..."
  'failed to generate content'        -> true   (contient "rate" dans geneRATE)
  'context length limit exceeded'     -> true   (erreur 400 NON retriable classée quota)
  ```
- **Conséquence** : une erreur `400 context_length_exceeded` est traitée comme un quota → la clé est bloquée à tort (`_blockExhaustedKey`, 60 s), toutes les clés sont brûlées une par une, et le modèle n'est jamais pénalisé. Inversement, le mot `generate` déclenche un faux positif quota sur toute erreur de génération.
- **Correctif cible Layer 0** : classification par **code HTTP** (`status`) + code d'erreur provider, jamais par sous-chaîne du message.

### M2. Aucun timeout sur les adapters natifs — le `timeout_ms` est un mensonge partiel
- **Preuve** : `grep -c "AbortController"` → `openai.ts:0`, `gemini.ts:0`, `anthropic.ts:0`, `groq.ts:0`. Seul `GenericProviderAdapter.ts:319-337` implémente `AbortController` + `DEFAULT_TIMEOUT_MS`.
- **Conséquence** : un `fetch` vers `api.openai.com` (`openai.ts:117`) ou `api.anthropic.com` (`anthropic.ts:205`) peut pendre indéfiniment. La cascade de fallback ne se déclenche jamais — elle attend. La "résilience" annoncée ne couvre pas le cas de panne le plus fréquent (socket suspendu).
- **Correctif cible** : le timeout appartient à **Layer 0**, appliqué uniformément à tout appel, natif ou générique. La `timeout_ms` de la recette Layer 1 borne la tentative entière.

### M3. Circuit Breaker déclenché uniquement sur quota — les 5xx ne l'ouvrent jamais
- **Fichier** : `src/providers/index.ts:533-553` (`_recordFailure`) — le corps entier est enveloppé dans `if (QUOTA_ERROR_PATTERN.test(...))`.
- **Conséquence** : un provider répondant `500`/`502` en continu n'est **jamais** mis en cooldown famille. La cascade le retente à chaque requête, en tête de liste.
- **Correctif cible Layer 1** : malus/cooldown sur `ServerError` et `NetworkError`, pas seulement `RateLimitError`.

### M4. Deux systèmes de fiabilité concurrents sans arbitrage
- **Fichiers** : `circuitStats` (cooldown par **famille**, `index.ts:519-561`) et `modelFailureScore` (score demi-vie 30 min par **modèle**, `index.ts:566-604`).
- **Conséquence** : `_sortModelsByReliability` ne fait que **réordonner** — un modèle à score 10/10 reste tenté. Aucun seuil d'exclusion. Le "circuit breaker" n'existe qu'au niveau famille et le "reliability score" n'a aucun pouvoir de blocage.
- **Correctif cible** : registre unique `ModelHealthRegistry` en Layer 1, avec seuil explicite d'ouverture de circuit **par modèle** ET par famille, règle d'arbitrage déclarée.

### M5. Récursion de fallback non bornée
- **Fichier** : `src/providers/index.ts:1240-1253` (`_retryWithoutForcedFamily`) — rappelle `this.chat(...)` depuis l'intérieur de la boucle de modèles de `_runFamilyModels` (`index.ts:889-896`).
- **Conséquence** : le garde-fou est le seul flag `isFallback`. Le rappel est déclenché **à chaque itération de modèle** de la famille forcée, pas une seule fois après épuisement.
- **Correctif cible** : boucle Layer 1 plate et déterministe sur une chaîne de candidats pré-résolue, borne d'itérations explicite, zéro récursion.

### M6. Layer 1 et Layer 0 fusionnées dans une classe unique
- **Fichier** : `ProviderRouter` mélange recettes de service (`callServiceRecipe:328`), santé/quota (`_selectKeyIndex:1012`), throttling budgétaire KKT (`_applyBudgetThrottling:1101`), traduction filaire (`_prepareWireParams:1153`) et invocation HTTP (`_invokeAdapter:1038`).
- **Conséquence** : impossible d'appeler le mode "API directe" sans traverser toute la machinerie de fallback ; impossible de tester la traduction filaire isolément.
- **Correctif cible** : scission stricte Layer 1 / Layer 0 telle que décrite en tête de plan.

### M7. `_prepareWireParams` ne s'applique qu'aux familles déclaratives
- **Fichier** : `src/providers/index.ts:1163-1177` — sortie anticipée si la famille ne déclare ni `protocol_family` ni `capacites`.
- **Conséquence** : `cohere`, `cloudflare`, `huggingface`, `modal`, `groq` ignorent silencieusement `thinking`, `promptCaching` et les plafonds. Le paramètre est accepté par l'API publique du routeur puis jeté sans avertissement — **mensonge silencieux**.
- **Correctif cible** : Layer 0 doit **toujours** passer par `GenerationParams`, avec un dialecte par défaut explicite et un log/erreur quand une capacité demandée est inatteignable.

### M8. Zéro support streaming dans le routeur
- **Preuve** : `grep -n "stream" src/providers/index.ts` → aucun résultat. Seul `codex.ts:252` streame, et il agrège tout en mémoire (`codexProtocol.ts:221-238`) avant de rendre.
- **Conséquence** : la règle SSE du plan n'est aujourd'hui pas violée — elle est simplement **non implémentée**. Le verrou `streamStarted` doit être conçu **avant** l'ajout du streaming, sinon il sera rétrofité de force dans une boucle récursive (M5).

---

## 🧩 Modèle Cible Complet — Contrats des deux couches

### Layer 0 — `ExecutionLayer` (stateless, déterministe)
```
execute(modelId: string, request: NormalizedRequest, opts: { signal, timeoutMs }): Promise<Result>
executeStream(modelId, request, opts): AsyncIterable<Chunk>
```
Responsabilités **exclusives** :
1. Résoudre `modelId` → `{ base_url, protocol_family, header_family, capabilities }` depuis `models_config.json`.
2. Convertir la requête normalisée via `GenerationParams` vers le dialecte cible (**toujours**, cf. M7).
3. Assembler headers (`ClaudeCodeHeaders` / `StandardBearer` / `XApiKey` / `TokenAuth`).
4. Émettre le `fetch` sous `AbortController` borné (cf. M2).
5. Traduire toute défaillance en **erreur domaine typée** (cf. M1) :

| Erreur domaine | Déclencheur | Retriable | Malus Layer 1 |
|---|---|---|---|
| `InvalidRequestError` | HTTP 400/422, schéma refusé, contexte dépassé | ❌ Non | Aucun |
| `AuthError` | HTTP 401/403 | ❌ Non (clé morte) | Blocage clé |
| `RateLimitError` | HTTP 429 + `Retry-After` | ✅ Autre clé/modèle | Léger |
| `ServerError` | HTTP 500/502/503/504 | ✅ Oui | Fort |
| `NetworkError` | timeout, socket reset, DNS | ✅ Oui | Fort |
| `ContentFilterError` | refus modération | ❌ Non | Aucun |

Layer 0 **ne connaît pas** : recettes, fallback, scores de santé, budget.

### Layer 1 — `SmartLayer` (stateful : santé + budget)
```
call(serviceName: string, messages, overrides?): Promise<Result>
```
Algorithme borné (zéro récursion, cf. M5) :
```
chain = resolveChain(serviceName)            // primary + fallbacks, depuis services_config.json
chain = chain.filter(m => !health.isCircuitOpen(m))
chain = health.sortByScore(chain)
for (const modelId of chain.slice(0, MAX_ATTEMPTS)) {
  for (const key of keyRotation(modelId)) {
    try   { r = await layer0.execute(modelId, req, { timeoutMs }); health.success(modelId); return r }
    catch (e) {
      if (e.retriable === false) throw e          // fail-fast : 400/403/filtre
      health.penalize(modelId, e.malusWeight)
      if (e is RateLimitError) continue           // clé suivante
      break                                       // modèle suivant
    }
  }
}
throw new AllCandidatesFailedError(chain, lastError)
```
Responsabilités **exclusives** : recettes de service, chaîne de fallback, `ModelHealthRegistry` (unifié, cf. M4), circuit breaker sur 5xx **et** quota (cf. M3), throttling budgétaire KKT/FinOps, verrou SSE `streamStarted`.

### Frontière `GenerationParams` — conversion, jamais purge
Placé **entre** les deux couches, appelé par Layer 0 avec les capacités du modèle **effectivement retenu** (donc ré-évalué à chaque bascule de fallback).

| Intention normalisée | → Anthropic | → OpenAI / DeepSeek | → Gemini |
|---|---|---|---|
| `reasoning: { effort }` | `thinking.budget_tokens` (mapping `low`≈1024, `medium`≈4096, `high`≈16384, borné par `max_tokens-1`) | `reasoning_effort: low\|medium\|high` | `thinkingConfig.thinkingBudget` |
| `promptCaching: true` | `cache_control: { type: 'ephemeral' }` sur blocs système/longs | implicite (aucun champ) ou champ dédié provider | `cachedContent` |
| `maxOutputTokens` | `max_tokens` (plancher provider appliqué) | `max_tokens` / `max_completion_tokens` | `generationConfig.maxOutputTokens` |
| `temperature` | borné `[0,1]` | borné `[0,2]` | `generationConfig.temperature` |

**Règle** : la conversion est bidirectionnelle et **sans perte sémantique**. La purge n'est autorisée que pour une intention sans équivalent (ex. `thinking` demandé sur un modèle non-raisonneur) — et doit alors émettre un **avertissement explicite**, jamais un abandon silencieux (cf. M7).

---

## ⚖️ Décisions Tranchées — Simulation des options et justification

> Chaque point ouvert a été simulé sur les trois scénarios de panne réels du système :
> **S1** = clé unique en 429, **S2** = provider entier en 502 pendant 10 min, **S3** = redémarrage
> du process pendant une dégradation. Contexte factuel relevé : déploiement mono-process
> (`package.json:11` → `tsx src/bin/hive-mind.ts start`, aucun cluster/pm2), Redis déjà présent
> (`src/services/redisClient.ts`) et déjà consommé par `src/services/quotaManager.ts` avec un
> mode dégradé fail-closed (`quotaManager.ts:241-256`, blocage total si Redis down > 5 min).

### D1 — Persistance des scores de santé : **mémoire autoritaire + Redis opportuniste**

| Option | S1 (429) | S2 (502 prolongé) | S3 (restart) | Verdict |
|---|---|---|---|---|
| **A.** Mémoire seule | OK | OK | Scores perdus → 1 tentative gâchée par modèle | Acceptable |
| **B.** Redis autoritaire | +1 RTT par candidat dans la boucle chaude | OK | Scores conservés | **Rejeté** |
| **C.** Mémoire autoritaire + write-through Redis best-effort | 0 RTT en lecture | OK | Réhydratation au boot | **Retenu** |

**Pourquoi C** : la distinction est **sémantique, pas technique**. Un quota est une **contrainte
externe facturable** — il doit être persistant et *fail-closed* (dépasser = 429 garanti, voire
facturation). Un score de santé est une **heuristique d'ordonnancement locale** — il doit être
*fail-open* (le perdre coûte au maximum une tentative ratée, dont la seule conséquence est de
recréer le score). Rendre le routage dépendant de Redis pour de l'heuristique étendrait le rayon
de panne du fail-closed de `quotaManager.ts:254` à toute décision de routage : Redis down
bloquerait alors non seulement les quotas mais aussi le choix de modèle. Inacceptable.

L'option B est également rejetée sur la latence : la boucle de sélection lit le score de chaque
candidat de la chaîne à chaque requête. Avec un aller-retour Redis par candidat, on ajoute
N × RTT sur le chemin critique pour une donnée dont la demi-vie est de 30 minutes.

**Implication** : `ModelHealthRegistry` est un module mémoire pur, testable sans I/O. La
réplication Redis est un **observateur optionnel** branché en sortie (`onPenalize` / `onSuccess`),
dont l'échec est avalé et journalisé. Le mono-process actuel rend même cette réplication
non urgente : elle est planifiée mais non bloquante pour la V1.

### D1-bis — Révision sous charge concurrente (cible de déploiement réelle)

> **Contexte produit** : déploiement chez des particuliers, gérants e-commerce et gestionnaires
> de réseaux sociaux. Volumétrie : dizaines à milliers de requêtes/jour, **jusqu'à plusieurs
> centaines en simultané** sur une même instance.

**La conclusion D1 (mémoire autoritaire) est confirmée et renforcée**, mais pour une raison
différente de celle initialement écrite, et elle expose trois défauts de conception que la
concurrence rend critiques.

**Pourquoi la concurrence renforce le choix mémoire** : chaque déploiement est une instance
dédiée à un tenant (mono-process, `package.json:11`). Les centaines de requêtes simultanées
vivent **dans le même process** et partagent donc naturellement le même registre mémoire.
Il n'y a pas de problème de cohérence inter-instances à résoudre. À l'inverse, un registre
Redis autoritaire imposerait, à 300 requêtes concurrentes × N candidats, plusieurs centaines
d'aller-retours Redis par seconde **uniquement pour lire des heuristiques** — saturation
garantie de la connexion déjà utilisée par le comptage de quota, qui est, lui, indispensable.

#### Défaut C1 — Saturation du score par accumulation concurrente (bug bloquant)

`_recordModelFailure` (`index.ts:566-586`) incrémente le score **une fois par requête échouée**.
Simulation du comportement actuel avec 300 requêtes concurrentes sur un provider en panne :

```text
$ node -e "... 300 échecs concurrents, HALF_LIFE=30min ..."
Score apres 300 echecs concurrents : 10.00   (plafond atteint immédiatement)
Minutes pour redescendre sous 2.5  : 60
Minutes pour redescendre sous 1.0  : 100
```

Une panne provider de **5 secondes** touchant 300 requêtes en vol sature le score à 10/10 et
relègue le modèle pendant **100 minutes**. Le système s'auto-inflige une panne 1200× plus
longue que la panne réelle. Le déclin exponentiel a été calibré pour un trafic séquentiel ;
sous charge concurrente il devient une bombe à retardement.

**Correctif retenu — voir D7 ci-dessous.** La coalescence par fenêtre a été envisagée puis
écartée au profit d'un **ratio d'échec sur fenêtre glissante**, après simulation du cas de
dégradation partielle qui la met en défaut (détail et preuves en D7).

#### Défaut C2 — Absence de court-circuit ⇒ amplification de la panne (thundering herd)

Simulation, provider en 502, 300 requêtes simultanées, `MAX_ATTEMPTS=4` :

```text
--- Sans circuit partagé (comportement actuel) ---
Appels HTTP vers endpoint mort : 1200
Sockets simultanées ouvertes   : 300
Temps mur par requête          : 180 s (4 × 45 s de timeout)

--- Avec circuit ouvert au seuil (2 modèles distincts / 60 s) ---
Appels HTTP avant ouverture    : 8
Requêtes suivantes court-circuitées : 298 (échec immédiat, 0 socket)
```

Sans circuit partagé en mémoire, une panne provider se traduit par 1200 sockets vers un endpoint
mort et 180 s de latence par utilisateur. C'est le scénario qui fait tomber l'instance entière,
pas seulement le provider. **Le circuit breaker n'est pas une optimisation à cette échelle : il
est la protection de survie de l'instance**, et il n'est exploitable que parce qu'il est lu en
mémoire à coût nul (un accès `Map`), ce qui serait impossible avec un aller-retour Redis.

#### Défaut C3 — Reprise en masse à la fermeture du circuit (half-open non gardé)

À l'expiration d'un cooldown, les 300 requêtes en attente repartent **simultanément** vers un
provider peut-être encore convalescent, le refont tomber, et rouvrent le circuit. Oscillation
auto-entretenue.

**Correctif retenu — half-open à sonde unique (single-flight)** : à l'expiration du cooldown, le
circuit passe en `HALF_OPEN` et **une seule** requête est autorisée à sonder le provider. Les
autres restent court-circuitées. Succès ⇒ `CLOSED` et libération de toutes. Échec ⇒ retour en
`OPEN` avec cooldown au palier supérieur. Un jeton mémoire (`probeInFlight: boolean`) suffit ;
en Redis il faudrait un verrou distribué avec TTL et gestion d'expiration — complexité sans
contrepartie en mono-process.

#### Ce que la volumétrie change pour les autres décisions

- **D4 (bornage)** : `MAX_ATTEMPTS=4` et `deadlineMs=120000` deviennent des garde-fous de charge
  et plus seulement de coût. À 300 requêtes concurrentes, 4 tentatives de 45 s représentent
  1200 connexions sortantes potentielles. Ajout d'un **plafond de concurrence sortante par
  famille** (`maxInFlightPerFamily`, défaut 32) : au-delà, la requête attend ou bascule
  directement sur le candidat suivant plutôt que d'empiler des sockets.
- **D2 (escalade)** : le seuil « 2 modèles distincts / 60 s » est atteint en quelques
  millisecondes sous charge, ce qui est le comportement voulu — détection quasi instantanée.
  La coalescence de C1 empêche que cette rapidité se transforme en sur-pénalisation.
- **Bornage mémoire** : `modelFailureScore` et `circuitStats` sont naturellement bornés par le
  nombre de modèles et de familles déclarés dans `models_config.json` (constante de config, pas
  fonction du trafic). Aucune fuite mémoire liée à la concurrence. En revanche `usageStats`
  n'est vidé que par `clear()` explicite (`index.ts:1390`) : à surveiller, mais même borne.

#### Réplication Redis : reclassée de « optionnelle » à « exclue de la V1 »

La cible de déploiement (une instance par client) signifie qu'il n'y a **jamais** deux process
partageant les mêmes credentials à coordonner. Le seul bénéfice résiduel de la persistance était
de survivre à un redémarrage — or après redémarrage, le coût est d'exactement une tentative par
modèle pour reconstruire l'état. À comparer au coût permanent d'un chemin Redis dans la boucle
chaude sous 300 requêtes concurrentes. **La réplication est retirée du périmètre** ; elle sera
réintroduite si et seulement si un déploiement multi-instance partageant un même pool de clés
devient réel.

---

## 🎯 D7 — Algorithme de Santé Retenu : Ratio d'Échec sur Fenêtre Glissante à Buckets

> Décision finale sur le mécanisme de scoring, après simulation comparée de 4 algorithmes.
> Remplace intégralement `_recordModelFailure` / `_sortModelsByReliability` (`index.ts:566-604`).

### Étape 1 — Invariance à la concurrence

Score obtenu pour **une même panne de 5 s**, selon le nombre de requêtes en vol :

```text
vol.    A(actuel)   B(coalescence 5s)   C(ratio 60s)   D(échecs consécutifs)
3       3.00        1.00                1.00           3
50      10.00       1.00                1.00           50
300     10.00       1.00                1.00           300
1000    10.00       1.00                1.00           1000
```

A (actuel) et D échouent : le score dépend du trafic, pas de la panne. B et C sont invariants.

### Étape 2 — Test discriminant : dégradation **partielle**

Cas réel le plus fréquent : un provider qui répond correctement à 90 % et échoue à 10 %.
300 req/min pendant 10 min. Il reste largement utilisable, un bon algorithme **doit le conserver**.

```text
A (actuel)      : score = 10/10          => EXCLU à tort
B (coalescence) : score = 10/10          => EXCLU à tort
C (ratio 60s)   : ratio = 0.10 < 0.50    => CONSERVÉ  ✅

--- Panne totale (100 % d'erreur), même volumétrie ---
C (ratio 60s)   : ratio = 1.00 > 0.50    => circuit OUVERT  ✅
```

**C'est le test qui départage.** La coalescence (B) résout la saturation mais reste un **compteur
cumulatif** : à 10 % d'erreur soutenue, chaque fenêtre de 5 s contient au moins un échec, donc
chaque fenêtre coûte 1 point, et le plafond de 10 est atteint en 50 s. B ne fait que **retarder**
le faux positif de A, il ne le supprime pas. Seul un **ratio** distingue « dégradé mais
exploitable » de « hors service », parce qu'il mesure les succès autant que les échecs.

### Étape 3 — Dimensionnement mémoire : buckets circulaires, pas liste d'événements

```text
--- Liste d'événements horodatés (fenêtre 60 s, pic 300 req/s) ---
18 000 entrées par modèle × 40 modèles = 720 000 objets  => inacceptable

--- Compteurs à buckets circulaires (6 buckets de 10 s) ---
12 entiers par modèle × 40 modèles = 480 entiers ≈ 3.75 Ko  => négligeable
Perte de précision : granularité 10 s sur une fenêtre de 60 s
```

La fenêtre glissante est implémentée par **6 buckets circulaires de 10 s**, chacun portant
`{ ok: number, fail: number }`. À chaque événement, on écrit dans le bucket courant ; les buckets
expirés sont remis à zéro à la lecture (pas de timer, cf. règle « éviter les watchers »). Le ratio
est la somme des 6 buckets. Coût constant, aucune allocation par requête.

### Étape 4 — Garde anti-bruit : `MINIMUM_THROUGHPUT`

Un ratio sur faible volume est statistiquement creux : 2 échecs sur 3 requêtes donnent 0.67 et
ouvriraient le circuit à tort. Le circuit ne peut donc s'ouvrir qu'au-delà d'un volume minimal.

```text
P(faux positif | provider sain à 2 % d'erreur) :
  MINIMUM_THROUGHPUT = 10, seuil 0.5  =>  P(≥5 échecs sur 10) = 7.41e-7   => négligeable
```

`MINIMUM_THROUGHPUT = 10` requêtes dans la fenêtre avant qu'une ouverture soit possible. En
dessous, le modèle est réputé sain et reste candidat. Cela couvre nativement le cas des clients à
faible trafic (dizaines de requêtes/jour), pour qui un compteur cumulatif serait ruineux : un seul
incident isolé n'a aucun effet.

### Étape 5 — Séparation des deux rôles : exclure ≠ ordonner

Le défaut M4 était de confondre les deux. Ils sont désormais explicitement distincts, alimentés
par la **même** structure de buckets :

- **Exclusion (binaire)** — `isCircuitOpen(modelId)` : `true` si
  `throughput ≥ MINIMUM_THROUGHPUT && failRatio ≥ 0.5`. C'est le seul mécanisme qui **retire** un
  candidat. Répare M4 (le score actuel n'exclut jamais rien).
- **Ordonnancement (continu)** — `sortByPreference(models)` : trie les candidats non exclus par
  un score composite `0.7 × failRatio + 0.3 × latenceP50Normalisée`. Simulation :

```text
Ordre de préférence (aucun circuit ouvert) :
  A  ratio=0.02  lat=800ms   score=0.094
  B  ratio=0.15  lat=1200ms  score=0.225
  C  ratio=0.40  lat=3000ms  score=0.580
```

**Pourquoi intégrer la latence** : les buckets comptent déjà les succès, donc la latence médiane
est disponible au même coût. Deux modèles fiables mais dont l'un répond 4× plus lentement ne sont
pas équivalents pour l'utilisateur final. La pondération 0.7/0.3 fait primer la fiabilité (un
échec coûte plus qu'une lenteur) sans ignorer le temps de réponse. Ces poids sont des constantes
nommées, ajustables sans changer l'algorithme.

### Paramètres consolidés

| Constante | Valeur | Justification |
|---|---|---|
| `WINDOW_MS` | 60 000 | Aligné sur le seuil de corrélation famille de D2 |
| `BUCKET_COUNT` | 6 | Granularité 10 s ; 3.75 Ko total pour 40 modèles |
| `FAILURE_RATIO_THRESHOLD` | 0.5 | Une majorité d'échecs = hors service ; en dessous, dégradé mais exploitable |
| `MINIMUM_THROUGHPUT` | 10 | P(faux positif) = 7.4e-7 sur provider sain |
| `COOLDOWN_STEPS_MS` | 30 000 / 120 000 / 600 000 | Paliers progressifs, plus courts que l'actuel 1/5/15 min car la détection est désormais fiable |
| `HALF_OPEN_PROBES` | 1 | Sonde unique single-flight (défaut C3) |
| `SORT_WEIGHT_RELIABILITY` | 0.7 | La fiabilité primte sur la vitesse |
| `SORT_WEIGHT_LATENCY` | 0.3 | Départage les modèles également fiables |

### Ce que D7 supprime définitivement

- Le **plafond arbitraire de 10** et la **demi-vie de 30 min** (`index.ts:568-584`) : un ratio sur
  fenêtre glissante s'auto-répare en 60 s sans constante de décroissance à calibrer. Le déclin
  exponentiel devient sans objet.
- La **coalescence de 5 s** (correctif C1 initialement proposé) : rendue inutile, le ratio est
  invariant à la concurrence par construction et non par artifice de fenêtre.
- Le **tri sans exclusion** (`_sortModelsByReliability`, M4) : remplacé par deux fonctions aux
  responsabilités disjointes.

### Machine à états du circuit (par modèle **et** par famille, même algorithme)

```
CLOSED  ──[ratio ≥ 0.5 ET throughput ≥ 10]──▶  OPEN
OPEN    ──[cooldown expiré]────────────────▶  HALF_OPEN
HALF_OPEN ──[sonde unique réussit]─────────▶  CLOSED   (buckets remis à zéro)
HALF_OPEN ──[sonde unique échoue]──────────▶  OPEN     (palier de cooldown suivant)
```

Le même code sert aux deux portées ; seule la clé change (`modelId` ou `familyName`). L'escalade
de D2 alimente les buckets de la **famille** quand 2 modèles distincts échouent en 5xx dans la
fenêtre, et la précédence de containment strict de D2 reste inchangée.

### D2 — Arbitrage famille vs modèle : **portée dérivée de la classe d'erreur, avec escalade**

Le code actuel pénalise **systématiquement** la famille ET le modèle sur toute erreur non-quota
(`index.ts:990-991`). C'est une **erreur de portée** : un seul modèle cassé (ex. modèle retiré du
catalogue → 404) empoisonne les 12 autres modèles sains de sa famille.

| Option | Comportement | Faux positifs | Verdict |
|---|---|---|---|
| **A.** Famille prime toujours (actuel) | 1 modèle mort tue la famille | Élevés | **Rejeté** |
| **B.** Modèle seul | Provider en panne globale retenté 12× | Latence × 12 | **Rejeté** |
| **C.** Portée dérivée de l'erreur + escalade par corrélation | Ciblage exact | Faibles | **Retenu** |

**Pourquoi C** : la portée correcte d'une panne est **déductible de sa nature**, il n'y a donc
aucune raison de deviner :

| Classe d'erreur | Portée du malus | Justification |
|---|---|---|
| `AuthError` (401/403) | **Credential** (la clé, pour toute la famille) | La clé est invalide/révoquée, indépendamment du modèle |
| `RateLimitError` (429) | **Credential + modèle** | Les quotas sont comptés par couple clé×modèle chez la majorité des providers |
| `InvalidRequestError` (400/422) | **Aucune** | Faute de l'appelant, pas du provider — pénaliser fausserait la santé |
| `ContentFilterError` | **Aucune** | Idem : comportement nominal du modèle |
| `ServerError` (5xx) / `NetworkError` | **Modèle**, escaladé en **famille** | Voir règle d'escalade |

**Règle d'escalade (anti-M3)** : si ≥ 2 modèles *distincts* d'une même famille échouent en
`ServerError`/`NetworkError` à l'intérieur d'une fenêtre de 60 s, la panne est corrélée à
l'endpoint et non aux modèles → le circuit **famille** s'ouvre. Un seul modèle en échec reste
une panne modèle. Ce seuil de 2 est le minimum permettant de distinguer les deux causes ; il
évite à la fois le faux positif de A (1 échec ⇒ famille morte) et la latence de B.

**Règle de précédence (containment strict, zéro ambiguïté)** : la famille est un **sur-ensemble**
de ses modèles. Circuit famille ouvert ⇒ tous ses modèles sont sautés, sans exception ni
dérogation pour un modèle au score sain. Un modèle sain derrière un endpoint mort reste
injoignable — l'inverse produirait des tentatives dont on sait par construction qu'elles
échoueront.

### D3 — Rotation de clés : **la politique en Layer 1, la consommation en Layer 0**

C'est le point qui conditionne le plus la structure : il est la **cause racine de M1**.

| Option | Conséquence | Verdict |
|---|---|---|
| **A.** Rotation en Layer 0 | Layer 0 devient stateful (quota) → invariant brisé, M1 reproduit | **Rejeté** |
| **B.** Rotation en Layer 1 avec Layer 0 ignorant des clés | Layer 0 ne peut pas signer sa requête | Incohérent |
| **C.** Layer 1 **choisit** la credential, Layer 0 la **reçoit en paramètre** | Layer 0 reste pur | **Retenu** |

**Pourquoi C** : la sélection de clé exige de lire l'état de quota (Redis) — c'est une
**décision**, donc Layer 1. La signature de la requête exige de connaître la `header_family` —
c'est une **exécution**, donc Layer 0. En injectant la credential comme paramètre explicite
(`execute(modelId, request, { credential, signal, timeoutMs })`), Layer 0 n'a besoin d'aucun
accès au `QuotaManager` et redevient une fonction pure de ses arguments : testable sans Redis,
sans conteneur de services, sans horloge.

**Ce que cela répare** : aujourd'hui `_tryModelAcrossKeys` (`index.ts:947`) doit deviner par regex
si l'erreur justifie de changer de clé (M1), parce que la boucle de clés vit au même niveau que
l'appel HTTP. Après scission, Layer 0 renvoie `RateLimitError` avec son `Retry-After` typé, et
Layer 1 décide de la rotation sur une **donnée**, plus sur une sous-chaîne de texte.

**Corollaire** : `envResolver.getAvailableKeysForProvider()` (`envResolver.ts:126`) et
`quotaManager.getAvailableKeyForModel()` (`quotaManager.ts:291`) sont regroupés derrière une
interface `CredentialProvider` unique, propriété de Layer 1.

### D4 — Bornage : **double borne `MAX_ATTEMPTS` (coût) + `deadlineMs` (latence)**

| Option | Protège le coût | Protège la latence | Verdict |
|---|---|---|---|
| **A.** Compteur seul | Oui | Non — 4 × 60 s = 240 s d'attente | **Rejeté** |
| **B.** Deadline seule | Non — N appels rapides et facturés | Oui | **Rejeté** |
| **C.** Les deux, la première atteinte arrête | Oui | Oui | **Retenu** |

**Pourquoi C** : les deux ressources à protéger sont **orthogonales**. Un compteur seul autorise
une accumulation de timeouts (le scénario S2 : 4 modèles qui pendent 60 s chacun). Une deadline
seule autorise une rafale d'appels facturés qui échouent vite (S1 sur un provider payant).
Aucune des deux ne subsume l'autre, il faut donc les deux.

**Valeurs retenues** : `MAX_ATTEMPTS = 4` appels HTTP réels par requête utilisateur ;
`deadlineMs = 120000` par défaut, surchargeable par recette de service ;
`perAttemptTimeoutMs = 45000` par défaut.

**Mécanique** : un `AbortController` unique porte la deadline globale et est propagé à toutes les
tentatives. Chaque appel Layer 0 reçoit `min(perAttemptTimeoutMs, deadlineRestante)`. Si la
deadline restante passe sous un plancher de **2000 ms**, la boucle s'arrête sans émettre la
tentative : démarrer un appel qu'on sait ne pas pouvoir terminer consomme un quota et une
facturation pour un résultat garanti inutilisable.

### D5 — `completerDirect` : **rotation de clés autorisée, changement de modèle interdit**

| Option | Respect du contrat appelant | Résilience | Verdict |
|---|---|---|---|
| **A.** Appel unique strict | Total | Nulle — 429 sur clé 1 alors que clé 2 est libre | **Rejeté** |
| **B.** Rotation de clés, modèle figé | Total | Correcte | **Retenu** |
| **C.** Paramétrable par appel | — | — | **Rejeté** (surface d'API inutile) |

**Pourquoi B** : le contrat du mode direct est *« l'appelant a choisi le modèle, ne le
contredis pas »*. Changer de modèle **viole** ce contrat : la réponse ne proviendrait pas du
modèle demandé, ce qui invalide tout usage de benchmark, de comparaison ou de sélection
manuelle. Changer de clé ne le viole pas : même modèle, même sémantique de réponse, la
credential est un détail d'infrastructure non observable dans le résultat.

**Règle asymétrique lecture/écriture de la santé** — c'est le point subtil :
- Le mode direct **écrit** dans `ModelHealthRegistry` : une panne observée est une information
  globale, la cacher dégraderait les décisions du mode service.
- Le mode direct **ne lit pas** le circuit pour refuser l'appel : l'appelant a explicitement
  demandé ce modèle. Circuit ouvert ⇒ avertissement journalisé, appel émis quand même.
- Le mode direct **lit** la santé uniquement pour choisir la meilleure credential — une
  optimisation invisible qui ne change pas la cible.

L'option C est rejetée sur un principe de conception : un mode dont le comportement est
paramétrable n'est plus un mode, c'est une configuration. Deux modes aux contrats nets valent
mieux qu'un mode à options.

### D6 — Streaming : **verrou `streamStarted` conçu maintenant, pas rétrofité**

Constat M8 : le routeur n'a aucun support streaming (`grep stream src/providers/index.ts` → vide).
La tentation est de reporter la question. Elle est rejetée.

**Pourquoi maintenant** : le verrou SSE est une **contrainte structurelle sur la forme de la
boucle de fallback**, pas une fonctionnalité additive. Une boucle récursive (M5,
`_retryWithoutForcedFamily:1240`) est **incapable** de porter un verrou correct, car chaque niveau
de récursion possède sa propre vue de l'état d'émission. Ajouter le streaming après coup
imposerait de refaire la boucle — donc de refaire ce plan.

**Contrat retenu** : Layer 1 expose `callStream()` renvoyant un `AsyncIterable`. Un drapeau
`streamStarted` passe irréversiblement à `true` à l'émission du premier chunk vers l'appelant.
Toute erreur survenant alors que `streamStarted === true` est propagée telle quelle, sans
consulter la chaîne de fallback. La sélection de modèle et la première connexion HTTP ont
lieu **avant** toute émission : le fallback couvre donc l'intégralité de la phase où il est
sémantiquement valide.

---

## 📐 Conséquences consolidées sur la structure des modules

```
src/providers/
├── layer0/                          # Exécution pure — zéro état, zéro I/O implicite
│   ├── ExecutionLayer.ts            # execute() / executeStream()
│   ├── errors.ts                    # InvalidRequest|Auth|RateLimit|Server|Network|ContentFilter
│   ├── classifyError.ts             # HTTP status + code provider → erreur domaine (remplace M1)
│   └── ModelRegistry.ts             # models_config.json → endpoint/protocole/headers/capacités
├── layer1/                          # Intelligence — état de santé et politique
│   ├── SmartLayer.ts                # call() / callStream() — boucle plate bornée
│   ├── ModelHealthRegistry.ts       # scores + circuits modèle & famille (D1, D2)
│   ├── CredentialProvider.ts        # sélection de clé (D3)
│   └── ServiceRegistry.ts           # services_config.json → chaînes de candidats
├── GenerationParams.ts              # conversion d'intentions (appelé par Layer 0)
├── families/                        # protocoles × headers (existant, conservé)
└── adapters/                        # natifs (openai, gemini, anthropic, codex, antigravity)
```

**Sens de dépendance strict** : `layer1 → layer0 → families/adapters`. Layer 0 n'importe jamais
`layer1`. `GenerationParams` n'importe ni l'un ni l'autre (module feuille).
