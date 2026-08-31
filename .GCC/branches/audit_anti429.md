# Rapport d'audit : Provider Smart anti-429 (ProviderRouter + QuotaManager)

- **Date** : 2026-08-05
- **Méthode** : Workflow ultracode multi-agents (phase Find → phase Verify adversarial).
  40 agents, 28/34 trouvailles confirmées par contre-vérification sceptique.
- **Périmètre** : `src/providers/index.ts` (ProviderRouter, 1475 l.) + `src/services/quotaManager.ts` (QuotaManager, 599 l.) + `src/services/envResolver.ts`.
- **Objectif** : Vérifier si le système « Zero-429 » prétend faire quelque chose qu'il ne fait pas vraiment.
- **Statut** : ✅ les points critiques ont été **CORRIGÉS** (workflow ultracode de fix + contre-vérification adversarial, appliqué manuellement pour les fixes rejetés). Tests mis à jour, **20/20 verts**, `tsc` 0 erreur, `eslint` 0 erreur, commit validé par les 8 couches du pré-commit, poussé sur `worktree-anti429-tests`.

---

## 🎯 Promesse du système (ce qu'il DIT faire)

Le routeur « smart » promet **Zero-429** : ne jamais émettre une requête qui dépasserait les quotas d'un provider — via rotation multi-clés, circuit breaker par famille, comptabilisation TPM/RPM/RPD sur Redis, marges de sécurité, et mode dégradé quand Redis tombe.

## 🔍 Points critiques — État après correction

### 1. Circuit breaker vestigial — ne se déclenche jamais dans le chemin normal
- **✅ CORRIGÉ** — le circuit breaker (`circuitStats`, `_isCooldownActive`, `_recordFailure`, `_resetCircuit`) a été **entièrement retiré** ainsi que les deux cooldown checks (`_runCascade`, `_runFamilyModels`, `_isRecipeCandidateUsable`) et l'appel `_resetCircuit` dans `_invokeAdapter`. La protection anti-429 réelle (blocage Redis par modèle+clé via `_blockExhaustedKey`) est conservée et documentée. Choix : suppression plutôt que réactivation — le breaker était du code mort et ajoutait de la complexité sans protection effective.
- **Fichier/ligne** : `src/providers/index.ts:519-563` (`_isCooldownActive`, `_recordFailure`, `_resetCircuit`), intégré dans `_tryModelAcrossKeys` l.947-1004 et `_runCascade` l.812-851.
- **Affirmation** : le breaker protège contre les 429 en mettant des familles en cooldown.
- **Réalité** : `_recordFailure` (l.533) ne fait rien SAUF si `QUOTA_ERROR_PATTERN` matche. Or `_tryModelAcrossKeys` l.988-993 n'appelle `_recordFailure` que lorsque `!isQuotaError || !quotaManager`. Analyse des 3 cas :
  - (a) erreur non-quota → `_recordFailure` appelé mais NO-OP (pattern pas matché) ;
  - (b) erreur quota + quotaManager présent (chemin normal) → le 429 va dans `_blockExhaustedKey` (Redis block), **PAS** dans `_recordFailure` → `circuitStats` ne se remplit jamais ;
  - (c) erreur quota sans quotaManager → see cas ci-dessous.
- **Conclusion** : avec `quotaManager` présent (chemin normal), le circuit breaker mémoire est **du code mort / vestigial** remplacé par le mécanisme Redis block. Les cooldowns famille 1/5/15 min ne s'activent jamais en prod.
- **Sévérité** : MAJEUR (surcoût de complexité, promesse de protection non tenue par ce chemin).

### 2. Double garde contradictoire annulant le breaker
- **Fichier/ligne** : `src/providers/index.ts:988`.
- **Réalité** : la condition `[!isQuotaError || !quotaManager]` contredit l'usage du breaker : quand quotaManager est présent, un 429 n'atteint jamais le breaker ; quand il est absent (dégradé), `_recordFailure` est appelé mais le breaker agit seul. Les deux chemins s'annulent → le breaker est inopérant dans tous les cas.
- **Sévérité** : MAJEUR.

### 3. Write-through L0 de `recordUsage` sous-compte les compteurs
- **✅ CORRIGÉ** — `recordUsage` peuple désormais le L0 avec les valeurs **AUTORITATIVES** de `multi.exec()` (un tableau, une réponse par commande) au lieu de `parseInt(l0||'0')+1`. Index littéraux 0/2/4 (évitent `security/detect-object-injection`). Si `exec()` ne renvoie pas de tableau (mock/erreur), le L0 n'est pas touché (un L0 stale vaut mieux qu'un compteur faux). Test mis à jour : mocke `exec()` → `[11,'OK',1,'OK']` et vérifie `rpmUsed === 11`.
- **Fichier/ligne** : `src/services/quotaManager.ts:183-232` (recordUsage), write-through l.220.
- **Réalité** : `multi.exec()` (l.219-228) jette les valeurs autoritatives des `INCR` ; le write-through reconstruit le compteur L0 comme `parseInt(_l0Get(...) || 0) + 1` depuis un L0 potentiellement vide/stale. Si Redis est déjà à 10 (bursts concurrents) mais le L0 vide, le L0 passe à 1 → pendant 2s (TTL L0) le health check voit 1 au lieu de 10 → **sous-comptage qui affaiblit la protection anti-429** (les requêtes partent alors que le quota est quasi épuisé).
- **Sévérité** : MAJEUR (trouvaille #3, testée par `Comptabilité L0 - recordUsage write-through`).

### 4. `getModelHealth` fail-open quand Redis est down
- **✅ CORRIGÉ** — quand Redis n'est pas `ready`, `getModelHealth` retourne `healthy=false` avec `reason='REDIS INACCESSIBLE (fail-closed)'`. Le `catch` retourne aussi `healthy=false` avec `reason='REDIS READ ERROR (fail-closed)'`. `filterHealthyModels` retourne `[]` quand Redis down (fail-closed). Test renommé : `getModelHealth est FAIL-CLOSED quand Redis est down`.
- **Fichier/ligne** : `src/services/quotaManager.ts:402-493`, fail-open l.419.
- **Réalité** : si Redis n'est pas `ready`, `getModelHealth` retourne `result.healthy = true`. Donc Redis down / erreur transitoire → TOUT est considéré sain → requêtes émises **sans protection**.
- **Sévérité** : MAJEUR (testé par `Mode dégradé Redis DOWN`).

### 5. `getAvailableKeyForModel` fail-open quand Redis est down
- **✅ CORRIGÉ** — les deux branches fail-open retournent désormais `null` (signature `Promise<number|null>`) : Redis down ET aucun provider configuré. `null` signale au routeur (via `_selectKeyIndex`) qu'aucune clé n'est dispo → il saute le modèle. Le routeur gère `null` (l.1025-1027). Tests : sans clé → `toBeNull()` ; Redis down → `toBeNull()`.
- **Fichier/ligne** : `src/services/quotaManager.ts:291-321`, fail-open l.296.
- **Réalité** : Redis down → retourne la clé 1 sans gate + le blocage 429 n'est pas persisté → tempête de 429 quand le provider revient.
- **Sévérité** : MAJEUR (testé par `Mode dégradé Redis DOWN`).

### 6. Mode SECOURS relâche les marges
- **✅ CORRIGÉ** — quand aucune famille n'est saine même en urgence, `_selectEmergencyFamilies` retourne `availableFamilies.filter(f => emergencyHealthy.includes(f))` (donc `[]`, fail-closed) au lieu de la liste brute non filtrée. Le mode SECOURS relâche déjà les marges (`EMERGENCY_HEALTH_THRESHOLDS`) — c'est ce relâchement de marge, pas un bypass complet du check de santé, qui est le bon comportement. Un `[]` laisse `chat()` lever une erreur nommée claire. Le commentaire sur le circuit breaker a été retiré (vestigial).
- **Fichier/ligne** : `src/providers/index.ts:697-725` (`_selectEmergencyFamilies`), relâchement l.719.
- **Réalité** : si aucune famille saine en urgence, on retourne quand même la liste brute `availableFamilies` (l.719) — le circuit breaker tranchera à l'appel. Cet envoi de requêtes **sans check de santé** est un bypass délibéré de la promesse Zero-429. Scénario concret : urgence + quota épuisé → requête 429 émise.
- **Sévérité** : MAJEUR.

### 7. Incohérence fail-open `getModelHealth` vs fail-closed `isModelAvailable`
- **✅ CORRIGÉ** — `getModelHealth` est désormais fail-closed (cohérent avec `isModelAvailable` fail-closed à `quotaManager.ts:242`). Les trois entrées de santé partagent la même politique : Redis down ⇒ aucun modèle/aucune clé n'est validé.
- **Réalité** : deux fonctions de santé du même système adoptent des politiques opposées en mode dégradé. `isModelAvailable` refuse (1 req/min), `getModelHealth` autorise tout. Selon le chemin pris par le routeur, la protection est totale ou nulle.
- **Sévérité** : MAJEUR (testé par `Mode dégradé Redis DOWN` — test de caractérisation).

## 🧟 Code mort (jamais appelé ou cassé) — ✅ TOUT SUPPRIMÉ

| Méthode | Localisation | Preuve | État |
|---|---|---|---|
| `_incrementUsage` / `getUsageStats` / `resetUsageStats` | `index.ts:1371-1392` | stats par famille, jamais appelées | ✅ supprimé |
| `setFamily` | `index.ts:480` | jamais appelé | ✅ supprimé |
| `findModelForType` | `index.ts:508` | jamais appelé | ✅ supprimé |
| `quotaManager.getStats` | `quotaManager.ts:374-389` | **cassée + morte** | ✅ supprimé |
| `filterAvailableModels` | `quotaManager.ts:356` | jamais appelé | ✅ supprimé |

Chaque suppression a été vérifiée par `grep` sur tout `src/` (hors tests) : aucun autre appelant ni import. Les tests ne référençaient aucun de ces symboles.

## 🧪 Vérité sur la suite de tests « anti-429 »

Avant l'intervention :
- **Test de filtrage live/tts/audio** (`smart_router_v2.test.ts:110`) : réimplémentait **INLINE** la logique de filtrage au lieu d'appeler la vraie méthode `_resolveModelsToTry` → si l'implémentation change/casse, le test passe quand même (test qui teste une copie).
- **Contamination L0 inter-tests** : les compteurs écrits par un test pouvaient être lus par le suivant (cache 2s non purgé).
- **Mécanismes Zero-429 non testés** : getModelHealth, getHealthyFamilies, recordQuotaExceeded, circuit breaker, mode dégradé Redis down, sélection de clés après 429 réel → **aucun test**.
- `callServiceRecipe` Fallback Direct : mockait `providerRouter.chat` + `_isCooldownActive` + `isModelAvailable` → ne testait que l'orchestration, pas le vrai chemin de fallback.

### ✅ Corrections apportées (tests)
- Remplacement du test de copie par un test **réel** de `_resolveModelsToTry` (config gemini réelle, types exclus `live_api`/`tts` vérifiés).
- Purge du `_l0Cache` + restauration de `getAvailableKeysForProvider` + reset `modelFailureScore` en `beforeEach` (helper `resetSharedState`). Les tests du circuit breaker ont été retirés (le breaker est supprimé).
- Describes de tests pour : Reliability Scoring, getModelHealth (marges + fail-closed Redis down), recordQuotaExceeded→L0, getAvailableKeyForModel sans clé (null) + Redis down (null), getHealthyFamilies, Mode dégradé Redis DOWN, Comptabilité L0 (valeur autoritative).
- **Résultat : 20/20 tests passent.** `tsc --noEmit` 0 erreur, `eslint` 0 erreur, commit validé par les 8 couches du pré-commit.

## ✅ Points vérifiés et jugés SAINS par l'audit
- La rotation multi-clés progresse correctement : après un 429, la clé bloquée est exclue au tour suivant via `recordQuotaExceeded` → `_l0Set` + `setEx` Redis (propagation L0 immédiate vérifiée).
- `recordQuotaExceeded` écrit `_l0Set(blockKey, 1)` AVANT le `setEx` Redis → le blocage est bien visible immédiatement par `getModelHealth` via `_cachedGet`.
- La comptabilisation TPM/RPM avec seuil à 80% de la limite (marge 0.2) est cohérente avec les valeurs `rpm/tpm/rpd` déclarées dans `models_config.json`.

## 📁 Fichiers touchés
- `src/providers/index.ts` — circuit breaker vestigial retiré, mode secours fail-closed, code mort supprimé.
- `src/services/quotaManager.ts` — L0 peuplé par les valeurs autoritatives de `multi.exec()`, 3 entrées fail-closed, code mort supprimé.
- `src/tests/smart_router_v2.test.ts` — tests de caractérisation réécrits pour le comportement corrigé (20/20 verts).

## ⏭️ Prochaine étape
- **Review du PR** : fusionner `worktree-anti429-tests` vers `main` (le merge est à faire par l'utilisateur — permission collaborateur requise pour le PR).
- **Recommandation** : ajouter un test d'intégration end-to-end avec un vrai Redis pour valider le comportement L0/Redis en conditions réelles (les tests actuels sont des mocks).