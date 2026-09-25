## Summary

This PR introduces `src/persona/persona.md` as the Single Source of Truth (SSOT) for the agent's identity, completely removing the legacy `profile.json` and hardcoded mentions of "HIVE-MIND" in `botIdentity.ts` and `system.md`.
It includes a custom parser for the YAML frontmatter in `personaLoader.ts` and dynamically hydrates `system.md` with `{{AGENT_NAME}}` and `{{LANGUAGE_STYLE}}`.

## Validation

- [x] Appropriate tests were run locally.
- [x] Linting, formatting, and build are clean.
- [x] Documentation and migration notes updated if applicable.
- [x] Dependency modifications were reviewed.

## Automation Impact

- [x] This pull request does not modify `.github/workflows`, `.github/scripts`, `githooks`, `setup.sh`, or `setup.ps1`.
- [ ] If it modifies these paths, permission/secret implications are documented below and Code Owner review is required.

## 🤖 AI Code Review Summary

- [x] **AI Review Engine Used**: `Greptile / CodeRabbit`
- [x] **Active Policy**: `Strict (Local + Cloud PR)`
- [x] **Independence**: Code was reviewed by an engine/agent distinct from the author.
- [x] **Full-Text Review**: The full text of review feedback was read (no validation on raw green checkmarks).
- [ ] **0 Blocking Issues**: 100% of reported actionable findings were resolved or arbitrated.
- [ ] **Formal Approval / Score**: Pending Cloud CI

## Risks & Rollback Plan

No major risks identified. Rollback is a standard git revert if identity strings fail to load in edge cases.
