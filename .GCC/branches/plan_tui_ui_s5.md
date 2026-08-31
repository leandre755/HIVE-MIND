# Execution Plan: Session 5 — TUI/UI partie 1 (hooks + messages + shared)

> **Destinataire : agent d'exécution.** Ce plan est prescriptif. Toute recette ci-dessous a été
> vérifiée empiriquement sur ce dépôt le 2026-07-30 (sorties de commandes en § 4). N'invente pas de
> pattern alternatif : si un cas ne rentre dans aucune recette du § 4, **arrête-toi et demande** au
> lieu d'improviser.

## 📋 Target Invariant & Pre-requisites

- **Target Invariant 1** : `npx tsc --noEmit` = **0 erreur sur tout le projet**, avant ET après
  chaque fichier traité. C'est la contrainte la plus dure de cette session (voir § 4.1 : la recette
  principale peut casser le typage si elle est appliquée mécaniquement).
- **Target Invariant 2** : zéro commentaire d'inhibition introduit (`eslint-disable`, `@ts-ignore`,
  `@ts-nocheck`, `@ts-expect-error`, `as any`). La config ESLint les rend structurellement
  inopérants (`noInlineConfig: true`, `reportUnusedDisableDirectives: 'error'`).
- **Target Invariant 3** : **comportement runtime constant**. Cette session est un travail de
  typage/lint, pas une refonte fonctionnelle. Aucun changement de comportement observable de la TUI
  n'est autorisé sans arbitrage utilisateur explicite.
- **Target Invariant 4** : aucun seuil de règle relevé dans `eslint.config.js`. Ce fichier
  **ne doit pas être modifié** pendant la session.
- **Pre-requisites** : arbre de travail propre au commit `2261c6d` (Sessions 1–4 closes),
  `npx tsc --noEmit` à 0 erreur au départ, ~3,5 Go de RAM disponibles.

## 🎯 Périmètre exact

**Trois répertoires, et rien d'autre :**

```text
src/tui/ui/hooks/
src/tui/ui/components/messages/
src/tui/ui/components/shared/
```

**Hors périmètre — ne pas ouvrir** (Session 6) : `src/tui/ui/AppContainer.tsx`,
`src/tui/ui/contexts/`, `src/tui/ui/utils/`, `src/tui/ui/commands/`, `src/tui/ui/components/*.tsx`
à la racine (`Footer.tsx`, `InputPrompt.tsx`, `SettingsDialog.tsx`…), `src/tui/config/`.

**Interdit de toucher** (Sessions 1–4 closes, régression = perte de preuve) : `src/core/index.ts`,
`src/types/tui-globals.d.ts`, `src/core/transport/*`, `src/providers/*`.

Exception unique : si le typage strict d'un fichier du périmètre **impose** de corriger un type dans
un fichier hors périmètre, la modification doit être **minimale** (ajout ou correction d'un type,
jamais une refonte) et signalée dans le message de commit.

## 📊 Baseline mesurée le 2026-07-30 (à ne pas refaire)

```text
$ npx eslint src/tui/ui/hooks src/tui/ui/components/messages src/tui/ui/components/shared -f json
TOTAL 588 problèmes = 258 erreurs + 330 warnings / 57 fichiers
```

L'estimation du plan maître (« ~550 erreurs ») était fausse. **Inventaire exhaustif par fichier,
par règle et par ligne : `.GCC/branches/plan_tui_ui_s5_baseline.md`.** Utilise-le comme checklist.

Répartition par règle :

| n | règle | sévérité |
|---|---|---|
| 274 | `security/detect-object-injection` | warn |
| 86 | `@typescript-eslint/no-explicit-any` | err |
| 47 | `sonarjs/cognitive-complexity` | err |
| 24 | `react-hooks/exhaustive-deps` | warn |
| 23 | `sonarjs/no-nested-conditional` | err |
| 15 | `import-x/no-named-as-default-member` | warn |
| 14 | `security/detect-non-literal-fs-filename` | warn |
| 13 | `@typescript-eslint/no-unused-vars` | err |
| 12 | `sonarjs/no-nested-functions` | err |
| 11 | `sonarjs/unused-import` | err |
| 9 | `no-shadow` | err |
| 8 | `sonarjs/no-unused-vars` · 8 `sonarjs/pseudo-random` | err |
| 7 | `max-lines-per-function` | err |
| 6 | `sonarjs/single-char-in-character-classes` | err |
| 5 | `sonarjs/no-dead-store` | err |
| ~20 | longue traîne sonarjs/security (1 à 3 occurrences chacune) | err/warn |

**Concentration** : 2 fichiers portent 244 des 588 problèmes (41 %) —
`components/shared/text-buffer.ts` (**205**, 3954 lignes) et
`components/shared/vim-buffer-actions.ts` (**39**, 1245 lignes). Ils sont traités **en dernier**
(lots 6 et 7) et **seulement après** avoir écrit les tests du lot 0.

## 🚫 Règles absolues (violation = travail rejeté)

1. **Un fichier à la fois.** Modifier → vérifier → passer au suivant. Jamais deux fichiers en
   parallèle, jamais un `sed`/`--fix` de masse sur plusieurs fichiers.
2. **Ne jamais mesurer un lint à travers un pipe.** `eslint … | tail; echo $?` renvoie le code de
   `tail`, pas d'ESLint. Toujours :
   `npx eslint <cible> --max-warnings=0; echo "EXIT=$?"`, ou rediriger vers un fichier puis lire le
   code : `npx eslint <cible> > /tmp/out.txt 2>&1; echo "EXIT=$?"`.
3. **Aucun commentaire d'inhibition**, aucun `as any`, aucun `!` d'assertion non-nulle ajouté pour
   faire taire une erreur. Corriger la cause.
4. **Ne pas modifier `eslint.config.js`, `tsconfig.json`, `.prettierrc`, `jest.config.js`,
   `package.json`, `.husky/pre-commit`.** Aucun seuil relevé, aucune dépendance installée. Si tu
   crois avoir besoin d'une dépendance (ex. `ink-testing-library`), **demande l'arbitrage**.
5. **Commandes séquentielles uniquement.** Hôte dual-core i5-4300U, ~3,5 Go libres. `free -m` avant
   `tsc --noEmit` et avant `jest`. Ne jamais lancer deux commandes lourdes en parallèle.
6. **Ne jamais exécuter `git checkout`, `git restore`, `git reset --hard`, `git clean` sur des
   fichiers non commités.** Un incident passé (`git checkout src/`) a détruit une session entière
   de travail. Pour annuler : `git stash`.
7. **Ne pas renommer ni supprimer un export public** d'un fichier du périmètre : 14 fichiers
   importent `text-buffer.ts`. Vérifier les appelants avant toute suppression :
   `grep -rn "<nomExporté>" src/ --include=*.ts --include=*.tsx`.
8. **Un paramètre non lu ne se supprime pas s'il fait partie d'une signature contractuelle**
   (callback React, implémentation d'interface) : le préfixer `_` suffit
   (`argsIgnorePattern: '^_'` est actif dans la config).
9. Communication avec l'utilisateur **en français**.

## 🧪 § 4 — Catalogue de recettes (vérifié empiriquement)

### 4.1 `security/detect-object-injection` — 274 occurrences, le gros du lot

**Nature réelle mesurée** : ce ne sont presque jamais des clés utilisateur. Classification des 274
sites (script d'analyse sur la sortie JSON) :

| catégorie | n | forme |
|---|---|---|
| lecture avec repli | 87 | `arr[i] \|\| x` · `arr[i] ?? x` |
| lecture simple par index numérique | 103 | `const c = chars[i];` en boucle |
| écriture par index | 25 | `target[i] = v` |
| autres (index dérivé, clé constante, optionnel) | 59 | `chars[nextBaseCharIdx]` · `args?.[CONST]` |

**Preuve du déclencheur** (fichier sonde, supprimé depuis) :

```text
/tmp probe → npx eslint src/tui/ui/components/shared/__probe.ts
   2:10  warning  Generic Object Injection Sink  security/detect-object-injection   ← return chars[i]
  25:3   warning  Generic Object Injection Sink  security/detect-object-injection   ← target[i] = v
✖ 2 problems (0 errors, 2 warnings)
```

Les 5 autres formes testées dans la même sonde (`.at(i)`, helper générique `elementAt`,
`for (const [i, ch] of arr.entries())`, `splice(i,1,v)`, `new Map(Object.entries(rec)).get(k)`)
sortent **EXIT=0** : c'est le **bracket littéral** que la règle voit, rien d'autre.

#### ⚠️ Piège de typage — lire absolument

`tsconfig.json` n'active **pas** `noUncheckedIndexedAccess`. Conséquence mesurée :

```text
$ npx tsc --noEmit
src/tui/ui/components/shared/__probe.ts(7,10): error TS18048: 'c' is possibly 'undefined'.
```

- `chars[i]` est typé `string` (mensonge du compilateur, mais accepté partout).
- `chars.at(i)` est typé `string | undefined` → **casse tout usage direct en aval**.

Donc **`.at()` n'est pas un remplacement mécanique**. Applique la table de décision suivante.

#### Table de décision (obligatoire)

| forme d'origine | recette | pourquoi |
|---|---|---|
| `arr[i] \|\| fallback` | `arr.at(i) \|\| fallback` | le repli absorbe `undefined`, typage inchangé. **Cas le plus sûr : commence par ceux-là (87 sites).** |
| `arr[i] ?? fallback` | `arr.at(i) ?? fallback` | idem |
| boucle `for (let i…)` qui parcourt **tout** le tableau et lit `arr[i]` | `for (const [i, item] of arr.entries())` | `item` est typé `T` non-optionnel, aucune garde à ajouter. Vérifié EXIT=0 / 0 erreur `tsc`. |
| lecture simple `const c = arr[i];` puis usage direct, hors boucle complète | `const c = arr.at(i); if (c === undefined) { …retour/garde explicite… }` | fail-closed (rule 4). **Le retour de la garde doit préserver l'invariant de la fonction** — si tu ne sais pas quoi retourner, laisse le site en place et signale-le. |
| écriture `arr[i] = v` remplaçant un élément **existant** | `arr.splice(i, 1, v)` | vérifié EXIT=0. |
| écriture `arr[i] = v` en **extension** (i ≥ length) ou sur un `Record` | **laisser en place**, signaler | `splice` ne remplit pas les trous : sémantique différente. |
| clé **string dynamique** sur `Record<string, T>` (ex. `heights[key]`, `pastedContent[match]`) | `new Map(Object.entries(rec)).get(key)` → pattern validé en Session 3 | mais **jamais dans une boucle chaude** : reconstruire la `Map` à chaque itération est une régression de perf. Si le `Record` est reconstruit à chaque rendu, hisse la `Map` hors de la boucle. |

**Interdit** : `Array.prototype.with()`. Vérifié indisponible sur ce projet :

```text
error TS2550: Property 'with' does not exist on type 'string[]'.
  Do you need to change your target library? Try changing the 'lib' compiler option to 'es2023' or later.
```

(`target: ES2022` dans `tsconfig.json`, et **on ne change pas le tsconfig**.)

**Interdit** : ajouter un garde `Object.hasOwn(obj, key)` en espérant taire la règle. Elle se
déclenche sur le bracket, pas sur l'absence de garde — mesuré en Session 3, inefficace.

**Interdit** : créer un helper maison `elementAt()` / `safeIndex()` global. Vérifié : aucun n'existe
aujourd'hui dans `src/`. En introduire un ferait passer 274 sites par une indirection
supplémentaire dans du code de rendu appelé à chaque frame. Utilise `.at()` / `.entries()`, qui sont
natifs. (Un helper reste acceptable **localement** dans `text-buffer.ts` si et seulement si tu
constates qu'il évite plus de 20 gardes identiques ; dans ce cas, propose-le avant de l'écrire.)

### 4.2 `@typescript-eslint/no-explicit-any` — 86 occurrences

Ordre de préférence, du meilleur au pire :

1. **Type importé depuis le module qui produit la valeur** (`src/tui/ui/types.ts`,
   `contexts/UIStateContext.ts`, `src/types/tui-globals.d.ts`, ou les `.d.ts` de `node_modules/`
   pour `ink`/`react`).
2. **Interface locale de découplage** si importer le type créerait un cycle (technique validée en
   Session 3 sur `audioHandler.ts` : `interface TranscriptionService { … }` au lieu d'importer la
   classe concrète). Ne déclare que les membres réellement lus.
3. `unknown` + rétrécissement explicite (`typeof`, `in`, garde de type nommée
   `function isX(v: unknown): v is X`).
4. **Jamais** `any`, jamais `as any`, jamais `Function`, jamais `object`.

Ne **jamais inventer** la forme d'un objet venant d'une bibliothèque : lire le `.d.ts` dans
`node_modules/<pkg>/`. Un type inventé qui compile est un bug latent (Session 3 en a produit trois :
`reaction.messageTimestamp` inexistant, `options.filename` vs `fileName`, `response.plain_text` vs
`plainText` — tous invisibles au compilateur, tous cassés au runtime).

### 4.3 `sonarjs/cognitive-complexity` — 47 occurrences (seuil 15)

**La cause est presque toujours la profondeur d'imbrication, pas le nombre de branches.** Décision
de référence du 2026-07-30 (`_runFamilyModels` extrait de `_runCascade`, `src/providers/index.ts`) :
extraire la **boucle interne** dans une fonction nommée fait tomber la profondeur de 3 à 2 niveaux
et le score de 17 à moins de 15, sans toucher à la logique.

Recettes, dans cet ordre :

1. **Guard clauses** : remplacer `if (ok) { …30 lignes… }` par `if (!ok) return …;` puis le corps à
   plat. Gain immédiat d'un niveau.
2. **Extraire la boucle ou la branche la plus profonde** dans une fonction nommée au module (hors
   du composant/hook), qui retourne un objet explicite (`{ result?, error? }`) plutôt que de muter
   une variable de la portée englobante.
3. **Table de correspondance** : une cascade de `if/else if` sur une même valeur devient une `Map`
   ou un `switch`.

**Interdit** : relever le seuil ; découper arbitrairement en `partA`/`partB` sans frontière
sémantique ; déplacer du code dans une fonction imbriquée (cela déclenche
`sonarjs/no-nested-functions`, 12 occurrences déjà présentes).

**Attention `max-lines-per-function` (seuil 200, 7 occurrences)** : dans un composant React, la
fonction, c'est le composant entier. `VirtualizedList` fait 322 lignes,
`useVimDeleteActions` 209, `useCommandCompletion` 207. La seule sortie propre est d'extraire des
sous-hooks ou des sous-composants. **Ces 7 cas sont les plus risqués de la session** : traite-les en
dernier dans leur lot et vérifie le rendu (§ 6).

### 4.4 `react-hooks/exhaustive-deps` — 24 occurrences, **le piège le plus dangereux**

18 des 24 sont dans `text-buffer.ts` et disent tous : *React Hook useCallback has a missing
dependency: `d`*. `d` est l'objet de contexte du buffer, **recréé à chaque rendu**.

**Ajouter `d` au tableau de dépendances invalide le `useCallback` à chaque rendu** → recréation de
tous les handlers → potentiellement une boucle de rendu infinie dans la TUI. C'est un changement de
comportement, pas une correction de lint.

**Procédure obligatoire pour ces 24 sites :**

1. Ne les traite qu'en **lot 7**, après tout le reste.
2. Recette autorisée : **capturer les champs réellement lus dans des variables locales avant le
   hook**, puis lister ces variables en dépendances
   (`const { dispatch, singleLine } = d;` → `[dispatch, singleLine]`). Cela satisfait la règle sans
   élargir l'invalidation.
3. Si le champ lu est une fonction recréée à chaque rendu côté appelant, la recette ne suffit pas :
   **arrête-toi et signale le site**. Ne stabilise pas la référence à coups de `useRef` sans
   arbitrage — c'est une modification de la sémantique du composant.
4. Après chaque fichier touché sur cette règle : vérification runtime du § 6, obligatoire.

### 4.5 Règles mécaniques (sans risque, à faire en premier dans chaque fichier)

| règle | recette |
|---|---|
| `sonarjs/unused-import` (11) · `@typescript-eslint/no-unused-vars` (13) · `sonarjs/no-unused-vars` (8) | Supprimer l'import/la variable. Si c'est un **paramètre de signature contractuelle**, le préfixer `_`. Vérifier avant suppression qu'il n'est pas utilisé uniquement dans un type (`grep` dans le fichier). |
| `sonarjs/no-dead-store` (5) | Supprimer l'affectation jamais relue. Vérifier qu'aucun effet de bord n'est perdu (appel de fonction en partie droite). |
| `sonarjs/single-char-in-character-classes` (6) | `[a]` → `a` dans la regex. Purement syntaxique. |
| `sonarjs/concise-regex` (2) · `sonarjs/duplicates-in-character-class` (1) | Simplifier la classe (`[0-9]` → `\d`, retirer le doublon). **Tester la regex sur un échantillon avant/après.** |
| `no-shadow` (9) | Renommer la variable interne (`index` → `itemIndex`). Renommage **local uniquement**. |
| `no-duplicate-imports` (1) | Fusionner les deux `import` du même module. |
| `sonarjs/pseudo-random` (8) | `Math.random()` → `randomUUID()` de `node:crypto` si c'est un identifiant ; si c'est une **animation décorative** (`useSnowfall`, `usePhraseCycler`), `Math.random()` est fonctionnellement correct : utiliser `crypto.randomInt()` de `node:crypto`, qui satisfait la règle sans changer la sémantique. |
| `sonarjs/no-nested-conditional` (23) | Extraire le ternaire imbriqué dans une `const` intermédiaire nommée, ou une fonction locale `pure`. Jamais de `if` dans du JSX : sortir le calcul au-dessus du `return`. |
| `sonarjs/no-nested-functions` (12) | Hisser la fonction interne au niveau du module si elle ne capture rien ; sinon la passer en paramètre. |
| `sonarjs/use-type-alias` (3) | Extraire l'union répétée en `type X = …` exporté si déjà utilisé ailleurs, sinon local. |
| `sonarjs/no-duplicated-branches` (3) · `no-all-duplicated-branches` (1) · `no-identical-expressions` (1) · `no-redundant-assignments` (3) · `no-redundant-jump` (1) · `prefer-single-boolean-return` (1) | **Lire attentivement : ces règles révèlent souvent un vrai bug** (deux branches identiques = une condition qui ne sert à rien, ou un copier-coller avec la mauvaise variable). Ne les « corrige » pas en supprimant du code sans avoir compris l'intention. En cas de doute sur l'intention : signale, ne devine pas. |
| `import-x/no-named-as-default-member` (15) | `import React from 'react'` + `React.useState` → `import { useState } from 'react'`. Le JSX n'a pas besoin de `React` en portée (`jsx: 'react-jsx'` dans le tsconfig). Technique validée en Session 3 sur `InkCLIAdapter.tsx`. |
| `security/detect-non-literal-fs-filename` (14) | Remplacer par les helpers **existants** de `src/utils/safeFs.ts` (rule 1, ne pas réécrire) : `safeReadFileSync`, `safeWriteFileSync`, `safeUnlinkSync`, `safeExistsSync`, `safeMkdirSync`, `safeStatSync`, `safeReaddirSync`, plus les variantes `async`. **`rmdirSync` et `mkdtempSync` n'ont pas d'équivalent** dans `safeFs.ts` (cas de `text-buffer.ts:3367` et `:3335`) — ajouter `safeRmdirSync`/`safeMkdtempSync` dans `safeFs.ts` en suivant exactement le pattern des fonctions voisines (`fsGet('…')` + `resolve(filePath)`), et rien d'autre. |
| `security/detect-non-literal-regexp` (2) · `sonarjs/super-linear-regex` (3) · `detect-unsafe-regex` (1) | Backtracking catastrophique. Réécrire la regex pour supprimer l'imbrication de quantificateurs, ou remplacer par un parcours de chaîne. **Vérifier l'équivalence sur des cas concrets avant/après** (les regexes de `text-buffer.ts:33` et `:800` traitent les chemins d'images collés et les placeholders de collage). |

## 🛠️ § 5 — Séquence d'exécution

Format de chaque lot : `Action -> verify: preuve`. **Un commit par lot**, message en `refactor(tui):`.
Recopie les sorties brutes de vérification dans ce fichier, sous le lot concerné, avant de passer au
lot suivant.

### Lot 0 — Filet de sécurité : tests des fonctions pures (À FAIRE EN PREMIER)

**Justification** : `text-buffer.ts` (3954 l.) et `vim-buffer-actions.ts` (1245 l.) portent 244
problèmes et **zéro test**. Vérifié : `src/tests/unit/tui/` ne contient que `windowTitle.test.ts`,
et `grep -rl "text-buffer\|useToolScheduler\|vim-buffer" src/tests` ne retourne rien. Modifier
2 200 lignes de logique de curseur Unicode sans test, c'est garantir une régression silencieuse.

- [x] **Action 0.1** : créer `src/tests/unit/tui/text-buffer-pure.test.ts`.
      Jest ne matche que `**/tests/**/*.test.ts` (pas `.tsx`) et `ink-testing-library` **n'est pas
      installé** : ne teste donc **que les fonctions pures exportées**, sans rendu React. Cibles
      (toutes exportées, toutes sans dépendance React) :
      `toCodePoints`-dépendants `findNextWordStartInLine`, `findPrevWordStartInLine`,
      `findWordEndInLine`, `findNextBigWordStartInLine`, `findPrevBigWordStartInLine`,
      `findBigWordEndInLine`, `findNextWordAcrossLines`, `findPrevWordAcrossLines`,
      `findNextBigWordAcrossLines`, `findPrevBigWordAcrossLines`, `getPositionFromOffsets`,
      `getLineRangeOffsets`, `replaceRangeInternal`, `offsetToLogicalPos`, `logicalPosToOffset`,
      `calculateTransformationsForLine`, `calculateTransformations`, `getTransformUnderCursor`,
      `getExpandedPasteAtLine`, `shiftExpandedRegions`, `calculateTransformedLine`,
      `expandPastePlaceholders`, `isWordCharStrict`, `isWhitespace`, `isCombiningMark`,
      `isWordCharWithCombining`, `getCharScript`, `isDifferentScript`, `getTransformedImagePath`.
      Couvre au minimum, pour chaque fonction retenue : ASCII simple, **caractère hors BMP**
      (emoji), **marque combinante** (accent décomposé), ligne vide, index en limite (0 et
      `length`), et index hors limites. Ce sont exactement les cas que les recettes `.at()` /
      `.entries()` du § 4.1 peuvent casser.
- [x] **Action 0.2** : créer `src/tests/unit/tui/vim-buffer-actions.test.ts`.
      `handleVimAction(state: TextBufferState, action: VimAction): TextBufferState` est une
      transition d'état **pure** : construis un `TextBufferState` littéral et vérifie l'état sortant.
      Couvre les actions de suppression, de déplacement de mot et de changement, sur texte ASCII et
      texte à emoji.
- [x] **Verify** :

```bash
free -m
NODE_ENV=test SUPABASE_URL=http://localhost SUPABASE_KEY=dummy \
  NODE_OPTIONS='--experimental-vm-modules' npx jest src/tests/unit/tui --forceExit
```

  Les tests doivent passer **sur le code actuel, non modifié**. Un test qui échoue au lot 0 décrit
  soit une attente fausse de ta part (corrige le test), soit un bug préexistant (**signale-le, ne le
  corrige pas** : ce serait un changement de comportement hors périmètre).
- [ ] **Commit** : `test(tui): add pure-function coverage for text-buffer and vim actions`
- **Verification Proof** : _(à remplir)_

### Lot 1 — Longue traîne mécanique : 26 fichiers à 1–4 problèmes

Ordre imposé (du plus petit au plus gros). Ces fichiers ne contiennent que des règles du § 4.5.

```text
hooks/shell-completions/npmProvider.ts (1) · hooks/shellReducer.ts (1)
hooks/useAnimatedScrollbar.ts (1) · hooks/useEditorSettings.ts (1)
hooks/useSessionBrowser.ts (1) · hooks/useTabbedNavigation.ts (1)
hooks/useThemeCommand.ts (1) · messages/SubagentHistoryMessage.tsx (1)
messages/ThinkingMessage.tsx (1) · shared/EnumSelector.tsx (1)
shared/SlicingMaxSizedBox.tsx (1) · shared/ExpandableText.tsx (2)
hooks/useBanner.ts (2) · hooks/useHookDisplayState.ts (2)
hooks/useInputHistory.ts (2) · hooks/useReverseSearchCompletion.tsx (2)
hooks/useSettingsNavigation.ts (2) · messages/SubagentProgressDisplay.tsx (3)
messages/Todo.tsx (3) · messages/TopicMessage.tsx (3) · shared/MaxSizedBox.tsx (3)
shared/SearchableList.tsx (3) · hooks/useFlickerDetector.ts (3)
hooks/useLoadingIndicator.ts (3) · hooks/usePhraseCycler.ts (3) · hooks/useStateAndRef.ts (3)
hooks/useApprovalModeIndicator.ts (4) · hooks/useConsoleMessages.ts (4)
hooks/useGitBranchName.ts (4) · hooks/useInputHistoryStore.ts (4) · hooks/useMcpStatus.ts (4)
messages/ToolGroupDisplay.tsx (4)
```

- [ ] **Action** : appliquer le § 4.5, fichier par fichier, avec la boucle de vérification du § 6.1.
- [ ] **Verify** (après le dernier fichier du lot) :

```bash
npx eslint <les 32 chemins du lot> --max-warnings=0; echo "EXIT=$?"
free -m && npx tsc --noEmit 2>&1 | grep -c "error TS"      # doit afficher 0
```

- [ ] **Commit** : `refactor(tui): clear mechanical lint in hooks and message components`
- **Verification Proof** : _(à remplir)_

### Lot 2 — `components/messages/` : les 11 fichiers restants

`ToolConfirmationMessage.tsx` (15) · `DenseToolMessage.tsx` (11) · `DiffRenderer.tsx` (10) ·
`ToolResultDisplay.tsx` (7) · `ToolShared.tsx` (6) · `ShellToolMessage.tsx` (5) ·
`SubagentGroupDisplay.tsx` (5) · `ToolGroupMessage.tsx` (5) · `ErrorMessage.tsx` (1) · `InfoMessage.tsx` (1) · `ModelMessage.tsx` (1) · `UserMessage.tsx` (1) · `WarningMessage.tsx` (1) · `UserShellMessage.tsx` (0) · `ToolMessage.tsx` (0)

- [x] **Action** : § 4.2 (`any`), § 4.3 (complexité), § 4.1 (injection), § 4.5.
      `DiffRenderer.tsx:395` (`languageMap[extension] || null`) est le cas d'école du pattern `Map`.
      `ToolResultDisplay.tsx` a 2 fonctions au-dessus du seuil de complexité (l.40, l.146).
- [x] **Verify** : `npx eslint src/tui/ui/components/messages/*.tsx --max-warnings=0` (0 errors, 0 warnings), `npx tsc --noEmit` (0 errors), `npx jest` (28/28 passed).
- [x] **Commit** : `66a7a0f` (`refactor(tui): clean ESLint and TypeScript issues in components/messages (Session 5 Lot 2)`)
- **Verification Proof** :

```text
$ npx eslint src/tui/ui/components/messages/*.tsx --max-warnings=0
EXIT=0

$ npx tsc --noEmit
EXIT=0 (Found 0 errors)

$ NODE_OPTIONS="$NODE_OPTIONS --experimental-vm-modules" npx jest ...
Test Suites: 3 passed, 3 total
Tests:       28 passed, 28 total

$ git diff | grep ts-ignore -> 0 matches
$ git diff | grep eslint-disable -> 0 matches
$ git diff | grep "as any" -> 0 added matches
```

### Lot 3 — `hooks/` moyens (5 à 13 problèmes)

`useSessionResume.ts` (13) · `useAgentStream.ts` (12) · `atCommandProcessor.ts` (11) ·
`useSelectionList.ts` (11) · `useSlashCompletion.ts` (10) · `useShellHistory.ts` (6) ·
`useSnowfall.ts` (6)

- [ ] **Action** : § 4.2, § 4.3, § 4.5. `useSnowfall.ts` = 6 × `pseudo-random` (animation :
      `crypto.randomInt()`, cf. § 4.5).
- [ ] **Verify** : ESLint sur les 7 chemins `--max-warnings=0` + `tsc` global
- [ ] **Commit** : `refactor(tui): type mid-size hooks`
- **Verification Proof** : _(à remplir)_

### Lot 4 — `hooks/` complexes : complétion, planificateur d'outils, vim

`useToolScheduler.ts` (26 — 9 `any`, 8 injections, 3 fonctions imbriquées, 1 complexité l.47) ·
`vim.ts` (19 — 4 fonctions au-dessus du seuil : l.367, 484, 613, 1039) ·
`slashCommandProcessor.ts` (18) · `useAtCompletion.ts` (15) · `useCommandCompletion.tsx` (15 — dont
`max-lines-per-function` 207/200) · `useShellCompletion.ts` (15 — 3 fonctions complexes)

- [ ] **Action** : c'est ici que `sonarjs/cognitive-complexity` domine. Applique § 4.3 dans
      l'ordre : guard clauses d'abord, extraction de boucle ensuite. `useToolScheduler.ts` pilote
      l'exécution des outils : ses 9 `any` décrivent des formes de résultat d'outil — cherche le
      type existant (`src/tui/ui/types.ts`, `src/core/tools/`) avant d'en écrire un.
- [ ] **Verify** : ESLint sur les 6 chemins + `tsc` global + vérification runtime § 6.2
- [ ] **Commit** : `refactor(tui): reduce complexity in completion and scheduler hooks`
- **Verification Proof** : _(à remplir)_

### Lot 5 — `components/shared/` hors les deux gros fichiers

`VirtualizedList.tsx` (22 — 15 injections, 2 complexités, `max-lines-per-function` 322/200,
`no-shadow` l.513, 2 `exhaustive-deps`) · `BaseSettingsDialog.tsx` (7) · `MaxSizedBox.tsx` (3 —
déjà fait au lot 1 si listé, sinon ici) · `SearchableList.tsx` (3)

- [ ] **Action** : `VirtualizedList.tsx` est le fichier le plus délicat du lot — c'est le moteur de
      défilement virtualisé. Ses accès `offsets[index]`, `heights[key]`, `data[i]`,
      `itemRefs.current[i]` sont en chemin chaud de rendu. Applique strictement la table du § 4.1
      (dont l'interdiction de reconstruire une `Map` dans une boucle). Le découpage de la fonction
      de 322 lignes vient **en dernier**, après que le reste du fichier soit à 0.
- [ ] **Verify** : ESLint sur les chemins du lot + `tsc` global + **vérification runtime § 6.2
      obligatoire** (défilement d'une longue liste)
- [ ] **Commit** : `refactor(tui): fix virtualized list and shared dialogs lint`
- **Verification Proof** : _(à remplir)_

### Lot 6 — `vim-buffer-actions.ts` (39 : 35 injections, 2 complexités, 2 imports morts)

- [ ] **Action 6.1** : les 2 imports morts (l.2) → suppression.
- [ ] **Action 6.2** : les 35 `detect-object-injection`. Ce fichier lit massivement
      `lines[row]`, `codePoints[i]`, souvent déjà sous la forme `lines[startRow] || ''` → la recette
      « repli » du § 4.1 s'applique directement et sans risque de typage sur la majorité.
- [ ] **Action 6.3** : les 2 fonctions au-dessus du seuil (l.94, l.276).
- [ ] **Verify** :

```bash
npx eslint src/tui/ui/components/shared/vim-buffer-actions.ts --max-warnings=0; echo "EXIT=$?"
free -m && npx tsc --noEmit 2>&1 | grep -c "error TS"
NODE_ENV=test SUPABASE_URL=http://localhost SUPABASE_KEY=dummy \
  NODE_OPTIONS='--experimental-vm-modules' npx jest src/tests/unit/tui --forceExit
```

  **Les tests du lot 0 doivent rester verts.** C'est la seule preuve de comportement constant sur ce
  fichier.
- [ ] **Commit** : `refactor(tui): clear vim buffer actions lint`
- **Verification Proof** : _(à remplir)_

### Lot 7 — `text-buffer.ts` (205 problèmes, 3954 lignes) — à découper en sous-commits

**14 fichiers importent ce module** (`AppContainer.tsx`, `InputPrompt.tsx`, `vim.ts`,
`TextInput.tsx`, `SearchableList.tsx`, `UserMessage.tsx`, `AskUserDialog.tsx`,
`BaseSettingsDialog.tsx`, `useSearchBuffer.ts`, `useRegistrySearch.ts`,
`useReverseSearchCompletion.tsx`, `InputContext.tsx`, `highlight.ts`, `vim-buffer-actions.ts`).
Toute modification de signature exportée casse en cascade. **Ne change aucune signature exportée.**

Sous-lots, dans cet ordre strict, un commit chacun :

- [ ] **7.1** — mécanique : 6 `single-char-in-character-classes` (l.60-65), 3
      `sonarjs/no-unused-vars` (l.984, 1708, 1917), 2 `no-dead-store` (l.1871, 1887), 2
      `no-redundant-assignments` (l.758-759), 1 `no-shadow` (l.2454), 1 `use-type-alias` (l.3022),
      1 `no-nested-conditional` (l.671), 2 `no-explicit-any` (l.2394, 3495).
- [ ] **7.2** — les 4 `detect-non-literal-fs-filename` (l.3339, 3349, 3362, 3367) via `safeFs.ts`,
      en ajoutant `safeRmdirSync` (et `safeMkdtempSync` si tu touches l.3335) au fichier existant,
      sur le modèle exact des fonctions voisines. Ce bloc est l'ouverture du buffer dans un éditeur
      externe : vérifier que le fichier temporaire est toujours supprimé dans le `finally`.
- [ ] **7.3** — les regexes : `detect-unsafe-regex` (l.33), `super-linear-regex` +
      `duplicates-in-character-class` (l.800, `imagePathRegex`), `detect-non-literal-regexp`
      (l.855, 1447). Écris un test de non-régression sur chaque regex modifiée **avant** de la
      toucher (ajout dans le fichier du lot 0).
- [ ] **7.4** — les 148 `detect-object-injection`, **par blocs de 15 à 20 sites maximum**, avec
      `tsc --noEmit` + `jest src/tests/unit/tui` après **chaque bloc**. C'est le passage où une
      erreur passe inaperçue : les fonctions de curseur manipulent des tableaux de points de code
      Unicode, et un `undefined` introduit par `.at()` se manifeste comme un curseur qui saute, pas
      comme une exception.
- [ ] **7.5** — les 11 `cognitive-complexity` (l.76, 113, 175, 359, 457, 1048, 1164, 1761, 1819,
      2099, 3129) + `max-lines-per-function` sur `useVimDeleteActions` (l.2498, 209/200).
- [ ] **7.6** — les 18 `react-hooks/exhaustive-deps` (l.2998→3372), **selon la procédure du § 4.4
      exclusivement**. Si plus de 3 sites tombent dans le cas « fonction recréée à chaque rendu » :
      arrête-toi, ne les corrige pas, et remonte la liste à l'utilisateur.
- [ ] **Verify** (après chaque sous-lot) : ESLint sur le fichier `--max-warnings=0` + `tsc` global +
      `jest src/tests/unit/tui` + vérification runtime § 6.2 pour 7.4, 7.5 et 7.6.
- **Verification Proof** : _(à remplir, un bloc par sous-lot)_

### Lot 8 — Clôture de session

- [ ] **Verify final** (les 5 commandes, séquentiellement) :

```bash
free -m
npx eslint src/tui/ui/hooks src/tui/ui/components/messages src/tui/ui/components/shared \
  --max-warnings=0; echo "ESLINT_EXIT=$?"
npx oxlint --deny-warnings src/tui/ui/hooks src/tui/ui/components/messages \
  src/tui/ui/components/shared > /tmp/ox_s5.txt 2>&1; echo "OXLINT_EXIT=$?"
npx prettier --check src/tui/ui/hooks src/tui/ui/components/messages \
  src/tui/ui/components/shared; echo "PRETTIER_EXIT=$?"
npx tsc --noEmit 2>&1 | grep -c "error TS"     # doit afficher 0
grep -rnE "eslint-disable|@ts-ignore|@ts-nocheck|@ts-expect-error|as any" \
  src/tui/ui/hooks src/tui/ui/components/messages src/tui/ui/components/shared; echo "GREP_EXIT=$?"
```

  Attendu : `ESLINT_EXIT=0`, `OXLINT_EXIT=0`, `PRETTIER_EXIT=0`, `0` erreur TS, `GREP_EXIT=1`
  (aucune occurrence).
- [ ] **Verify comportemental** : § 6.2 sur la TUI complète.
- [ ] **Action** : mettre à jour `.GCC/main.md` (§ Milestones, § Current Status) et réécrire
      `.GCC/resume.md` selon le template GCC.
- **Verification Proof** : _(à remplir)_

## 🔁 § 6 — Protocole de vérification

### 6.1 Boucle par fichier (obligatoire, sans exception)

```bash
# 1. Mesurer AVANT (les lignes de la baseline se décalent dès la première édition)
npx eslint <chemin/du/fichier> > /tmp/before.txt 2>&1; echo "EXIT=$?"; cat /tmp/before.txt

# 2. Éditer le fichier

# 3. Mesurer APRÈS — cible : EXIT=0
npx eslint <chemin/du/fichier> --max-warnings=0; echo "EXIT=$?"

# 4. Vérifier que rien n'a cassé ailleurs (le typage strict propage)
free -m && npx tsc --noEmit 2>&1 | grep -c "error TS"      # doit rester 0

# 5. Format
npx prettier --write <chemin/du/fichier>
```

**Effet cascade attendu, ce n'est pas une régression** : typer un fichier fait *monter* le compteur
de ses voisins avant de le faire descendre (constaté en Session 3 : `audioHandler.ts` 34→37,
`InkCLIAdapter.tsx` 27→30). Si un voisin **hors périmètre** se met à produire des erreurs `tsc`,
corrige le type de façon minimale et signale-le.

### 6.2 Vérification fonctionnelle (statique ≠ fonctionnel)

0 erreur de linter ne prouve rien sur le comportement d'une TUI. Après les lots 4, 5, 6 et 7 :

```bash
free -m
npm run tui       # démarre la TUI (tsx, APP_ENV=local)
```

Contrôles manuels minimaux : la TUI s'affiche sans exception ; la saisie d'un caractère, d'un emoji
et d'un accent fonctionne ; les déplacements de mot (`Ctrl+←/→`) placent le curseur correctement ;
une longue liste défile. **Arrêter le processus dès la vérification faite** (`Ctrl+C`) : c'est un
processus lourd sur cet hôte.

Si un contrôle échoue, la session est en état **FAILED** sur ce lot : ne commite pas par-dessus,
diagnostique. `git stash` si tu as besoin de comparer avec l'état d'avant.

### 6.3 Procédure de commit (le hook pre-commit est inutilisable)

`.husky/pre-commit` étape 3/8 lance `oxlint --deny-warnings src/` sur **tout** `src/`. Mesuré le
2026-07-30 : `EXIT=1`, avec 14 occurrences sur `src/tui/ui/AppContainer.tsx`, 9 sur
`src/tui/ui/contexts/UIStateContext.tsx`, plus `src/tests/`, `src/scripts/`, `src/tui/ui/utils/`.

**Correction d'une affirmation du handoff précédent** : la Session 5 **ne débloquera pas** le hook.
Les fichiers bloquants principaux sont `AppContainer.tsx` et `contexts/UIStateContext.tsx`, qui
relèvent de la **Session 6**, et `src/tests/`/`src/scripts/`, qui relèvent de la **Session 7**.
`--no-verify` reste donc nécessaire pendant toute la S5.

Avant **chaque** commit, rejouer les 3 gardes de sécurité manuellement — elles doivent **toutes**
sortir vides :

```bash
git diff --cached --name-only | grep -E '^\.env|credentials\.json|session/'
git diff --cached -S "PRIVATE KEY" -S "AKIA" -S "sk-" --name-only | grep -v '\.husky/pre-commit'
git diff --cached -S "eslint-disable" -S "@ts-ignore" -S "@ts-nocheck" -S "@ts-expect-error" \
  --name-only -- src/
git commit --no-verify -m "<message>"
```

Notes : `.git` est monté **en lecture seule** dans le sandbox → `git add`/`git commit` exigent une
escalade de permission. `.gitignore:30` ignore `.GCC/` alors que les `.GCC/*.md` sont suivis →
indexer un fichier GCC exige `git add -f .GCC/<fichier>`. Les gardes 2 et 3 remontent parfois
`.GCC/resume.md` ou ce plan : ce sont **les commandes citées ici même**, pas des secrets ; scoper
la garde 3 à `-- src/` évite le faux positif.

## ⚠️ § 7 — Mitigations & Edge Cases

- **Risque (élevé)** : `.at()` appliqué mécaniquement sur les 274 sites d'injection introduit des
  `TS18048: possibly 'undefined'` en masse (mesuré sur fichier sonde), et la tentation est alors
  d'ajouter `!` ou `as string` — ce qui viole l'invariant 2 et masque un vrai `undefined`.
  **Mitigation** : table de décision § 4.1, `tsc --noEmit` par blocs de 15-20 sites maximum sur
  `text-buffer.ts`. Commencer par les 87 sites « lecture avec repli », qui sont sans risque.
- **Risque (élevé)** : 2 200 lignes de logique de curseur Unicode sans aucun test.
  **Mitigation** : lot 0 obligatoire avant les lots 6 et 7. Un lot 0 escamoté rend toute la session
  invérifiable.
- **Risque (élevé)** : `react-hooks/exhaustive-deps` sur `text-buffer.ts` — ajouter `d` aux
  dépendances peut provoquer une boucle de rendu de la TUI. **Mitigation** : § 4.4, traitement en
  tout dernier (7.6), arrêt et remontée si plus de 3 sites résistent à la recette.
- **Risque (moyen)** : `max-lines-per-function` sur `VirtualizedList` (322 l.) et
  `useVimDeleteActions` (209 l.) impose de découper un composant/hook, donc de déplacer de l'état.
  **Mitigation** : traiter ces 2 cas en dernier dans leur lot, sur un fichier déjà à 0 par ailleurs,
  avec vérification runtime § 6.2. Si le découpage exige de changer une prop publique :
  **`refactoring_proposal_protocol`** — s'arrêter et proposer le périmètre à l'utilisateur.
- **Risque (moyen)** : réécrire une regex (`imagePathRegex`, placeholders de collage) change le
  comportement de détection de chemins d'images collés. **Mitigation** : test de non-régression
  écrit **avant** modification (7.3).
- **Risque (moyen)** : `Map` reconstruite dans une boucle de rendu = régression de performance
  invisible au linter, sur un hôte déjà contraint. **Mitigation** : interdiction explicite § 4.1 ;
  hisser la construction hors boucle.
- **Risque (faible)** : mémoire. `tsc --noEmit` sur ce projet prend ~30 s et pèse lourd ;
  `jest` davantage. **Mitigation** : `free -m` avant, commandes séquentielles, aucun watcher, arrêt
  de `npm run tui` immédiatement après contrôle.
- **Risque (procédural)** : les estimations de volume du plan maître se sont révélées fausses
  quatre fois (S3 : 340 vs ~300 ; S4 : 478 vs ~461 ; `providers/index.ts` : 1 vs 16 annoncé ;
  S5 : 588 vs ~550). **Mitigation** : mesurer avant chaque fichier (§ 6.1), ne jamais se fier aux
  chiffres écrits, y compris ceux de ce plan.

## 🧭 § 8 — Quand s'arrêter et demander

Interromps l'exécution et remonte la question à l'utilisateur si :

1. une correction exige de modifier `eslint.config.js`, `tsconfig.json`, `package.json` ou
   `jest.config.js` ;
2. une correction exige d'installer une dépendance (`ink-testing-library`, `@testing-library/*`…) ;
3. une correction exige de changer une **signature exportée** de `text-buffer.ts` ou une **prop
   publique** d'un composant ;
4. un test du lot 0 échoue **sur le code non modifié** (bug préexistant : le signaler, pas le
   corriger) ;
5. plus de 3 sites `exhaustive-deps` résistent à la recette § 4.4 ;
6. une règle `no-duplicated-branches` / `no-identical-expressions` révèle ce qui ressemble à un vrai
   bug logique ;
7. un cas d'injection ne rentre dans aucune ligne de la table § 4.1 ;
8. `npx tsc --noEmit` ne revient pas à 0 après deux tentatives de correction sur le même fichier —
   dans ce cas, `git stash` le fichier, remonte l'erreur brute, ne t'acharne pas.

## ✅ § 9 — Definition of Done

La Session 5 est close quand, et seulement quand, les 6 preuves suivantes sont collées dans ce
fichier :

1. `npx eslint src/tui/ui/hooks src/tui/ui/components/messages src/tui/ui/components/shared --max-warnings=0` → `EXIT=0`
2. `npx oxlint --deny-warnings <mêmes 3 chemins>` → `EXIT=0`
3. `npx prettier --check <mêmes 3 chemins>` → `EXIT=0`
4. `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0` (projet entier)
5. `grep -rnE "eslint-disable|@ts-ignore|@ts-nocheck|@ts-expect-error|as any" <mêmes 3 chemins>` → `GREP_EXIT=1`
6. `jest src/tests/unit/tui` → tous verts, **et** contrôle runtime § 6.2 effectué et décrit

Un état où 1 à 5 passent mais 6 est absent n'est **pas** une session close : c'est un état
statiquement propre au comportement non vérifié, et il doit être déclaré comme tel.
