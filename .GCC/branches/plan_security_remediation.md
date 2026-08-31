# Execution Plan: Resolution of all `eslint-plugin-security` Warnings & Errors

## 📋 Target Invariant & Pre-requisites
- **Target Invariant**:
  - `npx eslint src/ | grep security/` -> 0 warnings/errors.
  - `npx tsc --noEmit` -> Exit code 0 (0 TS errors).
  - 0 suppression comments (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`) added.
  - Unit tests 100% passing (`npm run test:unit -- --maxWorkers=3`).
- **Pre-requisites**:
  - RAM check: `free -m` (available RAM >= 2 GB).
  - Test sequencing check: `ps aux | grep jest` (no running Jest instance).
  - Active cleanup of residual node/jest processes.

## 🛠️ Step-by-Step Sequence

### Step 1: Milestone 1 — Core Services, Utils, Config & Domain
- [x] **Action**: Refactor `security/*` findings in `src/services/`, `src/utils/`, `src/config/`, `src/domain/`.
- [x] **Verify**: `npx tsc --noEmit && npm run test:unit -- --maxWorkers=3`
- **Verification Proof**:
```text
ESLint security/*: 0 warnings
tsc --noEmit: Exit code 0
Tests: 58 passed, 58 total (393 passed)
```

### Step 2: Milestone 2 — TUI Core, Contexts, State & Custom Hooks
- [x] **Action**: Refactor `security/*` findings in `src/tui/core/`, `src/tui/config/`, `src/tui/ui/contexts/`, `src/tui/ui/hooks/`.
- [x] **Verify**: `npx tsc --noEmit && npm run test:unit -- --maxWorkers=3`
- **Verification Proof**:
```text
ESLint security/*: 0 warnings
tsc --noEmit: Exit code 0
Tests: 58 passed, 58 total (393 passed)
```

### Step 3: Milestone 3 — TUI Utils & Shared UI Components
- [x] **Action**: Refactor `security/*` findings in `src/tui/utils/`, `src/tui/ui/utils/`, `src/tui/ui/components/shared/`.
- [x] **Verify**: `npx tsc --noEmit && npm run test:unit -- --maxWorkers=3`
- **Verification Proof**:
```text
ESLint security/*: 0 warnings
tsc --noEmit: Exit code 0
Tests: 58 passed, 58 total (393 passed)
```

### Step 4: Milestone 4 — TUI Messages, Views & App Shell
- [x] **Action**: Refactor `security/*` findings in `src/tui/ui/components/messages/`, `src/tui/ui/components/*.tsx`, `src/tui/AppContainer.tsx`.
- [x] **Verify**: `npx tsc --noEmit && npm run test:unit -- --maxWorkers=3`
- **Verification Proof**:
```text
ESLint security/*: 0 warnings
tsc --noEmit: Exit code 0
Tests: 58 passed, 58 total (393 passed)
```

### Step 5: Milestone 5 — Global Quality Gate & Forensic Audit
- [x] **Action**: Run final static analysis, unit test suite, and forensic audit.
- [x] **Verify**: `npx eslint src/ | grep security/` (0 output), `npx tsc --noEmit` (0 errors), `npm run test:unit -- --maxWorkers=3` (100% pass), 0 suppressions.
- **Verification Proof**:
```text
Global security warnings count: 0
tsc --noEmit: Exit code 0 (0 TS errors)
Test Suites: 58 passed, 58 total (393/393 tests passed)
0 suppression comments added.
```

## ⚠️ Mitigations & Edge Cases
- **Risk**: Dynamic object keys in legacy utilities causing prototype pollution or unexpected type coercion.
- **Mitigation**: Use explicit `Object.hasOwn(obj, key)` property checks or `Map<K, V>` instances to preserve runtime behavior while satisfying `eslint-plugin-security`.
- **Risk**: Non-literal fs filenames failing security linting when resolving user-provided relative paths.
- **Mitigation**: Resolve canonical paths using `path.resolve` or validate containment against allowed root directories before filesystem API calls.
