# Tests à Faire (E2E)

Ce document liste les tests de bout en bout (E2E) à réaliser pour valider les fonctionnalités de HIVE-MIND-RAILWAY. Tous les tests doivent être exécutés dans des conditions réelles (sans mocks).

> **Dernière mise à jour** : 2026-05-04
> **Source** : Fusion du backlog RAILWAY + tests non-exécutés du repo HIVE-MIND original (MODs 1-10).

---

## 1. Plugins (Non Testés)
*Tester chaque outil avec le Transport CLI (`npx tsx scripts/test_cli_e2e.ts`) ou via WhatsApp.*

- [ ] **memory** : Tester `remember_fact`, `recall_fact`, `list_facts`, `forget_fact`, `workspace_write`, `workspace_read`, `workspace_search`, `workspace_delete`, `update_scratchpad`, `search_long_term_memory`.
- [ ] **goals** : Créer un objectif, lister les objectifs, annuler.
- [ ] **group_manager** : Tester le filtrage de mots clés, l'ajout/suppression de filtres. (Nécessite le test via WhatsApp pour le contexte de groupe).
- [ ] **translate** : Demander la traduction d'un texte en différentes langues. *(Partiellement testé — le RAG de sélection d'outils l'écarte parfois du contexte).*
- [ ] **visual_reporter** : Tester la génération de rapports visuels. *(Même problème RAG que translate).*
- [ ] **mcp_tools** : Mettre en place un faux serveur ou mock minimal pour tester le bridge MCP.

*(Le plugin `send_email` est exclu temporairement car le webhook n8n est désactivé).*

### Plugins déjà testés ✅ (retirés du backlog)
> `tts`, `system`, `daily_pulse`, `wikipedia`, `duckduck_search`, `google_ai_search`, `admin`, `crawlfire_web`, `shopping`, `deep_research`, `sys_interaction`, `sticker`, Smart Router V2.

---

## 2. Sécurité & MoralCompass
- [ ] **Bypass Admin** : Vérifier qu'un utilisateur identifié comme SuperUser ou Global Admin n'est pas bloqué par les règles restrictives du LLM (MoralCompass).
- [ ] **VM Escape Mitigation** : Essayer de faire exécuter un script bash malveillant (`node -e`, `sudo`) via `code_execution` ou `execute_bash_command` et s'assurer que l'exécution est bloquée (Validation Regex & Banned commands).
- [ ] **Browser Blacklist** : Tenter d'accéder à un site blacklisté ou à une IP locale via le navigateur.
- [ ] **Sandboxing FS (Universal Read / Restricted Write)** : Essayer de lire un fichier système puis essayer d'écrire un fichier en dehors de `storage_hm/` ou `Sandbox1/`. L'écriture doit échouer.
- [ ] **Explications des Refus (Agent Refusal Visibility)** : Provoquer un refus délibéré (par ex: générer du contenu malveillant) et vérifier que l'IA explique le refus de manière structurée (`risk_level`).

---

## 3. Architecture Core & Base de Données
- [ ] **Headless Mode** : Définir `APP_ENV=server` et vérifier que l'instance démarre sans erreur `setRawMode EIO` et que `ink-cli` est bien désactivé.
- [ ] **Race Conditions DB** : Envoyer plusieurs messages simultanés pour voir si l'upsert (`onConflict`) gère bien les doublons d'utilisateurs et de groupes.
- [ ] **Context V3 (TieredContextLoader)** : Modifier la langue et la timezone en DB et vérifier que le "Bureau de Travail" est bien mis à jour en temps réel lors du prochain message.
- [ ] **MultiAgent Stability** : Déclencher une "Action Critique" et observer le processus de critique et validation sans crash (`TypeError`).
- [ ] **Planner Resilience** : Donner une tâche très complexe nécessitant un plan et vérifier qu'aucune boucle infinie ne se produit si un outil manque ou échoue.
- [ ] **Gemini Thought Persistence** : Vérifier que les logs de réflexion (Thinking Mode de Gemini 2.0 Flash) sont bien conservés et affichés.

---

## 4. WhatsApp & Fichiers
- [ ] **Réception Fichiers & GC** : Envoyer un PDF ou une image sur WhatsApp. Demander à l'IA d'analyser le contenu. Vérifier que le fichier est bien temporairement stocké dans `hm_storage/tmp_download/` et supprimé après 10 minutes.
- [ ] **TTS Live WhatsApp** : Valider `gemini-3.1-flash-tts-preview` avec le rendu émotionnel et le Director's Chair sur un appareil réel.

---

## 5. MODs Hérités (du repo HIVE-MIND original — jamais testés)

> Ces tests proviennent de `/home/omni/Code/HIVE-MIND/.GCC/branches/test.md`. Aucun n'avait été exécuté avant le fork. Certains modules ont évolué depuis — les critères doivent être validés contre le code actuel de RAILWAY.

### MOD 1 — Garbage Collector de Contexte (`_compactHistory`)
- [ ] Le seuil de 25k chars déclenche la compression
- [ ] Le résumé LLM est pertinent (pas de perte de contexte critique)
- [ ] Le fallback mécanique se déclenche si Groq est indisponible
- [ ] L'historique post-compression contient : [system, résumé, 2 derniers échanges]

### MOD 2 — Sous-Agent Isolé (`SubAgentTool` / `delegate_task`)
> *Note : les sub-agents `shopping` et `deep_research` ont été validés en E2E. Ce test vise la mécanique générique du SubAgentTool.*
- [ ] Le sub-agent utilise un historique séparé
- [ ] Seuls les outils read-only sont disponibles
- [ ] La limite de 5 itérations est respectée
- [ ] Le rapport final est injecté dans le contexte principal comme résultat d'outil

### MOD 3 — Feedback Asynchrone (`onProgress`)
- [ ] `onProgress` est disponible dans `context` de tout outil
- [ ] `BotEvents.TOOL_PROGRESS` est publié sur le bus
- [ ] Les composants TUI (Ink) peuvent souscrire et afficher un spinner

### MOD 4 — Kill Switch Financier (`CostTracker`)
- [ ] Le pricing.json est chargé correctement au démarrage
- [ ] Le coût est calculé pour chaque appel (log visible)
- [ ] Les modèles gratuits (Groq, GitHub, NVIDIA) affichent $0.00000
- [ ] Le Kill Switch s'active quand le budget est dépassé
- [ ] Le message user-facing est envoyé (pas le générique "Oups")
- [ ] `BotEvents.SYSTEM_ERROR` est publié sur le bus

### MOD 6 — Chain of Thought Obligatoire (`<thought>`)
- [ ] Les pensées sont extraites et loggées en console
- [ ] Les balises sont nettoyées avant envoi utilisateur
- [ ] La relance auto fonctionne (continue + injection message système)
- [ ] Le guard `iterations < MAX_ITERATIONS` empêche boucle infinie
- [ ] Compatible : `<think>`, `<thought>`, `<thinking>`

### MOD 7 — HITL Dual-Logic : Admin Hub + Escalade In-Band

**LOGIQUE 1 (Admin Hub)**
- [ ] Requête envoyée au `SECURITY_HUB_ID` (pas le chat source)
- [ ] Chat source reçoit message d'attente
- [ ] `.approve <ID>` → `granted: true`
- [ ] `.reject <ID> feedback` → `granted: false, feedback`
- [ ] `.approve 999` (ID inexistant) → warning sans crash
- [ ] Compteur d'ID incrémental et unique

**LOGIQUE 2 (In-Band)**
- [ ] SuperAdmin → In-Chat (pas d'escalade)
- [ ] Utilisateur normal → escalade DM `SUPER_ADMIN_JID`
- [ ] Tâche système (`senderJid = 'system'`) → escalade DM
- [ ] `SUPER_ADMIN_JID` vide → blocage immédiat
- [ ] Timeout 10 min → `{ granted: false, feedback: "Timeout" }`

**Cascade Hub → Fallback**
- [ ] Hub timeout → LOGIQUE 2 démarre auto
- [ ] Hub en panne → LOGIQUE 2 démarre immédiatement
- [ ] Même requête non résolue 2 fois (cleanup atomique)

**Propagation senderJid**
- [ ] BashTool → `context.message.sender || 'system'`
- [ ] FileEditTool → `context.message.sender || 'system'`
- [ ] SearchTools → `context.message.sender || 'system'`

### MOD 8 — Dual Rendering (Double Rendu)
- [ ] L'envoi du `userOutput` se fait immédiatement
- [ ] L'historique interne du LLM stocke le `llmOutput` (et non le joli message)
- [ ] Fallback fonctionnel : Les vieux plugins qui renvoient un simple `toolResult` sont bien jsonifiés
- [ ] Les 3 plugins mis à jour retournent un `success`, un `llmOutput` et un `userOutput`

### MOD 9 — Architecture Omni-Channel & Identités (DB + Redis)
- [ ] Le code compile toujours et les plugins fonctionnent sans changement
- [ ] L'insertion de logs et mémoires pointe sur un `context_id` universel
- [ ] Les compteurs d'interaction (XP) sont gérés par le UUID dans le cache Redis (`user:{UUID}:data`)
- [ ] Le script SQL peut être re-lancé plusieurs fois sans erreur (`IF NOT EXISTS`)

### MOD 10 — Architecture GWT & Conscience
- [ ] Le XML du System Prompt est bien structuré (`<system_identity>`, `<current_consciousness_state>`, `<execution_engine>`)
- [ ] Le dernier `<think>` est bien extrait et injecté dans `<inner_monologue>`
- [ ] L'appel à `HIVE.sleepAndWake` planifie un `WakeEvent`
- [ ] L'agent répond `SILENT_HM` et aucun message texte n'est envoyé à l'utilisateur
- [ ] Le `WakeSystem` réveille l'agent à l'heure prévue et relance la boucle d'interaction
- [ ] `hiveWakeSystem.stop()` est appelé correctement lors du `.shutdown`

---

## 6. System Prompt Refactoring & LLM Failure Reduction (Priorité Forte 🚨)
- [ ] **Audit des Prompts Système (System Prompt Information Deficit)** : Réviser et enrichir les prompts système globaux et spécifiques (`src/persona/`, prompts ReAct, prompts d'appel d'outils) pour combler le manque d'informations contextuelles et les instructions ambiguës qui provoquent des échecs d'exécution du LLM (même en présence de la validation Zod/Ajv et des retries de format).
- [ ] **Standardisation du Format d'Outil & Exemplification Few-Shot** : Intégrer des exemples concrètement formatés d'appels d'outils (few-shot) directement dans les prompts système pour éliminer les réjections `<tool_use_error>` et les déviations de schéma.
- [ ] **Benchmark de Robustesse des Prompts** : Valider le taux de succès d'exécution sans échec du LLM sur les modèles compacts (ex: Flash-Lite, Kimi, Mistral).


---

## 7. Familles de protocole Providers (plan_provider_protocol_families — post-Session 4)

> Prérequis : ces tests doivent être écrits et **verts AVANT** toute suppression de fichier
> adaptateur. Ils constituent l'unique garde-fou de l'invariant réseau (URL + headers + body
> identiques avant/après factorisation).

### 7.1 Fixtures de requête émise (non-régression réseau)
- [ ] Capturer via `fetch` stubbé la requête émise par les 39 adapters actuels (URL, méthode, headers, body JSON) et la figer en fixtures de référence
- [ ] Rejouer chaque fixture après migration : diff strictement vide par provider
- [ ] Vérifier que le body inclut toujours `tools` + `tool_choice: 'auto'` quand `options.tools?.length > 0`
- [ ] Vérifier la propagation de `temperature` (défaut 0.7) et `max_tokens` (4096 générique, 8192 kimi)

### 7.2 Empreintes de client (fingerprints)
- [ ] `kimi` émet bien `User-Agent: claude-code/1.0.0` **et** `X-Client-Name: claude-code`
- [ ] `geminiCli` émet `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) GeminiCLI/1.0.0`
- [ ] `antigravity` émet `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Antigravity/1.18.3`
- [ ] Empreinte `classic` : aucun `User-Agent` custom injecté (ne pas introduire de header par défaut)
- [ ] `anthropic` conserve `x-api-key` + `anthropic-version: 2023-06-01` (et **pas** `Authorization: Bearer`)

### 7.3 Timeouts et I/O (règle isolated_io)
- [ ] Les 15 clones migrés conservent leur `AbortController` + timeout 60 s et lèvent `[<Provider>] Timeout (60s)` sur abort
- [ ] **Régression connue à corriger** : `openai.ts` et `groq.ts` n'ont AUCUN timeout aujourd'hui — vérifier qu'ils en ont un après migration
- [ ] `clearTimeout` est appelé sur le chemin d'erreur comme sur le chemin de succès (pas de timer orphelin)
- [ ] `kimi` conserve `fetchWithIPv4Fallback(url, opts, 2)` (2 retries) et le forçage IPv4 via `forceIPv4ForUrl`

### 7.4 Authentification OAuth factorisée
- [ ] Refresh déclenché quand l'`access_token` est expiré (JWT `exp` dépassé simulé)
- [ ] Refresh NON déclenché quand le token est encore valide
- [ ] Repli sur variables d'environnement quand `auth.json` est absent (chemin production Railway, aujourd'hui non testé)
- [ ] `codex.ts` : le chemin absolu `/home/omni/.codex/auth.json` est remplacé par une résolution `os.homedir()` et fonctionne hors de la machine de dev
- [ ] Aucun `access_token` / `refresh_token` journalisé, même tronqué (grep sur la sortie de test)
- [ ] Échec de refresh → erreur explicite levée (fail-closed), pas de retour silencieux d'un token vide

### 7.5 Enregistrement des adaptateurs (piège du Step 6)
- [ ] `providerRouter.adapters.size` égale le nombre attendu après suppression des fichiers migrés
- [ ] `loadAdapters()` (`src/providers/index.ts:1002-1060`) filtre `ERR_MODULE_NOT_FOUND` en silence : vérifier explicitement qu'aucun provider n'a disparu de la Map, l'absence de log ne prouvant rien
- [ ] Chaque provider est testable en isolation (`family` forcée), sans passer par la cascade de fallback du routeur qui masque les pannes via le circuit breaker `_isCooldownActive`

### 8. GenerationParams (plan v3, smoke réel — clés API réelles requises)
- [ ] Appel réel Anthropic avec `thinking` actif : vérifier `usage.cache_read_input_tokens` (prompt caching `cache_control: {type: 'ephemeral'}`) et les traces de thinking dans la réponse
- [ ] Appel réel Gemini : vérifier `usage.thoughtsTokenCount` (thinkingBudget -> thinkingConfig)
- [ ] Vérification empirique que gpt-5 rejette une `temperature` non défaut (conditionne `temperature_range: "unsupported"` du Step 1)
- [ ] Appel via une famille secondaire `openai-compatible` purement déclarative (ex. openrouter) : preuve du canal `capacites` sans fichier `.ts`
