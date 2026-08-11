# React Contexts and Custom Hooks — Reference

This document covers the specifications of the React Contexts and Custom Hooks that manage the state and event loop of the HIVE-MIND TUI.

---

## 🧩 Contexts Reference

Contexts are located in `src/tui/ui/contexts/`. They act as the state store for the React tree.

### 1. UIStateContext

Located in [UIStateContext.tsx](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/contexts/UIStateContext.tsx).

This context maintains the visual state variables of the console.

#### UIStateContextType Properties

| Property          | Type                                 | Description                                                  |
| ----------------- | ------------------------------------ | ------------------------------------------------------------ |
| `consoleMessages` | `ConsoleMessageItem[]`               | Array of logs rendered in the main console area.             |
| `agentStatus`     | `'thinking' \| 'idle' \| 'paused'`   | Current state of the backend agent.                          |
| `activeServices`  | `string[]`                           | List of active background processes (e.g. `MAPLE`, `VIGIL`). |
| `activeSessionId` | `string`                             | The current session's uuid.                                  |
| `contextWindow`   | `{ current: number, limit: number }` | Token usage measurements of the active model.                |

---

### 2. KeypressContext

Located in [KeypressContext.tsx](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/contexts/KeypressContext.tsx).

Translates low-level terminal key escape sequences into actionable app event triggers.

#### Keyboard Shortcut Bindings

| Key Combination | Action                      | Focus Mode |
| --------------- | --------------------------- | ---------- |
| `Ctrl + C`      | Force Quit Client           | Any        |
| `Esc`           | Return to Normal mode       | Insert     |
| `i`             | Enter Input Prompt mode     | Normal     |
| `Tab`           | Switch Active Tabs / Panels | Normal     |
| `:`             | Open Command mode overlay   | Normal     |

---

## 🎣 Custom Hooks Reference

Hooks are located in `src/tui/ui/hooks/`. They decouple procedural logic from view files.

### 1. useExecutionLifecycle

Located in [useExecutionLifecycle.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/hooks/useExecutionLifecycle.ts).

Manages the transaction-level states during prompt processing:

- Transitions from `idle` to `thinking`.
- Directs tool confirmation loops (HITL intercept).
- Resolves execution pauses.

```typescript
export function useExecutionLifecycle(): {
  isExecuting: boolean;
  currentTool: string | null;
  requestConfirmation: (req: ConfirmationRequest) => Promise<boolean>;
};
```

---

### 2. useAgentStream

Located in [useAgentStream.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/hooks/useAgentStream.ts).

Hooks into the incoming WebSocket text chunk stream, buffering the output to avoid UI render flickering while generating markdown text.

```typescript
export function useAgentStream(): {
  streamedText: string;
  isStreaming: boolean;
  clearStream: () => void;
};
```

---

### 3. useTerminalTheme

Located in [useTerminalTheme.ts](file:///home/omni/Code/HIVE-MIND-RAILWAY/src/tui/ui/hooks/useTerminalTheme.ts).

Resolves semantic colors dynamically based on the chosen palette.

```typescript
export function useTerminalTheme(): {
  theme: ThemePalette;
  themeName: string;
  setTheme: (themeId: string) => void;
};
```
