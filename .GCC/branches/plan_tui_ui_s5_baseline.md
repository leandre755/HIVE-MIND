# Annexe S5 — Baseline ESLint exhaustive (mesurée le 2026-07-30)

Commande : `npx eslint src/tui/ui/hooks src/tui/ui/components/messages src/tui/ui/components/shared -f json`

**TOTAL : 588 problèmes = 258 erreurs + 330 warnings sur 57 fichiers.**

Chemins relatifs à `src/tui/ui/`. Les numéros de ligne valent pour l état de l arbre au commit `2261c6d` : ils se décalent dès la première édition d un fichier. Ne pas les utiliser comme adresses absolues, seulement comme inventaire à cocher. Re-mesurer par fichier avant de l attaquer.

## `components/shared/text-buffer.ts` — 205 (32 err / 173 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-object-injection` | 148 | 40, 82, 86, 91, 99, 99, 105, 122, 128, 130, 135, 144, 144, 153, 158, 160, 161, 161, 161, 168, 169, 181, 184, 189, 190, 198, 199, 201, 207, 217, 218, 218, 240, 241, 247, 264, 271, 285, 293, 298, 299, 361, 374, 387, 419, 428, 459, 472, 485, 517, 526, 558, 570, 587, 595, 613, 660, 702, 716, 730, 756, 776, 781, 889, 1165, 1180, 1185, 1224, 1261, 1266, 1278, 1297, 1302, 1335, 1359, 1362, 1365, 1376, 1385, 1438, 1477, 1478, 1626, 1657, 1666, 1693, 1695, 1701, 1702, 1703, 1705, 1705, 1723, 1727, 1779, 1795, 1802, 1842, 1843, 1844, 1848, 1857, 1857, 1874, 1876, 1882, 1906, 1907, 1910, 1911, 1912, 1914, 1914, 1928, 1931, 1932, 1935, 1970, 1974, 1978, 2006, 2016, 2022, 2037, 2040, 2056, 2079, 2081, 2139, 2144, 2168, 2218, 2467, 2475, 3251, 3252, 3253, 3254, 3255, 3274, 3274, 3292, 3293, 3294, 3295, 3296, 3316, 3316 |
| `react-hooks/exhaustive-deps` | 18 | 2998, 3002, 3005, 3008, 3013, 3017, 3020, 3025, 3029, 3032, 3035, 3038, 3052, 3066, 3076, 3210, 3281, 3372 |
| `sonarjs/cognitive-complexity` | 11 | 76, 113, 175, 359, 457, 1048, 1164, 1761, 1819, 2099, 3129 |
| `sonarjs/single-char-in-character-classes` | 6 | 60, 61, 62, 63, 64, 65 |
| `security/detect-non-literal-fs-filename` | 4 | 3339, 3349, 3362, 3367 |
| `sonarjs/no-unused-vars` | 3 | 984, 1708, 1917 |
| `sonarjs/no-redundant-assignments` | 2 | 758, 759 |
| `security/detect-non-literal-regexp` | 2 | 855, 1447 |
| `sonarjs/no-dead-store` | 2 | 1871, 1887 |
| `@typescript-eslint/no-explicit-any` | 2 | 2394, 3495 |
| `security/detect-unsafe-regex` | 1 | 33 |
| `sonarjs/no-nested-conditional` | 1 | 671 |
| `sonarjs/super-linear-regex` | 1 | 800 |
| `sonarjs/duplicates-in-character-class` | 1 | 800 |
| `no-shadow` | 1 | 2454 |
| `max-lines-per-function` | 1 | 2498 |
| `sonarjs/use-type-alias` | 1 | 3022 |

## `components/shared/vim-buffer-actions.ts` — 39 (4 err / 35 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-object-injection` | 35 | 107, 143, 149, 154, 157, 186, 225, 309, 388, 391, 462, 514, 540, 553, 565, 588, 656, 681, 700, 706, 709, 714, 721, 746, 762, 786, 790, 804, 807, 878, 969, 1008, 1024, 1169, 1183 |
| `sonarjs/cognitive-complexity` | 2 | 94, 276 |
| `@typescript-eslint/no-unused-vars` | 1 | 2 |
| `sonarjs/unused-import` | 1 | 2 |

## `hooks/useToolScheduler.ts` — 26 (18 err / 8 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 9 | 85, 108, 115, 127, 130, 185, 189, 202, 316 |
| `security/detect-object-injection` | 8 | 146, 198, 204, 253, 268, 289, 290, 292 |
| `sonarjs/no-nested-functions` | 3 | 147, 157, 202 |
| `@typescript-eslint/no-unused-vars` | 2 | 8, 10 |
| `sonarjs/unused-import` | 2 | 8, 10 |
| `sonarjs/cognitive-complexity` | 1 | 47 |
| `sonarjs/no-nested-conditional` | 1 | 191 |

## `components/shared/VirtualizedList.tsx` — 22 (5 err / 17 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-object-injection` | 15 | 126, 141, 223, 269, 270, 333, 368, 490, 546, 565, 581, 582, 625, 629, 690 |
| `sonarjs/cognitive-complexity` | 2 | 249, 384 |
| `react-hooks/exhaustive-deps` | 2 | 693, 813 |
| `sonarjs/no-all-duplicated-branches` | 1 | 369 |
| `no-shadow` | 1 | 513 |
| `max-lines-per-function` | 1 | 638 |

## `hooks/vim.ts` — 19 (8 err / 11 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-object-injection` | 10 | 203, 214, 278, 301, 318, 431, 971, 994, 1028, 1028 |
| `sonarjs/cognitive-complexity` | 4 | 367, 484, 613, 1039 |
| `sonarjs/use-type-alias` | 1 | 99 |
| `sonarjs/no-duplicated-branches` | 1 | 170 |
| `sonarjs/prefer-single-boolean-return` | 1 | 830 |
| `max-lines-per-function` | 1 | 840 |
| `react-hooks/exhaustive-deps` | 1 | 1091 |

## `hooks/slashCommandProcessor.ts` — 18 (18 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 10 | 328, 328, 342, 388, 393, 543, 543, 576, 580, 582 |
| `no-shadow` | 4 | 316, 317, 318, 319 |
| `no-duplicate-imports` | 1 | 33 |
| `sonarjs/cognitive-complexity` | 1 | 307 |
| `sonarjs/no-nested-template-literals` | 1 | 368 |
| `max-lines-per-function` | 1 | 441 |

## `components/messages/ToolConfirmationMessage.tsx` — 15 (15 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 7 | 64, 65, 559, 569, 587, 843, 851 |
| `@typescript-eslint/no-unused-vars` | 2 | 17, 31 |
| `sonarjs/unused-import` | 2 | 17, 31 |
| `sonarjs/cognitive-complexity` | 1 | 346 |
| `sonarjs/no-duplicated-branches` | 1 | 436 |
| `no-shadow` | 1 | 701 |
| `max-lines-per-function` | 1 | 772 |

## `hooks/useAtCompletion.ts` — 15 (15 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 13 | 115, 115, 136, 136, 160, 184, 210, 214, 249, 250, 267, 270, 366 |
| `sonarjs/no-identical-expressions` | 1 | 322 |
| `sonarjs/no-nested-functions` | 1 | 372 |

## `hooks/useCommandCompletion.tsx` — 15 (2 err / 13 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-object-injection` | 13 | 110, 116, 117, 152, 165, 168, 175, 177, 239, 278, 282, 379, 489 |
| `sonarjs/cognitive-complexity` | 1 | 146 |
| `max-lines-per-function` | 1 | 310 |

## `hooks/useShellCompletion.ts` — 15 (3 err / 12 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-object-injection` | 10 | 59, 59, 68, 80, 81, 91, 92, 96, 133, 151 |
| `sonarjs/cognitive-complexity` | 3 | 53, 294, 490 |
| `security/detect-non-literal-fs-filename` | 2 | 242, 329 |

## `hooks/useSessionResume.ts` — 13 (13 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 7 | 45, 45, 45, 61, 64, 84, 88 |
| `@typescript-eslint/no-unused-vars` | 3 | 4, 5, 7 |
| `sonarjs/unused-import` | 3 | 4, 5, 7 |

## `hooks/useAgentStream.ts` — 12 (12 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 4 | 173, 174, 175, 176 |
| `sonarjs/no-unused-vars` | 2 | 418, 420 |
| `@typescript-eslint/no-unused-vars` | 1 | 21 |
| `sonarjs/unused-import` | 1 | 21 |
| `complexity` | 1 | 42 |
| `sonarjs/cognitive-complexity` | 1 | 42 |
| `sonarjs/no-nested-conditional` | 1 | 135 |
| `max-lines-per-function` | 1 | 395 |

## `components/messages/DenseToolMessage.tsx` — 11 (11 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 9 | 69, 147, 173, 179, 189, 362, 364, 372, 409 |
| `@typescript-eslint/no-unused-vars` | 1 | 14 |
| `sonarjs/unused-import` | 1 | 14 |

## `hooks/atCommandProcessor.ts` — 11 (6 err / 5 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-non-literal-fs-filename` | 3 | 21, 60, 94 |
| `security/detect-object-injection` | 2 | 125, 405 |
| `sonarjs/no-nested-conditional` | 2 | 327, 332 |
| `@typescript-eslint/no-explicit-any` | 2 | 370, 455 |
| `sonarjs/cognitive-complexity` | 1 | 291 |
| `no-shadow` | 1 | 685 |

## `hooks/useSelectionList.ts` — 11 (3 err / 8 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-object-injection` | 8 | 105, 136, 136, 148, 237, 237, 237, 237 |
| `sonarjs/cognitive-complexity` | 2 | 83, 363 |
| `sonarjs/concise-regex` | 1 | 365 |

## `components/messages/DiffRenderer.tsx` — 10 (9 err / 1 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/no-nested-conditional` | 4 | 329, 331, 339, 341 |
| `sonarjs/no-dead-store` | 2 | 28, 298 |
| `sonarjs/super-linear-regex` | 1 | 23 |
| `sonarjs/cognitive-complexity` | 1 | 267 |
| `sonarjs/no-redundant-assignments` | 1 | 318 |
| `security/detect-object-injection` | 1 | 395 |

## `hooks/useSlashCompletion.ts` — 10 (6 err / 4 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/no-nested-functions` | 3 | 229, 495, 536 |
| `sonarjs/cognitive-complexity` | 2 | 122, 254 |
| `security/detect-object-injection` | 2 | 230, 231 |
| `react-hooks/exhaustive-deps` | 2 | 575, 599 |
| `@typescript-eslint/no-unused-vars` | 1 | 8 |

## `components/messages/ToolResultDisplay.tsx` — 7 (5 err / 2 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/cognitive-complexity` | 2 | 40, 146 |
| `@typescript-eslint/no-explicit-any` | 2 | 81, 88 |
| `import-x/no-named-as-default-member` | 2 | 159, 161 |
| `sonarjs/use-type-alias` | 1 | 26 |

## `components/shared/BaseSettingsDialog.tsx` — 7 (6 err / 1 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/no-nested-conditional` | 2 | 360, 512 |
| `no-shadow` | 1 | 199 |
| `sonarjs/concise-regex` | 1 | 226 |
| `sonarjs/no-redundant-jump` | 1 | 295 |
| `sonarjs/cognitive-complexity` | 1 | 310 |
| `security/detect-object-injection` | 1 | 675 |

## `components/messages/ToolShared.tsx` — 6 (5 err / 1 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/no-nested-conditional` | 2 | 84, 138 |
| `@typescript-eslint/no-unused-vars` | 1 | 7 |
| `sonarjs/unused-import` | 1 | 7 |
| `@typescript-eslint/no-explicit-any` | 1 | 75 |
| `import-x/no-named-as-default-member` | 1 | 194 |

## `hooks/useShellHistory.ts` — 6 (1 err / 5 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-non-literal-fs-filename` | 3 | 26, 55, 56 |
| `security/detect-object-injection` | 2 | 104, 116 |
| `sonarjs/super-linear-regex` | 1 | 34 |

## `hooks/useSnowfall.ts` — 6 (6 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/pseudo-random` | 4 | 110, 112, 115, 117 |
| `sonarjs/no-nested-functions` | 2 | 102, 103 |

## `components/messages/ShellToolMessage.tsx` — 5 (0 err / 5 warn)

| règle | n | lignes |
|---|---|---|
| `import-x/no-named-as-default-member` | 5 | 88, 107, 109, 120, 121 |

## `components/messages/SubagentGroupDisplay.tsx` — 5 (5 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 3 | 24, 170, 229 |
| `sonarjs/cognitive-complexity` | 2 | 24, 141 |

## `components/messages/ToolGroupMessage.tsx` — 5 (3 err / 2 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-object-injection` | 2 | 103, 354 |
| `sonarjs/no-nested-conditional` | 2 | 245, 249 |
| `sonarjs/cognitive-complexity` | 1 | 109 |

## `components/messages/ToolGroupDisplay.tsx` — 4 (4 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/no-nested-conditional` | 2 | 62, 87 |
| `sonarjs/cognitive-complexity` | 1 | 22 |
| `@typescript-eslint/no-explicit-any` | 1 | 214 |

## `hooks/useApprovalModeIndicator.ts` — 4 (4 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 3 | 46, 47, 83 |
| `sonarjs/cognitive-complexity` | 1 | 37 |

## `hooks/useConsoleMessages.ts` — 4 (3 err / 1 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/pseudo-random` | 2 | 131, 152 |
| `@typescript-eslint/no-explicit-any` | 1 | 112 |
| `security/detect-object-injection` | 1 | 128 |

## `hooks/useGitBranchName.ts` — 4 (3 err / 1 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 2 | 12, 19 |
| `security/detect-non-literal-fs-filename` | 1 | 46 |
| `sonarjs/no-nested-functions` | 1 | 53 |

## `hooks/useInputHistoryStore.ts` — 4 (2 err / 2 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/no-unused-vars` | 2 | 20, 21 |
| `security/detect-object-injection` | 2 | 37, 38 |

## `hooks/useMcpStatus.ts` — 4 (4 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 4 | 7, 9, 13, 18 |

## `components/messages/SubagentProgressDisplay.tsx` — 3 (3 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/no-nested-conditional` | 2 | 106, 108 |
| `sonarjs/cognitive-complexity` | 1 | 16 |

## `components/messages/Todo.tsx` — 3 (2 err / 1 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 2 | 23, 34 |
| `security/detect-object-injection` | 1 | 14 |

## `components/messages/TopicMessage.tsx` — 3 (0 err / 3 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-object-injection` | 3 | 45, 48, 51 |

## `components/shared/MaxSizedBox.tsx` — 3 (3 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/no-nested-conditional` | 2 | 122, 141 |
| `sonarjs/cognitive-complexity` | 1 | 36 |

## `components/shared/SearchableList.tsx` — 3 (0 err / 3 warn)

| règle | n | lignes |
|---|---|---|
| `import-x/no-named-as-default-member` | 3 | 110, 132, 133 |

## `hooks/useFlickerDetector.ts` — 3 (3 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-unused-vars` | 1 | 18 |
| `sonarjs/no-unused-vars` | 1 | 18 |
| `sonarjs/no-dead-store` | 1 | 18 |

## `hooks/useLoadingIndicator.ts` — 3 (3 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/no-nested-conditional` | 2 | 80, 81 |
| `sonarjs/no-duplicated-branches` | 1 | 64 |

## `hooks/usePhraseCycler.ts` — 3 (2 err / 1 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/pseudo-random` | 2 | 100, 135 |
| `react-hooks/exhaustive-deps` | 1 | 159 |

## `hooks/useStateAndRef.ts` — 3 (0 err / 3 warn)

| règle | n | lignes |
|---|---|---|
| `import-x/no-named-as-default-member` | 3 | 12, 13, 15 |

## `components/shared/ExpandableText.tsx` — 2 (1 err / 1 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/cognitive-complexity` | 1 | 25 |
| `import-x/no-named-as-default-member` | 1 | 126 |

## `hooks/useBanner.ts` — 2 (0 err / 2 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-object-injection` | 2 | 30, 45 |

## `hooks/useHookDisplayState.ts` — 2 (2 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 1 | 21 |
| `sonarjs/no-nested-functions` | 1 | 60 |

## `hooks/useInputHistory.ts` — 2 (0 err / 2 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-object-injection` | 2 | 59, 68 |

## `hooks/useReverseSearchCompletion.tsx` — 2 (0 err / 2 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-object-injection` | 2 | 68, 125 |

## `hooks/useSettingsNavigation.ts` — 2 (0 err / 2 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-object-injection` | 2 | 46, 58 |

## `components/messages/SubagentHistoryMessage.tsx` — 1 (1 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 1 | 21 |

## `components/messages/ThinkingMessage.tsx` — 1 (1 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 1 | 17 |

## `components/shared/EnumSelector.tsx` — 1 (0 err / 1 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-object-injection` | 1 | 51 |

## `components/shared/SlicingMaxSizedBox.tsx` — 1 (1 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/cognitive-complexity` | 1 | 27 |

## `hooks/shell-completions/npmProvider.ts` — 1 (0 err / 1 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-non-literal-fs-filename` | 1 | 34 |

## `hooks/shellReducer.ts` — 1 (1 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/cognitive-complexity` | 1 | 46 |

## `hooks/useAnimatedScrollbar.ts` — 1 (1 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/no-nested-functions` | 1 | 74 |

## `hooks/useEditorSettings.ts` — 1 (1 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/no-nested-template-literals` | 1 | 45 |

## `hooks/useSessionBrowser.ts` — 1 (1 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 1 | 75 |

## `hooks/useTabbedNavigation.ts` — 1 (1 err / 0 warn)

| règle | n | lignes |
|---|---|---|
| `sonarjs/cognitive-complexity` | 1 | 63 |

## `hooks/useThemeCommand.ts` — 1 (0 err / 1 warn)

| règle | n | lignes |
|---|---|---|
| `security/detect-object-injection` | 1 | 82 |
