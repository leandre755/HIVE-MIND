# HIVE-MIND — TODO (ordre de résolution)

> Mis à jour le **2026-09-06** — issues GitHub ouvertes classées par **ordre de résolution** (dépendances + sévérité + lots).
> Critères : P0 d’abord → fuites lifecycle/shutdown (Lot 1 résiduel) → persistance Lot 2 → core/router Lot 3–4 → perf/dette large blast radius.
> Les items Google Tasks / backlog produit restent en bas (après stabilisation bugs).

---

## A. Issues GitHub — ordre de résolution (20 ouvertes)

### Phase 0 — Déblocage local / tests (P0)

| # | Ordre | Issue | Sévérité | Pourquoi maintenant |
|---|------:|-------|----------|---------------------|
| 1 | **#25** | [BUG] InMemoryRedisMock : méthodes listes/sets manquantes (`rPush`, `lTrim`, `zAdd`, `hDel`, `hLen`, `eval`) | **P0** bloquant local/test | Fondations Lot 2 ; sans mock complet, tests mémoire L1 et vérifs locales crashent. |

### Phase 1 — Fuites lifecycle / shutdown (résiduel Lot 1 + ANTIBUG)

| # | Ordre | Issue | Sévérité | Pourquoi maintenant |
|---|------:|-------|----------|---------------------|
| 2 | **#26** + **#1** | [BUG]/ANTIBUG] ActionMemory : pas de `unref()` / `dispose()` + `setInterval` non stoppable | **P1** / medium | Même fichier ; fusionner en un fix unique (`cleanupIntervalId` + `stop()` + `.unref()`). |
| 3 | **#23** | [ANTIBUG] PermissionManager : timeouts Hub/In-Band non cleared | **HIGH** security + concurrency | Fuite timers 10–15 min ; résiduel sécurité Lot 1 encore ouvert. |
| 4 | **#2** | [ANTIBUG] `hive-mind.ts` : `setInterval` sync queue jamais clear | **MEDIUM** concurrency | Point central du shutdown CLI ; débloque un exit propre. |
| 5 | **#16** + **#21** | [ANTIBUG] adminService : interval non destroyé au shutdown + retry `setTimeout` non killable | **MEDIUM** concurrency | Même service ; câbler `destroy()` dans shutdown + capturer `retryTimeoutId`. |
| 6 | **#19** | [ANTIBUG] DatabaseMonitor : pas de `stop()`/`destroy()` pour intervals | **HIGH** concurrency | Intervals horaires/quotidiens bloquent l’event loop au stop. |
| 7 | **#20** | [ANTIBUG] MailboxWatcher : rejection non gérée dans `setInterval` async | **MEDIUM** concurrency | Fix local try/catch ; faible blast radius, à enchaîner avec les autres timers. |

### Phase 2 — Persistance & données (Lot 2)

| # | Ordre | Issue | Sévérité | Pourquoi maintenant |
|---|------:|-------|----------|---------------------|
| 8 | **#27** | [BUG] StateManager : corruption profils (sérialisation tableau `names`) | **P2** DAT-03 | Même couche State/Redis que #25 ; correctif borné. |
| 9 | **#28** | [BUG] PersistentShell : deadlock 120s sur sortie anormale bash (`exit`) | **P1** SYS-02 | Fiabilité runtime shell ; indépendant du graphe. |
| 10 | **#35** | [BUG] graphMemory : désync schéma Supabase (`context_id` vs `chat_id`, unicité, RPC `match_entities`) | **P1** DAT-02 | Mémoire L2 ; après mock Redis stable. |
| 11 | **#34** | [BUG] EmbeddingsService : config Gemini / `text-embedding-004` + `outputDimensionality: 1024` | **P2** DAT-04 | Alimente le graphe (#35) ; à traiter juste après ou avec #35. |

### Phase 3 — Core orchestration (Lot 3)

| # | Ordre | Issue | Sévérité | Pourquoi maintenant |
|---|------:|-------|----------|---------------------|
| 12 | **#30** | [BUG] FairnessQueue : LIFO au lieu de FIFO (`queue.unshift`) | **P1** CORE-02 | Ordonnancement messages ; base du comportement multi-user. |
| 13 | **#29** | [BUG] Planner : étapes échouées marquées `completed` (taux de succès faussé) | **P1** CORE-01 | Qualité de planification ; indépendant du router health. |

### Phase 4 — Smart Router / providers (Lot 3–4)

| # | Ordre | Issue | Sévérité | Pourquoi maintenant |
|---|------:|-------|----------|---------------------|
| 14 | **#31** | [BUG] SmartLayer & ModelHealthRegistry : deadlock Circuit Breaker streaming `HALF_OPEN` (`probeInFlight` figé) | **P1** ROUT-02 | Deadlock routing ; bloquant sous charge streaming. |
| 15 | **#32** | [BUG] ModelHealthRegistry : tri préférence inverse (favorise modèles en panne) | **P1** ROUT-03 | Même registre que #31 ; fixer le scoring après (ou avec) le CB. |
| 16 | **#37** | [BUG] ExecutionLayer : rejet `gemini-native` + contournements `Function('return import(...)')` | **P1** ROUT-01 / ARCH-02 | Intégration protocole + purge imports opaques ; après health path stable. |

### Phase 5 — Perf transport & dette sécurité large

| # | Ordre | Issue | Sévérité | Pourquoi maintenant |
|---|------:|-------|----------|---------------------|
| 17 | **#33** | [BUG] telegram.ts : `getMe()` non mis en cache (risque FLOOD_WAIT) | **P2** PERF-01 | Perf transport ; isolé, après le cœur router. |
| 18 | **#36** | [BUG] safeFs : appels `node:fs` directs (15+ fichiers) | **P2** security ARCH-01 | Large blast radius transversal ; **en dernier** parmi les bugs pour éviter de mélanger avec les lots ciblés. |

---

### Checklist exécutable (copie rapide)

```text
[x] #25  InMemoryRedisMock (P0)
[ ] #26+#1  ActionMemory dispose/unref
[ ] #23  PermissionManager clearTimeout
[ ] #2   hive-mind.ts clearInterval sync queue
[ ] #16+#21  adminService destroy + retry timeout
[ ] #19  DatabaseMonitor.stop()
[ ] #20  MailboxWatcher try/catch
[ ] #27  StateManager names
[ ] #28  PersistentShell deadlock
[ ] #35  graphMemory schéma Supabase
[ ] #34  EmbeddingsService Gemini
[ ] #30  FairnessQueue FIFO
[ ] #29  Planner failed≠completed
[ ] #31  Circuit Breaker HALF_OPEN
[ ] #32  ModelHealthRegistry tri
[ ] #37  gemini-native + purge Function()
[ ] #33  telegram getMe cache
[ ] #36  safeFs migrations (dernier)
```

---

## B. Dette technique locale (hors issues, ordre après Phase 0–2)

- [ ] **`src/providers/adapters/codex.ts`** : chemin personnel → `os.homedir()`
- [ ] **`.githooks/_common/`** : supprimer ou câbler `check-format.sh` / `run-linter.sh` (code mort)
- [ ] **TinyFish Search** : plugin `src/plugins/web/tinyfish_search` + `AgentBlueprint.ts` (décision 2026-09-03)
- [ ] **Smart Layer non branchée en prod** : `providerRouter` legacy vs `SmartLayer`/`ExecutionLayer` (dette ARCH critique — plan mainteneur requis avant code)

---

## C. Backlog produit (Google Tasks) — après stabilisation bugs

Ordre suggéré (dépendances produit, pas sévérité bug) :

1. [ ] **Séparer la TUI** (déjà largement fait côté dépôt sibling — clôturer / archiver la tâche Google si obsolete)
2. [ ] **Stratégie de distribution** (bun / npm / install script) — TUI + ADK
3. [ ] **Lire CommandCode, Buzz, CircleChat** — input design TUI/ADK
4. [ ] **Entrée standardisée multi-agents** (contrat universel d’intégration)
5. [ ] **Hooks system** (interception événements)
6. [ ] **Chargement règles/workflows dynamiques** (skills-like)
7. [ ] **Sous-agent de prospection** — prompt + intégration core
8. [ ] **Graphe de mémoire interrogeable** (L4, embeddings) — *après* #35/#34
9. [ ] **Module observation & audit** + **télémétrie** (n8n webhooks) — regrouper
10. [ ] **Lister la suite d’améliorations** HM + SDK (meta-backlog)

---

## D. Plugins & tooling (backlog dépôt)

- [ ] **Remplacement recherche → TinyFish Search** ([tinyfish.ai](https://www.tinyfish.ai/)) — `src/plugins/web/`, `AgentBlueprint.ts`, tests

---

## Notes d’exécution

- **Lot 1** (sandbox PTC / PermissionManager / SwarmDispatcher) : livré PR #24 — ne rouvrir que pour le résiduel **#23**.
- **Prochain lot code** aligné GCC : **Lot 2 Persistance** = checklist Phase 0 + Phase 2 (`#25` → `#27` → `#28` → `#35` → `#34`), en parallèle safe des fuites Phase 1 si bande passante.
- Fusionner les paires **#26+#1** et **#16+#21** dans la même PR chacune (même composant, même preuve de test).
- Ne pas démarrer **#36** tant que les P0/P1 des Phases 0–4 ne sont pas verts (risque de PR monstre et conflits).
