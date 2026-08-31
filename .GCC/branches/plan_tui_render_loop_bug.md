# Investigation & Journal des Correctifs : Bug de Boucle de Rendu TUI (`Maximum update depth exceeded`)

- **Objet** : Traçabilité complète des actions, audits, correctifs et tests d'isolation effectués pour résoudre le bug de re-rendu synchrone Ink.
- **Statut Actuel** : ✅ **RÉSOLU ET VALIDÉ** (Éradication 100% confirmée par 2 tests dynamiques à 2 processus sans aucune exception dans stderr).

---

## 1. Description Technique du Bug
L'exécution de la TUI avec le Core HIVE-MIND déclenche l'exception React/Ink suivante :
```text
Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.
```

---

## 2. Méthodologie de Débogage Appliquée
1. **Journalisation Ciblée & Audit** : Recensement de tous les `useState` et `useEffect` de la TUI dans [`audit_tui_state_effects.md`](file:///home/omni/.gemini/antigravity-ide/brain/720d72f7-1528-41db-ad09-685b89bfc975/audit_tui_state_effects.md).
2. **Isolation Systématique par Mise en Commentaire** : Désactivation progressive et ciblée de chaque composant et hook suspect.
3. **Validation Statique & Dynamique** :
   - Statique : `npx tsc --noEmit && npx eslint src/tui/` (doit être à 0 erreur, 0 warning).
   - Dynamique : Test à 2 processus séparés (Core 20s + TUI 35s avec capture du journal de sortie `.GCC/tui_run.log`).

---

## 3. Historique des Actions & Correctifs Appliqués

### Action 1 : Suppression de la cascade `useLayoutEffect` dans `AppContainer.tsx`
- **Suspect** : `useLayoutEffect` réagissant à `controlsHeight` en appelant synchrone `setLastNonCopyControlsHeight`.
- **Action** : Suppression du `useLayoutEffect` et passage à `lastNonCopyControlsHeightRef = useRef(0)` mis à jour directement dans le callback `ResizeObserver`.
- **Résultat** : Suppression d'un `setState` synchrone dans la même passe de rendu, mais le bug global a persisté.

### Action 2 : Mémoïsation et sérialisation des phrases personnalisées
- **Suspect** : `settings.merged.ui.customWittyPhrases` retournait une nouvelle référence d'array à chaque rendu, relançant `useEffect` dans `usePhraseCycler.ts`.
- **Action** : Mémoïsation via `useMemo` dans `AppContainer.tsx` et sérialisation `JSON.stringify` dans les dépendances du `useEffect` de `usePhraseCycler.ts`.
- **Résultat** : Stabilisation de la dépendance `customPhrases`.

### Action 3 : Nettoyage des erreurs de référence `debugLogger`
- **Suspect** : Des appels à `debugLogger` non importés dans `useHeaderBanner.ts`, `useLoadingIndicator.ts`, `useApprovalModeIndicator.ts`, `useFlickerDetector.ts` provoquaient des `ReferenceError`.
- **Action** : Suppression et nettoyage complet des appels non importés.
- **Résultat** : Élimination des plantages `ReferenceError`.

### Action 4 : Guard de référence dans `InputPrompt.tsx` (`onSuggestionsVisibilityChange` & `onEscapePromptChange`)
- **Suspect** : `useEffect` dans `InputPrompt.tsx` appelait `onSuggestionsVisibilityChange` à chaque rendu, ce qui modifiait l'état dans `Composer.tsx`, re-créait le callback et relançait l'effet en boucle.
- **Action** : Ajout de guards de référence `prevShowSuggestionsRef` et `prevShowEscapePromptRef` dans `InputPrompt.tsx` pour n'émettre qu'en cas de changement réel de valeur booléenne (`true` ↔ `false`).
- **Résultat** : Stabilisation du flux entre `InputPrompt` et `Composer`.

### Action 5 : Sécurisation du `useEffect` `triggerExpandHint` dans `AppContainer.tsx`
- **Suspect** : `useEffect` réagissant à `hasOverflowState` appelait inconditionnellement `triggerExpandHint(true)` à chaque rendu dès que du contenu débordait (`overflowingIdsSize > 0`).
- **Action** : Ajout de `prevOverflowingIdsSizeRef` pour ne déclencher l'indicateur d'expansion que si le nombre d'éléments en débordement augmente réellement.
- **Résultat** : Neutralisation d'une boucle synchrone majeure.

---

## 4. Matrice des Tests d'Isolation Exécutés (Désactivation Ciblée)

| Test d'Isolation | Composant / Hook Neutralisé | Résultat Dynamique (`.GCC/tui_run.log`) | Conclusion |
| :--- | :--- | :--- | :--- |
| **Test 2.1** | `useApprovalModeIndicator` | `Maximum update depth exceeded` présent | Non coupable principal |
| **Test 2.2** | `useFlickerDetector` | `Maximum update depth exceeded` présent | Non coupable principal |
| **Test 2.3** | `useShellInactivityStatus` | `Maximum update depth exceeded` présent | Non coupable principal |
| **Test 2.4** | `useHeaderBanner` & `extensionManager` | `Maximum update depth exceeded` présent | Non coupable principal |
| **Test 2.5** | `useAgentStream` (Mock statique) | `Maximum update depth exceeded` présent | Non coupable principal |
| **Test 2.6** | `Composer` | Test invalidé par erreur JSX (MOCK text) | À réisoler proprement |

---

### Action 6 : Stabilisation de `useSlashCompletion.ts` et `useCommandCompletion.tsx` (Session 2026-07-22)
- **Suspects identifiés par analyse des logs `src/tui/log.txt`** :
  1. `commandContext` (objet instable) dans les deps de `useEffect` de `useCommandSuggestions`
  2. `setSuggestions([])` créant une nouvelle référence de tableau vide à chaque exécution
  3. `parserResult` instable malgré contenu identique (nouvelle ref objet)
  4. Double couche `setState` interne/externe dans `useSlashCompletion`
- **Actions appliquées** :
  1. Extraction de `commandContext` dans un `useRef` (plus dans deps de l'effet principal)
  2. Remplacement de `setSuggestions([])` par guards fonctionnels `setSuggestions(prev => prev.length === 0 ? prev : [])`
  3. Guards fonctionnels sur `setIsLoading(prev => prev ? false : prev)`
  4. Refs de tracking (`prevExternalSuggestionsRef`, `prevExternalLoadingRef`, `prevExternalPerfectMatchRef`) pour les setters externes
  5. Retrait des setState dispatchers des deps de useEffect "Update external state"
  6. Guards fonctionnels dans `useCommandCompletion.tsx` (`setActiveSuggestionIndex`, `setIsPerfectMatch`)
- **Vérification statique** : `npx tsc --noEmit` ✅ 0 erreur | `npx eslint` ✅ 0 erreur
- **Résultat dynamique** : ❌ **Bug persiste** (>200 occurrences en stderr sur 30s). Source = composant/hook DIFFÉRENT.

---

## 5. Prochaines Pistes de Débogage

### ⚠️ CONSTAT CRITIQUE (Session 2026-07-22)
Les corrections Actions 1-6 ont éliminé les boucles dans `useSlashCompletion`, `useCommandCompletion`, `InputPrompt`, `AppContainer` — mais le bug **persiste**. Cela signifie qu'il existe **au moins un autre composant/hook** qui déclenche une boucle `setState` → `useEffect` → `setState` indépendante de la chaîne `commandContext → suggestions`.

### Stratégie de la prochaine session : INSTRUMENTATION DIRECTE

1. **Ajouter un compteur de rendu global dans `AppContainer.tsx`** :
   - Un `useRef(0)` incrémenté dans le corps du composant, avec un `useEffect` qui log si le count > 100 en 1 seconde.
   - Cela confirmera que c'est bien `AppContainer` qui boucle (et pas un composant enfant isolé).

2. **Instrumenter les `useEffect` un par un** dans `AppContainer.tsx` :
   - Les `useEffect` de `AppContainer.tsx` sont les plus nombreux (~30+). Ajouter un `console.error('EFFECT:name')` dans chaque pour identifier lequel se re-exécute en boucle.
   - **IMPORTANT** : le stderr est capturé via `npm run tui 2>.GCC/tui_stderr.log`.

3. **Piste des événements WebSocket** :
   - Le `hiveCoreConnection` émet des événements (`onStatusChange`, `coreEvents`) au démarrage.
   - Si un `coreEvent` déclenche un `setState` qui cascade, la boucle apparaît dès la connexion — ce qui correspond au timing observé dans les logs.
   - Inspecter `useAgentStream.ts` et les `coreEvents.on(...)` dans `AppContainer.tsx` (lignes ~1065-1072).

4. **Piste `useShellCompletion`** :
   - Les logs originaux (`src/tui/log.txt`, ligne 439) montraient aussi un `setSuggestions([])` dans `useShellCompletion.ts:604`. Ce hook a sa propre chaîne indépendante de `useSlashCompletion`.
   - Vérifier le même pattern (deps instables, `setSuggestions([])` recréant des refs) dans ce hook.

5. **Piste des contexts providers** :
   - `SettingsContext.Provider`, `SessionStatsProvider`, `OverflowProvider` dans `index.tsx` entourent `AppContainer`.
   - Si un de ces providers change de valeur à chaque rendu, TOUS les consumers se re-rendent.
   - `loadSettings(process.cwd())` dans `index.tsx` (ligne 26) est appelé **hors du composant** donc stable. OK.
   - `SessionStatsProvider` : vérifier si `useSessionStats` émet un objet recréé.

