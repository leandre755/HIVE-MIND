# GitHub Repository Governance

How the HIVE-MIND repository is managed on GitHub: automation workflows, issue lifecycle, pull request rules, releases, and dependency management. This file is the human-and-agent-readable map of `.github/`; the YAML files are the enforcement.

---

## 1. Automation Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| **CI** (`ci.yml`) | Every PR + push to `main` | Runs the full validation pipeline (install, type check, lint, tests). Concurrency: superseded runs are cancelled on non-main refs. |
| **Pull request governance** (`governance.yml`) | PR opened / edited / synchronize / reopened / ready_for_review | Enforces PR title Conventional Commits format, validates every commit message, computes changed-line size of code (fail > 2500, warning > 1000, .md/.txt/.pdf excluded), and posts a governance summary comment on the PR. |
| **Dependency review** (`security.yml`) | PRs that touch the lockfile | GitHub dependency review: blocks PRs introducing vulnerable or high-severity transitive dependencies. |
| **Issue triage** (`issue-triage.yml`) | Issue opened / reopened / edited | Classifies the issue and upserts a bounded triage result (labels such as `needs-triage` → typed/priority labels) so nothing stays unqualified. |
| **Issue detection — ANTIBUG** (`issue-detection.yml`) | Daily cron `23 4 * * *` UTC | Forensic defect audit: resolves the incremental scope from the previous audit marker, runs the ANTIBUG agent backend, files evidence-backed issues (provable defects only), records a marker for the next run. |
| **Release** (`release.yml`) | Push to `main` + manual dispatch | semantic-release: dry-run validation of configuration, then publishes the release. Versions are derived from Conventional Commits — never hand-edited. |
| **Workflow hygiene** (`workflow-hygiene.yml`) | Push + weekly cron (Mon 03:17 UTC) | Runs `.github/scripts/verify_workflows.py` to guarantee workflow YAML integrity, pinned actions, and no orphaned job definitions. |

---

## 2. Issue Lifecycle

### Formatting (mandatory)

Blank issues are **disabled** (`config.yml`). Every issue must use a template:

| Template | Title prefix | Auto labels |
|---|---|---|
| `bug.md` | `[BUG] …` | `bug`, `needs-triage` |
| `feature.md` | `[FEATURE] …` | `enhancement`, `needs-triage` |
| `documentation.md` | `[DOC] …` | `documentation`, `needs-triage` |

A valid issue contains: clear description, reproduction steps (bugs) or motivation/acceptance criteria (features), expected vs actual behavior, and environment details when relevant.

### Triage flow

1. Issue created → auto-labeled `needs-triage` by the template.
2. `issue-triage.yml` classifies it and upserts bounded triage labels.
3. Maintainers refine priority; security reports go through the **private advisory** channel (see [`SECURITY.md`](../SECURITY.md)), never public issues.

### Agent-created issues

Autonomous agents may only file issues as the result of the scheduled ANTIBUG audit (evidence-backed, deduplicated against open issues). Ad-hoc issue creation by agents is not authorized.

---

## 3. Pull Request Rules

- **Delivery mode**: all non-trivial changes ship by PR only — see `AGENTS.md` §4 (Strict Review).
- **Title & commits**: Conventional Commits (`type(scope): description`), enforced by `governance.yml` on title and every commit.
- **Size budget**: ≤ 1000 changed lines of code recommended, 2500 hard limit (governance check fails above, .md/.txt/.pdf excluded).
- **Template**: `.github/PULL_REQUEST_TEMPLATE.md` — root cause / summary / tests / risks.
- **Required reviews**: independent AI review bots (CodeRabbit, Greptile, Codex) + CI checks. Agents must read 100% of full-text bot comments and resolve 100% of threads.
- **Merge authority**: human maintainers only. Agents never merge.
- **Protected paths** (any change needs explicit maintainer review): `AGENTS.md`, `CLAUDE.md`, `.gouvernance/**`, `.github/workflows/**`, `.github/scripts/**`, `.githooks/**`, `.GCC/PROTOCOL.md`, `CODEOWNERS`, `LICENSE`.

---

## 4. Releases

- Driven by **semantic-release** on push to `main` (`release.yml`); version bumps derive from Conventional Commits (`feat` → minor, `fix` → patch, `BREAKING CHANGE` → major).
- No manual version edits, no manual tags by agents (`git tag` is denied).
- Publishing steps (`gh release`, `npm publish`) are human-only operations.

---

## 5. Dependency Management

- **Dependabot** (`.github/dependabot.yml`) proposes grouped dependency updates; PRs are subject to the same governance and Strict Review rules.
- **Dependency review** (`security.yml`) gates every lockfile change against the advisory database.
- New runtime dependencies require a logged decision in `.GCC/main.md` (GCC Protocol C) and maintainer approval.

---

## 6. Related Governance Files

| Topic | File |
|---|---|
| Accompanied agent rights matrix (active default) | [`accompanied-agent.md`](./accompanied-agent.md) |
| Autonomous agent policy (isolated runners only) | [`autonomous-agent.md`](./autonomous-agent.md) |
| AI code review policy (Strict Review active) | [`review-policy.md`](./review-policy.md) |
| Vulnerability reporting | [`SECURITY.md`](../SECURITY.md) |
| PR template | [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md) |
| Issue templates | [`.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE/) |
