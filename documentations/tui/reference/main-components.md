# Main UI Components — Reference

This document covers the UI components of the HIVE-MIND TUI located in `src/tui/ui/components/` and `src/tui/ui/`.

---

## Component Layout Structure

The layout is built with custom Ink containers mapping the terminal grid:

```
┌────────────────────────────────────────────────────────┐
│                      AppHeader                         │
├───────────────────────────┬────────────────────────────┤
│                           │                            │
│        MainContent        │         StatsDisplay       │
│        (Chat Logs)        │     (Services/Token usage) │
│                           │                            │
├───────────────────────────┴────────────────────────────┤
│                       StatusRow                        │
├────────────────────────────────────────────────────────┤
│                      InputPrompt                       │
└────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. AppContainer

Located in [AppContainer.tsx](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/AppContainer.tsx).

The orchestrator component. It loads configuration, manages active dialog flags, and draws the primary structural boxes of the terminal workspace.

#### Key Props

```typescript
interface AppContainerProps {
  config: HiveConfig;
  startupWarnings: string[];
  version: string;
  initializationResult: any;
  resumedSessionData?: any;
}
```

#### Managed Modal Flags

- `settingsVisible`: Config parameters overlay.
- `helpVisible`: Keyboard shortcuts helper box.
- `themeDialogVisible`: Neon theme switcher dialog.
- `confirmationQueueVisible`: Safety prompt confirmation.

---

### 2. InputPrompt

Located in [InputPrompt.tsx](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/InputPrompt.tsx).

Custom interactive text input. Built over `@jrichman/ink` elements, handling cursor moves, history scrolling, and keyword autocomplete popups.

#### Key Features

- **Auto-Suggestions**: Analyzes text starting with `/` or `@` to trigger dropdown overlays.
- **Multiline Handling**: Adapts prompt window height dynamically when shift+enter is typed.
- **Buffers**: Keeps a navigation stack of previous commands (up/down arrows).

---

### 3. StatusRow

Located in [StatusRow.tsx](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/StatusRow.tsx).

Horizontal dashboard bar showing real-time system metrics.

#### Visual Indicators

- **Connection Status**: Green indicator if WebSocket bridge is active.
- **Active Services**: Interactive toggles for `MAPLE` and `VIGIL`. Clicking a service displays diagnostic metrics in an overlay.
- **Context Window Indicator**: Displays saturation level as `[Context: X/Y (Z%)]`. Changes colors dynamically:
  - Green: < 50%
  - Yellow: 50% - 80%
  - Red: > 80% (saturation threshold triggering compression).

---

### 4. AskUserDialog

Located in [AskUserDialog.tsx](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/components/AskUserDialog.tsx).

Overlay intercept popup triggering human review (HITL) for high-risk actions.

#### Fields and Choices

- **Safety Violation Banner**: Shows details of intercepted permissions.
- **Option selectors**: Checkboxes to allow, reject, or allow with feedback parameters.
