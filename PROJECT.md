# Project: HIVE-MIND TUI Extraction and Decoupling

## Architecture
- **HIVE-MIND Core**: Lightweight headless daemon. Runs WebSocket server via `TuiServerTransport` listening on dynamic port (default 5001), writes `tui-connection.json` with host, port, and auth token. Dispatches events and commands through `src/core/transport/tui/HiveTransport.ts`. Zero React/Ink dependencies.
- **Standalone TUI (`/home/omni/Code/HIVE-MIND-TUI`)**: Independent React 19 + Ink 6 interactive terminal application in its own git repository. Connects to HIVE-MIND Core daemon via `HiveCoreConnection` (WebSocket client) using `tui-connection.json`. Contains self-contained utilities (`safeFs.ts`, `errors.ts`), ambient type definitions, and a decoupled `providerStatus.ts` (static multi-family catalogue + environment key detection).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Relocate `HiveTransport.ts` | Move from `src/tui/transport/` to `src/core/transport/tui/HiveTransport.ts` with updated relative imports | M1 | survey 1, 3 |
| 2 | Update Core Transport Imports | Point `TuiServerTransport.ts`, `TransportManager.ts`, and `PermissionManager.ts` to `./tui/HiveTransport.js` | M1 | survey 1 |
| 3 | Core Transport Test Suite & Dynamic Port | Update `src/tests/integration/tui_websocket.test.ts` to import new path and dynamically resolve port from `tui-connection.json` | M1 | survey 1 |
| 4 | Initialize Standalone TUI Git Repo | Create and initialize git repo at `/home/omni/Code/HIVE-MIND-TUI` | M2 | survey 2 |
| 5 | Migrate TUI Source Code | Copy 372 files from `src/tui/` to `HIVE-MIND-TUI/src/` | M2 | survey 2 |
| 6 | Standalone TUI Configuration Files | Create `package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`, `README.md` in `HIVE-MIND-TUI` | M2 | survey 2 |
| 7 | Self-Contained TUI Utilities & Types | Implement standalone `safeFs.ts`, `errors.ts`, `tui-globals.d.ts`, `untyped-modules.d.ts` in `HIVE-MIND-TUI` | M2 | survey 2 |
| 8 | Decouple Backend Dependencies in TUI | Decouple `providerStatus.ts`, `ModelDialog.tsx`, `hiveConfig.ts`, `hiveCommands.ts`, `useToolScheduler.ts`, `useSessionBrowser.ts` from backend | M2 | survey 2 |
| 9 | Standalone TUI Connection Resolution | Support multi-path discovery of `tui-connection.json` (`HIVE_CONNECTION_PATH`, `HIVE_MIND_DIR`, `../HIVE-MIND/tui-connection.json`, `./tui-connection.json`) in `HiveCoreConnection` | M2 | survey 2, 3 |
| 10 | Standalone TUI Build & Lint Validation | Run `npm install`, `npx tsc --noEmit`, and `npx eslint src/` in `HIVE-MIND-TUI` with 0 errors and 0 warnings | M2 | survey 2 |
| 11 | Monorepo Package.json Pruning | Remove 17 React/Ink dependencies and devDependencies plus `tui` script from HIVE-MIND `package.json` | M3 | survey 3 |
| 12 | Monorepo Source Tree Pruning | Delete `src/tui/`, `src/core/transport/ink/`, `src/types/tui-globals.d.ts`, and `src/tests/unit/tui/` from HIVE-MIND | M3 | survey 3 |
| 13 | Monorepo Test Cleanup & Full Test Run | Remove stale ink mocks in `permissionManager.test.ts` and run full HIVE-MIND test suite | M3 | survey 3 |
| 14 | Cross-Process WebSocket E2E Verification | Start HIVE-MIND daemon, generate `tui-connection.json`, launch standalone TUI / test harness, verify auth, bidirectional events, and user message flow | M4 | survey 3 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Transport Decoupling & Server Isolation | Relocate `HiveTransport.ts`, update Core imports, verify `tui_websocket.test.ts` passes 100%, verify `grep -rn "src/tui" src/core/` is 0 | none | DONE |
| M2 | Standalone TUI Repository Construction | Initialize git repo at `/home/omni/Code/HIVE-MIND-TUI`, migrate TUI codebase, create configs, decouple `providerStatus.ts` and all backend imports, verify `tsc` and `eslint` clean | M1 | DONE |
| M3 | Monorepo Pruning & Dependency Cleanup | Prune React/Ink packages from `package.json`, delete `src/tui/`, dead ink files, run `npm install`, verify `tsc` clean, run full `npm test` without regressions | M2 | DONE |
| M4 | Cross-Process WebSocket Verification & E2E Validation | Run end-to-end integration tests between HIVE-MIND daemon and Standalone TUI, verifying connection, handshake, event streaming, and user interaction | M3 | IN_PROGRESS |

## Interface Contracts
### HIVE-MIND Core Daemon ↔ Standalone TUI
- **Connection Handshake**:
  - File: `tui-connection.json` written to `process.cwd()` (or resolved via env `HIVE_CONNECTION_PATH`).
  - Format:
    ```json
    {
      "host": "127.0.0.1",
      "port": 5001,
      "token": "<uuid-v4>"
    }
    ```
  - WebSocket URL: `ws://127.0.0.1:<port>`
  - Client auth payload sent upon open:
    ```json
    {
      "type": "auth",
      "token": "<uuid-v4>"
    }
    ```
  - Server accepts connection or closes with code `4403` (invalid token) / `4401` (auth timeout 3s).
- **Bidirectional Event Protocol**:
  - Server -> Client:
    - `{ type: 'message', data: MessageData }`
    - `{ type: 'presence', status: PresencePayload }`
    - `{ type: 'confirmation_request', request: ConfirmationRequestPayload }`
    - `{ type: 'custom', event: string, payload: unknown }`
  - Client -> Server:
    - `{ type: 'user_message', text: string, options?: MessageOptions }`
    - `{ type: 'confirmation_response', id: string, approved: boolean }`

## Code Layout
### HIVE-MIND (`/home/omni/Code/HIVE-MIND`)
```
src/
├── core/
│   ├── transport/
│   │   ├── tui/
│   │   │   └── HiveTransport.ts   # Core TUI event transport singleton & payload types
│   │   ├── TuiServerTransport.ts  # WebSocket server managing tui-connection.json & auth
│   │   ├── TransportManager.ts    # Transport registry
│   │   └── interface.ts
│   ├── security/
│   │   └── PermissionManager.ts   # Security & HITL confirmation prompts
│   └── types/
│       └── BotTypes.ts
├── tests/
│   └── integration/
│       └── tui_websocket.test.ts  # WebSocket server integration test
```

### Standalone TUI (`/home/omni/Code/HIVE-MIND-TUI`)
```
/home/omni/Code/HIVE-MIND-TUI/
├── package.json
├── tsconfig.json
├── eslint.config.js
├── .gitignore
├── README.md
└── src/
    ├── index.tsx                  # Standalone TUI entry point
    ├── core/
    │   ├── connection.ts          # HiveCoreConnection client WebSocket
    │   └── initializer.ts
    ├── ui/
    │   ├── AppContainer.tsx
    │   ├── components/
    │   ├── views/
    │   ├── hooks/
    │   └── utils/
    │       └── providerStatus.ts  # Decoupled model status & key detection
    └── utils/
        ├── safeFs.ts              # Standalone safe filesystem wrapper
        └── errors.ts
```
