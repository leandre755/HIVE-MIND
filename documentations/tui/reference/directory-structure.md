# src/tui/ Directory Structure — Reference

This document maps the directories and primary source files of the HIVE-MIND TUI component located in `src/tui/`.

## Directory Overview

| Directory    | Purpose                                                                                |
| ------------ | -------------------------------------------------------------------------------------- |
| `commands/`  | Defines custom CLI/TUI command registrations.                                          |
| `config/`    | Holds settings validation schemas, configurations, and footer mappings.                |
| `core/`      | Handles client connection logic and local TUI terminal initialization.                 |
| `services/`  | Regulates backend actions and commands routing.                                        |
| `transport/` | Defines file caching, media handling, and the WebSocket data bridge.                   |
| `ui/`        | Contains the React-Ink view layers (components, contexts, hooks, layouts, and themes). |
| `utils/`     | Houses common UI helpers and math functions.                                           |

---

## Key Core Files

### Root Files

- `src/tui/index.tsx`: Main entry point for the Ink renderer. Bootstraps the application wrappers, registers providers, and starts connection to the Core.
- `src/tui/deferred.ts`: Custom promise wrapper for handling deferred actions.

### `/core/` Files

- `src/tui/core/connection.ts`: Establishes the WebSocket connection with the Core. Handshakes using local JSON configurations. Exposes event listeners for state replication.
- `src/tui/core/theme.ts`: Base type definition for Ink-compliant custom color palettes.

### `/transport/` Files

- `src/tui/transport/HiveTransport.ts`: Decoupled communication interface representing TUI events sent/received on the HIVE-MIND core bus.
- `src/tui/transport/HiveFileService.ts`: Regulates media streaming and download logs via the TUI socket.

### `/config/` Files

- `src/tui/config/hiveConfig.ts`: Base TUI layout configs.
- `src/tui/config/settings.ts`: Local storage options manager. Reads from and writes settings to the user's workspace profile.
- `src/tui/config/hiveSettingsSchema.ts`: Zod schema validating general, voice, and proxy preferences.

---

## UI Architecture (`/ui/` Subdirectories)

### `/ui/contexts/`

Hosts the state contexts and providers for the React tree.

| Context File          | Managed State                                                 |
| --------------------- | ------------------------------------------------------------- |
| `UIStateContext.tsx`  | Core application values: history, messages, status variables. |
| `KeypressContext.tsx` | Binds hardware keystrokes to React action handlers.           |
| `SettingsContext.tsx` | Provides shared user preferences (`settings.ts`).             |
| `TerminalContext.tsx` | Measures active window size rows/columns dynamically.         |
| `VimModeContext.tsx`  | Governs text editor input mode toggle (Normal/Insert/Visual). |
| `OverflowContext.tsx` | Manages scrolling and output clipping thresholds.             |

### `/ui/hooks/`

Exposes React functional hooks processing events and keyboard triggers.

- `useExecutionLifecycle.ts`: Orchestrates tool invocations, prompts reflection loops, and safety confirmation checkpoints.
- `useAgentStream.ts`: Feeds chunks of LLM output directly into the chat view in real-time.
- `slashCommandProcessor.ts`: Evaluates and executes commands starting with `/`.
- `atCommandProcessor.ts`: Processes node/session referencing hooks starting with `@`.
- `vim.ts`: Implements Vim-like keyboard navigation (hjkl) inside text controls.

### `/ui/components/`

Holds Ink UI rendering components.

- `AppContainer.tsx`: Root component orchestrating the header, dashboard, body layout, and overlay modals.
- `InputPrompt.tsx`: Advanced text input area with autocomplete, multi-line, and history buffers.
- `StatusRow.tsx`: Displays connection status, active services (MAPLE, VIGIL), token usage gauge, and system health.
- `AskUserDialog.tsx`: Modal popups requesting human approval for execution permissions (HITL).
