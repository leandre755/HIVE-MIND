# Test Backlog

## Pending Test Scenarios

### Unit Tests
- [ ] Scenario: Initial unit test suite execution
  - Verification: Run unit test runner with coverage

### Integration & Quality Gates
- [x] Scenario: Pre-commit secret and formatting check
  - Verification: Attempt commit with staged files — ✅ 2026-09-23 : gate 8/8 × 9 commits (gitleaks 0 leak, oxlint 0/0, prettier OK, eslint 0 après fix des 3 erreurs, semgrep 0 finding)
- [x] Scenario: Pre-push full verification
  - Verification: Run full lint, typecheck, and test suite — ✅ 2026-09-23 : pre-push franchi sans contournement (gitleaks full history + npm run test:unit + npm audit + tsc + depcruise)

### Edge Cases & Regressions
- [ ] Scenario: Error handling and failure boundaries
  - Verification: Assert fail-fast behavior on invalid input
