# Policy: Accompanied Agent

## Scope and Boundary

This policy is the default choice for a developer working with an AI coding assistant in their IDE or terminal. The agent can explore the repository, edit files within the workspace, and execute permitted validation commands. Operations that modify Git history or open Pull Requests (as required by the strict review protocol) require **explicit human approval (`ask`)**, while irreversible actions (merging, publishing, modifying governance guardrails) remain strictly prohibited.

---

## Authorizations and Approvals

- **Direct Execution (`allow`)**: Read non-sensitive project source files, edit application code in the workspace, run documented formatting/linting/test/build commands, inspect `git status`, `git diff`, and `git log`.
- **Subject to Explicit Human Approval (`ask`)**:
  - Dedicated branch creation (`git checkout -b <type>/issue-<num>`).
  - Staging and committing (`git add`, `git commit` with Conventional Commits message).
  - Pushing the working branch (`git push origin <branch>`).
  - Opening a Pull Request (`gh pr create` with PR template).
  - Package installation (`npm install`, `pip install`, `composer install`).

---

## Mandatory Denials (`deny`)

The agent must never execute:
- Direct pushes to protected branches (`git push origin main`, `master`, tags).
- Control bypass flags: `--no-verify`, `--force`, `--force-with-lease`, `--skip-hooks`, `git reset --hard`, `git clean -fd`.
- Merging and destructive rebasing: `git merge`, `git rebase`, `gh pr merge`.
- Publishing and deployment: `gh release`, `npm publish`, `docker push`, cloud deployments.
- Elevated privilege commands: `sudo`, changing file ownership or access permissions.

After loading `AGENTS.md`, this active policy (`.gouvernance/accompanied-agent.md`), and project-specific instructions, the agent never reads or writes secrets, real `.env` files, private keys (`.pem`, `.key`), files outside the workspace, `.git/`, agent policies, `CODEOWNERS`, CI workflows, hooks, or setup scripts. It never modifies `AGENTS.md`, the `.gouvernance/` policies, or the bounded project instructions without explicit confirmation.

---

## Workflow by Selected Review Policy

1. **Initialization**: Verify workspace, read `AGENTS.md`, `.gouvernance/accompanied-agent.md`, and `.gouvernance/review-policy.md` (active mode: Strict Review).
2. **Light Review**:
   - Work on a local branch, make minimal changes, validate locally with tests and local AI review (`greptile review` / reviewer sub-agent), then propose the commit for human approval.
3. **Strict Review**:
   - Create a dedicated branch (with `ask` confirmation), implement changes, run local review, and batch all fixes.
   - Push the branch and open a PR (with `ask` confirmation).
   - Read 100% of full-text feedback from AI review bots (rejection of raw green checkmarks), resolve 100% of review threads with follow-up commits, and await human maintainer approval before merge.

---

## Incident Response

Stop immediately and request human guidance if a secret is encountered, a command attempts to leave the workspace, a critical quality check fails, the task touches a protected path, or an action may have irreversible external side effects. Never attempt workarounds or bypasses.
