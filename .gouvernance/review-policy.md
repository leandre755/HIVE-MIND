# AI Code Review Policy

## Golden Rule of AI Review

> **An AI coding agent must NEVER approve its own code.**
> All changes must be reviewed by an independent AI engine, dedicated reviewer sub-agent, or human maintainer.

---

## 1. Operational Review Mode (Active: Strict Review)

### Mode: Strict Review (Dual-Layer Defense)
- **Active Mode**: Enforced across all branches and pull requests.
- **Workflow**:
  1. **Layer 1 (Local Pre-Delivery)**: Run local test suite and local reviewer agent (`greptile review` / reviewer sub-agent). Fix all local findings in a single batch before committing.
  2. **Layer 2 (Cloud PR Review)**: Push dedicated branch and open PR using `PULL_REQUEST_TEMPLATE.md`.
  3. **Mandatory Full-Text Reading**: Read 100% of full-text comments from review bots (CodeRabbit, Greptile, Codex). Never rely solely on green CI checkmarks.
  4. **Thread Resolution**: Address and resolve 100% of review threads with follow-up commits.
  5. **Human Maintainer Sign-Off**: The human maintainer conducts final approval and performs the merge.

---

### Mode Reference: Light Review (Inactive)
- *Light Review mode is disabled in favor of strict two-layer review policy.*

---

## 2. Review Quality Gate & Acceptance Criteria

Before declaring a review complete, verify:
- [ ] Code was reviewed by an entity distinct from the authoring agent.
- [ ] 0 blocking issues or critical defects remain unaddressed.
- [ ] Tests cover newly introduced logic and regression cases.
- [ ] No secrets, tokens, or private environment variables are committed.
- [ ] Full review feedback is documented in the commit/PR body.
