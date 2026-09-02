# Layer 1 SmartLayer & ModelHealthRegistry — Architecture & Principes de Fonctionnement

Le sous-système **SS-12 (Layer 1 SmartLayer & ModelHealthRegistry)** représente le centre de résilience, d'équilibrage de charge, de surveillance de santé et de routage adaptatif multi-modèles de HIVE-MIND.

## 1. Contexte & Problématique d'Ingénierie

Dans un système d'agents en production continue, la dépendance à des APIs distantes de LLM expose l'architecture à des défaillances fréquentes :
- **Saturations de taux et indisponibilités temporaires (429 / 503)** : Les pannes transitoires ne doivent pas interrompre la tâche de l'agent.
- **Dégradations insidieuses de latence (P50 / P95)** : Un modèle qui commence à répondre en 15 secondes au lieu de 800 ms doit être rétrogradé au profit d'alternatives plus réactives.
- **Effet boule de neige lors des pannes de fournisseurs** : Si plusieurs modèles d'une même famille (ex. OpenAI) tombent simultanément, continuer à tenter les modèles de repli de cette même famille gaspille du temps et épuise les timeouts globaux.
- **Risque de corruption sémantique en streaming** : Si un modèle commence à émettre des jetons vers l'utilisateur et plante au milieu du flux, tenter un basculement vers un autre modèle concaténerait deux réponses incompatibles et produirait une sortie corrompue.
- **Risque d'épuisement de pile par récursion** : Implémenter le repli par des fonctions qui s'auto-appellent récursivement en cas d'erreur (`catch (err) { return this.executeFallback(...) }`) peut provoquer un *Stack Overflow* sous forte charge ou lors de tempêtes d'erreurs.

SS-12 résout ces défis par une architecture formelle combinant **cascade séquentielle plate (zéro récursion)**, **disjoncteur 3-états à 6 compartiments circulaires**, **escalade de famille**, **Stream Lock** et **rotation équitable des clés d'API**.

## 2. Modèle Mental & Architecture Conceptuelle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Consommateur Noyau (BotCore / Plan)                   │
│          (Émet une SmartExecutionRequest avec serviceOrCategory)            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ServiceRegistry                                  │
│  - Résout la recette logique (ex. 'EXECUTOR' -> [gpt-4o, claude-3-7, ...])  │
│  - Extrait les contraintes (deadlineMs = 120s, maxAttempts = 4)             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ModelHealthRegistry                                │
│  1. Calcul du score dynamique : Score = 0.7 * Rfail + 0.3 * (P50_ms / 1000) │
│  2. Tri préférentiel des modèles candidats                                 │
│  3. Filtrage du Circuit Breaker (isCircuitOpen, tryAcquireHalfOpenProbe)   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SmartLayer (Boucle Plate Séquentielle)                │
│                                                                             │
│   for (const modelId of sortedModels) {                                     │
│     - Vérifier deadlineMs et maxAttempts                                    │
│     - Résoudre clé API via CredentialProvider (Rotation + Quota check)      │
│     - Exécuter via Layer 0 (ExecutionLayer)                                 │
│                                                                             │
│     [Succès]                                                                │
│       -> recordSuccess(modelId, latencyMs)                                  │
│       -> Libérer sonde HALF_OPEN & Retourner SmartExecuteResult             │
│                                                                             │
│     [Échec HTTP / Réseau]                                                   │
│       -> recordFailure(modelId, error)                                      │
│       -> Si 429: recordQuotaExceeded(modelId, keyIndex)                     │
│       -> Si Stream Lock activé (streamStarted): Rejeter immédiatement       │
│       -> Sinon: itérer vers le modèle candidat suivant                      │
│   }                                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Machine à États du Circuit Breaker

Chaque modèle et chaque famille est surveillé par un disjoncteur à 3 états sur une fenêtre glissante de $W = 60\text{ s}$ découpée en $K = 6$ compartiments temporels de $\Delta t = 10\text{ s}$ :

```
             N >= 3 requêtes  ET  R_fail >= 0.5
    ┌───────────────────────────────────────────────┐
    │                                               │
    ▼                                               │
┌─────────┐      Expiration Cooldown (30s/120s/600s)     ┌─────────┐
│ CLOSED  ├─────────────────────────────────────────────►│  OPEN   │
└────▲────┘                                              └────┬────┘
     │                                                        │
     │ Succès Sonde                                  Sonde    │
     │ (Reset Cooldown)                              Unique   │
     │                                                        ▼
     └───────────────────────────────────────────────┌─────────┐
                                                     │HALF_OPEN│
                                                     └─────────┘
                                                Échec Sonde -> Cooldown Step++
```

## 3. Choix de Conception & Raisons d'Ingénierie

- **Boucle Séquentielle Plate (Anti-Stack Overflow)** :
  La logique de basculement est implémentée sous forme d'une boucle `for (const modelId of sortedModels)` impérative pure. Aucun appel de fonction récursif n'est utilisé. Le nombre de tentatives est strictement borné :
  $$\text{Attempts} \le \min(\text{maxAttempts}, 4) \quad \text{et} \quad \Delta t \le \min(\text{deadlineMs}, 120\,000\text{ ms})$$
- **Algorithme des Compartiments Circulaires ($O(1)$)** :
  L'index du compartiment actif est obtenu par arithmétique modulaire $k(t) = \lfloor t / 10000 \rfloor \pmod 6$. Les compartiments obsolètes ($> 60\text{ s}$) sont purgés en temps constant sans réallocation de mémoire.
- **Sonde Unique en Vol (`Single-Flight Probe`)** :
  En état `HALF_OPEN`, seule une unique requête est autorisée à sonder le modèle via `tryAcquireHalfOpenProbe()`. Les autres requêtes concurrentes contournent immédiatement ce modèle et s'orientent vers le candidat suivant, évitant de submerger un service en cours de rétablissement.
- **Escalade de Famille (`Family Escalation`)** :
  Si au moins 2 modèles distincts d'un même fournisseur échouent par erreur serveur ($\ge 500$) ou coupure réseau dans la même fenêtre de 60s, le disjoncteur s'ouvre globalement pour **toute la famille**, épargnant au système des dizaines de secondes d'attente inutile.
- **Verrou de Flux SSE (`Stream Lock`)** :
  Dès lors qu'un premier octet ou bloc de texte/pensée est émis vers le consommateur (`streamStarted = true`), l'interdiction de basculement est absolue. En cas d'erreur ultérieure, l'exception est taguée `__streamStarted = true` et propagée immédiatement pour éviter toute corruption sémantique.

## 4. Analyse Comparative & Alternatives Écartées

| Approche Alternative | Avantages Théoriques | Inconvénients / Raisons du Rejet par HIVE-MIND |
| :--- | :--- | :--- |
| **Gestion d'Erreur Récursive** (`catch -> retryNext`) | Code compact et élégant. | Risque avéré de dépassement de pile (*Maximum call stack size exceeded*) sous tempête d'erreurs réseau. |
| **Disjoncteur Temporel Naïf** (timer fixe sans compartiments) | Plus simple à coder. | Sensible aux pics ponctuels : une brève rafale de 2 erreurs peut bloquer un modèle pendant 5 minutes alors que le service fonctionne. |
| **Sondes Concurrentes Multiples en Half-Open** | Rétablissement plus rapide en cas de succès. | Si le service distant est encore fragile, envoyer 10 requêtes simultanées le replonge immédiatement en saturation. |
| **Fallback en Plein Streaming** | Tente de sauver la réponse pour l'utilisateur. | Produit des réponses schizophréniques où la fin d'une phrase est générée par un modèle différent sans contexte partagé. |

## 5. Frontières Architecturales & Invariants

### Ce qui est DANS le périmètre de Layer 1 :
- Sélection et ordonnancement dynamique des modèles via `ServiceRegistry` et `ModelHealthRegistry`.
- Exécution de la cascade séquentielle sous double borne (tentatives $\le 4$, délai $\le 120\text{ s}$).
- Machine à états du disjoncteur (fenêtre 60s, 6 buckets de 10s, cooldowns 30s/120s/600s).
- Escalade de famille en cas de défaillance globale d'infrastructure.
- Rotation des clés d'API et notification de quota dépassé via `CredentialProvider`.
- Protection du streaming via le verrou de flux `Stream Lock`.

### Ce qui est EXCLU de Layer 1 :
- Les appels HTTP réseau directs et la signature des en-têtes (délégués à Layer 0 — SS-10).
- La manipulation des formats de messages propriétaires (déléguée à SS-11).
- La persistance des mémoires et la planification ReAct (déléguées au Core — SS-01..SS-09).

## 6. Liens & Navigation

- **Référence Technique :** [`layer1-smart-layer-reference.md`](./layer1-smart-layer-reference.md)
- **Guide Pratique d'Intégration :** [`layer1-smart-layer-howto.md`](./layer1-smart-layer-howto.md)
- **Index du Domaine Fournisseurs :** [`index.md`](./index.md)
