# Execution Plan: Cognitive Complexity Reduction in TUI UI

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**: Lower Cognitive Complexity <= 15 for all functions in `src/tui/ui/` without altering functional runtime behavior or creating external file splits (in-file refactoring).
- **Pre-requisites**: `npx eslint`, `npx tsc --noEmit`

## 🛠️ Step-by-Step Sequence

### Step 1: Utility functions refactoring (`src/tui/ui/utils/`)
- [x] **Action**: Refactor `clipboardUtils.ts`, `MarkdownDisplay.tsx`, `markdownParsingUtils.ts`, `mouse.ts`, `textUtils.ts` to extract private helper functions.
- [x] **Verify**: `npx eslint src/tui/ui/utils/ && npx tsc --noEmit`
- **Verification Proof**:
```text
✅ src/tui/ui/utils/ (clipboardUtils.ts, MarkdownDisplay.tsx, markdownParsingUtils.ts, mouse.ts, textUtils.ts) -> 0 cognitive-complexity errors
✅ tsc --noEmit -> Exit Code 0
```

### Step 2: Hook refactoring (`src/tui/ui/hooks/`)
- [x] **Action**: Refactor complex functions in hooks (`atCommandProcessor.ts`, `shellReducer.ts`, `slashCommandProcessor.ts`, `useAgentStream.ts`, `useApprovalModeIndicator.ts`, `useCommandCompletion.tsx`, `useSelectionList.ts`, `useShellCompletion.ts`, `useSlashCompletion.ts`, `useTabbedNavigation.ts`, `useToolScheduler.ts`, `vim.ts`).
- [x] **Verify**: `npx eslint src/tui/ui/hooks/ && npx tsc --noEmit`
- **Verification Proof**:
```text
✅ src/tui/ui/hooks/ (12 hook files refactored) -> 0 cognitive-complexity errors
```

### Step 3: Contexts & Shared Components refactoring (`src/tui/ui/contexts/`, `src/tui/ui/components/shared/`)
- [ ] **Action**: Refactor `BaseSettingsDialog.tsx`, `ExpandableText.tsx`, `MaxSizedBox.tsx`, `SlicingMaxSizedBox.tsx`, `VirtualizedList.tsx`, `text-buffer.ts`, `vim-buffer-actions.ts`, `KeypressContext.tsx`, `ScrollProvider.tsx`.
- [ ] **Verify**: `npx eslint src/tui/ui/contexts/ src/tui/ui/components/shared/ && npx tsc --noEmit`
- **Verification Proof**:

### Step 4: UI Components & AppContainer refactoring (`src/tui/ui/components/`, `src/tui/ui/AppContainer.tsx`)
- [ ] **Action**: Refactor `InputPrompt.tsx`, `AskUserDialog.tsx`, `BackgroundTaskDisplay.tsx`, `ColorsDisplay.tsx`, `SessionBrowser.tsx`, `ThemeDialog.tsx`, `ToastDisplay.tsx`, `DiffRenderer.tsx`, `SubagentGroupDisplay.tsx`, `ToolGroupDisplay.tsx`, `AppContainer.tsx`.
- [ ] **Verify**: `npx eslint src/tui/ui/ && npx tsc --noEmit`
- **Verification Proof**:

## ⚠️ Mitigations & Edge Cases
- **Risk**: Extracting sub-functions in React hooks might re-trigger renders if closures depend on un-memoized props/state.
- **Mitigation**: Pure helper functions are extracted outside the React component signature or defined as stateless internal utilities.
