# Execution Plan: Pont d'événements Core → TUI (`AgentEventBridge`)

> **Statut : NON DÉMARRÉ — en attente d'arbitrage utilisateur sur l'ordre des chantiers.**
> Changement de **comportement**, à ne pas mélanger avec le plan lint
> (`plan_lint_recovery_8sessions.md`). Créé le 2026-07-29 à la suite de la question
> utilisateur : « pour que la TUI fonctionne le core doit avoir un registre d'état bien précis
> complètement implémenté […] il faut qu'on enregistre tous les états possibles dans un module
> dédié ? vu que la TUI ne fait rien et que c'est le core qui fait pratiquement tout. »

## 📋 Target Invariant & Pre-requisites

- **Target Invariant** : un seul vocabulaire de rendu (`AgentEvent`, déjà déclaré dans
  `src/tui/ui/contexts/UIStateContext.tsx:234`) et **une seule** traduction
  `BotEvents → AgentEvent`. Le core émet un **flux** ; la TUI **dérive** l'état. Interdit :
  introduire un troisième vocabulaire intermédiaire, ou dupliquer une machine à états côté core.
- **Pre-requisites** :
  - Session 3 du plan lint close (`npx eslint src/core/transport --max-warnings=0` → 0), pour ne
    pas empiler un changement de comportement sur un répertoire encore rouge.
  - `EventEmitter<HiveTransportEvents>` en place (fait, `src/tui/transport/HiveTransport.ts:97`) :
    tout canal ajouté à la carte est automatiquement vérifié à la compilation aux deux bouts.

## 🔍 Constat d'analyse (déjà vérifié — ne pas refaire l'investigation)

### Réponse à la question posée : **non**, pas de registre d'états côté core. Un pont.

Le vocabulaire de rendu existe déjà et il est déjà branché côté TUI :

- `src/tui/ui/contexts/UIStateContext.tsx:192` — `AgentEventType`, 12 états canoniques :
  `agent_start | agent_end | message | tool_request | tool_update | tool_response | error |
  initialize | session_update | elicitation_request | elicitation_response | usage | custom`.
- `UIStateContext.tsx:234` — `AgentEvent` porte `display?: ToolCallDisplay`
  (`{ filePath, fileDiff, title, result, … }`, l.207) et `_meta?: AgentEventMeta`
  (`legacyState { status, progressMessage, progress, progressTotal, pid, outputFile }`, l.217).
- `src/tui/ui/hooks/useAgentStream.ts:92-160` consomme déjà `tool_request` / `tool_update` /
  `tool_response` et maintient `trackedTools` — **c'est déjà la machine à états**.
- `src/tui/ui/components/messages/DenseToolMessage.tsx:74-125` **rend déjà** le compteur demandé
  (`added 27`) :

```ts
const added = (diff.diffStat?.model_added_lines ?? 0) + (diff.diffStat?.user_added_lines ?? 0);
const removed = (diff.diffStat?.model_removed_lines ?? 0) + (diff.diffStat?.user_removed_lines ?? 0);
…
<Text color={addColor}>+{added}</Text>
<Text color={removeColor}>-{removed}</Text>
```

Créer un « module registre de tous les états possibles » côté core produirait une chaîne
`BotEvents → registre → AgentEvent`, soit **deux** traductions au lieu d'une, et deux sources de
vérité à synchroniser. C'est pourquoi la réponse est un pont, pas un registre.

### Le fil est coupé en trois endroits distincts

| Signal | État réel vérifié |
| --- | --- |
| `AI_REQUEST` / `AI_RESPONSE` (`src/core/events.ts:61-62`) | **zéro `publish`** dans tout `src/` — constantes mortes |
| `TOOL_PROGRESS` (`events.ts:71`) | publié 3× (`src/core/index.ts:319`, `:2473`, `:2881`) — **zéro abonné**. Les seuls `eventBus.subscribe` du projet : `src/services/feedbackService.ts:26` et `src/scripts/test_remaining_e2e.ts:59`. Le signal est produit puis jeté. |
| `SERVICE_START` / `SERVICE_END` (`events.ts:100-101`) | publiés (`src/services/learning/LearningEngine.ts:57,121`, `src/services/runtime/RuntimeInfrastructure.ts:298,448`) — jamais consommés |
| `custom` / `service_start` | `src/tui/core/connection.ts:192-206` le traite côté client, mais **aucun émetteur côté core** (`grep "emit('custom'"` sur `src/core`, `src/tui/transport`, `src/services` = 0). Code mort côté client. |
| `HiveTransportEvents` (`src/tui/transport/HiveTransport.ts:84-95`) | 10 canaux, **aucun `tool_*`**, aucun cycle de vie agent. |

**Conséquence directe** : faute de canal dédié, `src/tui/core/connection.ts:231-240` reconstruit
l'état agent depuis `presence` — `composing|recording → agent_start`,
`paused|available → agent_end`. Or `presence` est partagé avec Telegram/WhatsApp (information
métier fournie par l'utilisateur : « la présence n'est pas utilisée uniquement pour la TUI »).
Tout provider émettant une présence pour ses propres besoins déclenche un faux `agent_start`.

### Troisième coupure, à la source : les outils ne produisent pas de données structurées

`src/plugins/base/dev_tools/FileEditTool.ts:536` retourne :

```ts
userOutput: `📝 *File modified*: \`${shortFileName}\`\n~ Replacement successfully performed ~`
```

Une chaîne pré-formatée pour WhatsApp. Pas de `filePath`, pas de compteur de lignes.
`editsApplied` (l.405) compte des **éditions**, pas des lignes. Idem mode multi-fichiers (l.266) :
`llmOutput`/`userOutput` textuels uniquement.

**Donc même le fil rétabli, il n'y aurait rien à afficher** : `update(core/exemple.txt) … added 27`
n'existe nulle part sous forme de données.

## 🛠️ Step-by-Step Sequence

> **Ordre à arbitrer** : chantier 1 d'abord (données puis transport) ou chantiers 2+3 d'abord
> (transport puis données). Question posée à l'utilisateur, réponse non encore donnée.

### Chantier 1 : produire les données structurées à la source

- [ ] **Action** : déplacer `FileDiff` (déclaré `src/tui/ui/contexts/UIStateContext.tsx:1822`,
      avec son `diffStat { model_added_lines, model_removed_lines, user_added_lines,
      user_removed_lines }`) vers `src/core/types/`. Motif : la forme vit aujourd'hui dans la
      couche présentation ; `src/plugins` ne peut pas l'importer sans violer le flux
      `UI → Domain → Infra` (`architecture_and_state_boundaries`). Réexporter depuis
      `UIStateContext.tsx` pour ne casser aucun import existant (rule 1 : réutiliser, ne pas
      dupliquer).
- [ ] **Action** : dans `FileEditTool.ts`, calculer `diffStat` depuis `content`/`newContent`
      déjà en mémoire aux deux points d'écriture (`fs.writeFileSync` l.400 mode ancres, l.509
      mode legacy) et joindre `filePath` + `diffStat` au retour. Ne **pas** supprimer
      `userOutput` : les providers WhatsApp/Telegram en dépendent — ajouter un champ structuré
      à côté.
- [ ] **Portée exacte des écrivains de fichiers** (inventaire fait) : seul `FileEditTool.ts`
      est un outil d'édition exposé à l'agent. `src/plugins/base/admin/index.ts:407`
      (écriture de config) et `src/plugins/web/google_ai_search/index.ts:83` (fichier de token)
      ne sont pas des éditions agent → **hors périmètre**.
- [ ] **Verify** : `npx tsc --noEmit` → 0 ; test unitaire sur `FileEditTool` prouvant
      `diffStat.model_added_lines` exact sur une édition connue.
- **Verification Proof** :

```text
[à remplir]
```

### Chantier 2 : ouvrir les canaux manquants sur le transport

- [ ] **Action** : ajouter à `HiveTransportEvents` (`src/tui/transport/HiveTransport.ts:84`) les
      canaux `tool_request` / `tool_update` / `tool_response` (payloads alignés sur `AgentEvent`
      : `requestId`, `name`, `display`, `_meta.legacyState.status`) et `agent_lifecycle` portant
      les **trois** signaux explicitement demandés par l'utilisateur : début d'appel LLM, début
      d'action de l'agent, arrêt.
- [ ] **Action** : `TuiServerTransport.broadcast()` est déjà génériquement contraint
      (`<K extends keyof HiveTransportEvents>`, l.303) — aucun changement de signature requis ;
      seuls les 4 listeners correspondants sont à abonner/désabonner dans `start()`/`stop()`.
- [ ] **Verify** : `npx tsc --noEmit` → 0 (le générique de `EventEmitter` force la cohérence
      émetteur/consommateur) ; `npx eslint src/core/transport src/tui/transport --max-warnings=0`.
- **Verification Proof** :

```text
[à remplir]
```

### Chantier 3 : le pont

- [ ] **Action** : créer `src/core/transport/AgentEventBridge.ts` — responsabilité **unique**
      (rule : one primary responsibility per file) : s'abonner à `eventBus`
      (`TOOL_PROGRESS`, `SERVICE_START`, `SERVICE_END`, et les `AI_REQUEST`/`AI_RESPONSE` qu'il
      faudra enfin **publier** dans `src/core/index.ts`) et réémettre sur `hiveTransport` avec
      les payloads du chantier 2. Désabonnement explicite au shutdown (symétrie
      `start()`/`stop()`, cf. `TuiServerTransport.ts:259-267`).
- [ ] **Action** : publier `AI_REQUEST` / `AI_RESPONSE` là où le core appelle réellement le LLM
      (constantes actuellement mortes — rule 13 : une variable de configuration doit être
      référencée sur au moins un chemin d'exécution).
- [ ] **Action** : supprimer la traduction `presence → agent_start/agent_end`
      (`src/tui/core/connection.ts:231-240`) et lui substituer la consommation de
      `agent_lifecycle`. Supprimer aussi le traitement `custom`/`service_start` mort
      (`connection.ts:192-206`) **ou** l'alimenter réellement depuis le pont — arbitrer à
      l'implémentation.
- [ ] **Verify** : `NODE_OPTIONS='--experimental-vm-modules' npx jest
      src/tests/integration/tui_websocket.test.ts --forceExit` → 7/7 maintenus, plus un nouveau
      test prouvant qu'un `TOOL_PROGRESS` publié sur `eventBus` atteint le client TUI sous forme
      de `tool_update`. **Preuve runtime obligatoire**, la compilation ne suffit pas.
- **Verification Proof** :

```text
[à remplir]
```

## ⚠️ Mitigations & Edge Cases

- **Risque** : `connection.ts` porte déjà `sonarjs/cognitive-complexity` 33/15 sur
  `handleServerEvent` (hors périmètre lint Session 3, relève des Sessions 5–6). Ajouter des
  branches l'aggrave.
  **Mitigation** : le retrait de la traduction `presence` et du bloc `custom` mort **réduit** la
  complexité ; router les nouveaux `tool_*` via une table `type → handler` plutôt qu'une chaîne
  de `if`. Net attendu : à la baisse.
- **Risque** : `presence` reste nécessaire aux providers (Baileys `sendPresenceUpdate`).
  **Mitigation** : ne rien retirer côté émetteur — seule la **traduction** côté TUI disparaît.
  `PresencePayload` et `setPresence()` restent intacts.
- **Risque** : `FileDiff` déplacé casse des imports.
  **Mitigation** : réexport depuis `UIStateContext.tsx` ; `tsc --noEmit` est le juge.
- **Risque** : régression des providers si `userOutput` de `FileEditTool` change.
  **Mitigation** : champ structuré **ajouté**, jamais substitué.
- **Risque** : le pont abonné à `eventBus` sans TUI connectée accumule des listeners.
  **Mitigation** : instanciation unique au démarrage, désabonnement explicite au shutdown
  (rule 8 : vérifier l'absence d'instance antérieure avant enregistrement).

## 📎 Notes de portée

- **Non inclus** : refonte du rendu Ink (déjà capable), machine à états côté core (rejetée
  ci-dessus), `plan_lint_recovery_8sessions.md` (indépendant).
- **Question ouverte à l'utilisateur** : ordre chantier 1 → 2+3, ou 2+3 → 1 ?
- **Coût estimé** : chantier 2 ≈ 3 fichiers ; chantier 3 ≈ 1 nouveau + 2 modifiés ; chantier 1
  ≈ 2 fichiers + 1 test (périmètre borné à `FileEditTool.ts` par l'inventaire ci-dessus).
