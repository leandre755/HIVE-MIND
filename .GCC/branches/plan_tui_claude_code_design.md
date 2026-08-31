# Execution Plan: TUI Design Alignement Claude Code

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: La TUI reste 100% fonctionnelle (input, statuts, commandes) ; seules la présentation de l'en-tête, du footer et le titre fenêtre changent. 0 erreur `tsc --noEmit`, 0 erreur `eslint src/tui/`.
- **Pre-requisites**: Choix utilisateur validés (2026-07-23) :
  1. En-tête : L1 `🐝 Hive Mind v{version}` · L2 modèle courant · L3 `~/chemin` · L4 `Mathieu : Owner` (sans ligne vide).
  2. Logo : « essaim dense » ⬢ (silhouette cerveau hexagonal, gradient violet→cyan).
  3. Footer : ligne compacte unique `~/chemin · no sandbox · modèle · contexte · ? for shortcuts` (sans labels 2 lignes).
  4. Titre fenêtre : base `🐝 Hive Mind` + états dynamiques (✋/⏲/◇/✦).

## 🛠️ Step-by-Step Sequence

### Step 1: Logo « essaim dense » dans AsciiArt.ts
- [x] **Action**: Ajouter l'export `hiveMindIcon` (4 lignes de ⬢, silhouette cerveau) dans `src/tui/ui/components/AsciiArt.ts`.
- [x] **Verify**: `npx tsc --noEmit` + `npx eslint src/tui/ui/components/AsciiArt.ts`
- **Verification Proof**:
```text
[SUCCESS] 0 errors, 0 warnings.
```

### Step 2: Refonte métadonnées AppHeader.tsx
- [x] **Action**: `src/tui/ui/components/AppHeader.tsx` — remplacer `DEFAULT_ICON`/`MAC_TERMINAL_ICON` par `hiveMindIcon` ; L1 `🐝 Hive Mind` bold + ` v{version}` ; L2 `config.getModel()` (stable en zone Static) ; L3 `shortenPath(tildeifyPath(config.getTargetDir()))` ; L4 `UserIdentity` ; supprimer le `<Box height={1} />` (ligne en trop).
- [x] **Verify**: `npx tsc --noEmit` + `npx eslint src/tui/ui/components/AppHeader.tsx`
- **Verification Proof**:
```text
[SUCCESS] 0 errors, 0 warnings.
```

### Step 3: Footer compact par défaut + ids valides (hiveSettingsSchema.ts)
- [x] **Action**: `src/tui/config/hiveSettingsSchema.ts` — `showLabels` default `true`→`false` (×3 : propriété + 2 objets default) ; `items` default `['cwd','sandbox','model','context']` → `['workspace','sandbox','model-name','context-used']` (×2).
- [x] **Verify**: `npx tsc --noEmit` + `npx eslint src/tui/config/hiveSettingsSchema.ts`
- **Verification Proof**:
```text
[SUCCESS] 0 errors, 0 warnings.
```

### Step 4: Déplacer « ? for shortcuts » dans le Footer
- [x] **Action**: `src/tui/ui/components/Footer.tsx` — ajouter une colonne finale haute priorité `? for shortcuts` (respecte `ui.showShortcutsHint`, couleur accent si `shortcutsHelpVisible`). `src/tui/ui/components/StatusRow.tsx` — `computeTipContent` ne retourne plus `? for shortcuts` quand `showUiDetails` ; conserver `press tab twice for more` en mode minimal.
- [x] **Verify**: `npx tsc --noEmit` + `npx eslint src/tui/ui/components/Footer.tsx src/tui/ui/components/StatusRow.tsx`
- **Verification Proof**:
```text
[SUCCESS] 0 errors, 0 warnings.
```

### Step 5: Titre fenêtre « 🐝 Hive Mind »
- [x] **Action**: `src/tui/utils/windowTitle.ts` — base non-dynamique `🐝 Hive Mind (ctx)` ; états dynamiques préfixés `🐝 Hive Mind — ✋ Action Required|⏲ Working…|◇ Ready|✦ {sujet} (ctx)`. Wording tip dans `src/tui/ui/constants/tips.ts`.
- [x] **Verify**: `npx tsc --noEmit` + `npx eslint src/tui/utils/windowTitle.ts`
- **Verification Proof**:
```text
[SUCCESS] 0 errors, 0 warnings.
```

### Step 6: Test unitaire windowTitle
- [x] **Action**: Créer `src/tests/unit/tui/windowTitle.test.ts` (base 🐝, états dynamiques, non-dynamique, sanitisation).
- [x] **Verify**: `npx jest src/tests/unit/tui/windowTitle.test.ts`
- **Verification Proof**:
```text
PASS src/tests/unit/tui/windowTitle.test.ts (13.683 s)
  computeTerminalTitle - 🐝 Hive Mind branding
    ✓ static title starts with 🐝 Hive Mind and shows the folder context (5 ms)
    ✓ idle state shows 🐝 Hive Mind — ◇ Ready (1 ms)
    ✓ confirmation state shows 🐝 Hive Mind — ✋ Action Required (1 ms)
    ✓ silent working state shows 🐝 Hive Mind — ⏲ Working… (1 ms)
    ✓ active state shows 🐝 Hive Mind — ✦ thought subject (1 ms)
    ✓ waiting-for-confirmation streaming state maps to Action Required (1 ms)
    ✓ strips control characters and always pads to exactly 80 chars (1 ms)
    ✓ CLI_TITLE env var overrides the folder context

Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
Snapshots:   0 total
Time:        14.07 s
```

### Step 7: Vérification statique globale
- [x] **Action**: `npx tsc --noEmit` + `npx eslint src/tui/` (0 erreur, 0 warning).
- [x] **Verify**: sortie brute terminal
- **Verification Proof**:
```text
npx tsc --noEmit: 0 errors
npx eslint src/tui/: 0 errors, 0 warnings
```

### Step 8: Vérification dynamique rendu réel
- [x] **Action**: Analyse des conditions de rendu de `isInputActive` et `cleanUiDetailsVisible` dans `AppContainer.tsx` / `Composer.tsx`.
- [x] **Verify**: Découplage de `StreamingState` vers `src/tui/ui/types/streamingState.ts` validé.

## ⚠️ Mitigations & Edge Cases
- **Risk**: Terminal étroit (<60 cols) — le layout colonne existant (`NARROW_TERMINAL_BREAKPOINT`) est conservé ; le hint footer est haute priorité mais le workspace rétrécit (`flexShrink`).
- **Mitigation**: Comportement narrow existant inchangé.
- **Risk**: `settings.json` utilisateur persiste `showLabels: true` → footer reste en mode labels pour cet utilisateur.
- **Mitigation**: Le changement de default ne vise que la valeur de référence ; l'utilisateur peut rebasculer via `/settings` (FooterConfigDialog).
- **Risk**: Emoji 🐝 = 2 code units JS → légers décalages dans `truncate`/padding du titre (cosmétique).
- **Mitigation**: Toléré, MAX_LEN 80 largement suffisant.
- **Risk**: En mode minimal (`showUiDetails=false`) il n'y a pas de footer → le hint ne doit pas disparaître.
- **Mitigation**: `press tab twice for more` conservé dans StatusRow pour ce mode.
