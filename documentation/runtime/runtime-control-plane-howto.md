# How-To: Configure VIGIL Safety Policies and FinOps Limits (SS-21)

## Goal

Learn how to restrict agent tool execution using `RuntimeSentinel`, enforce read-only filesystems via blueprints, and set budget limits for user sessions.

## 1. Enforcing Read-Only Filesystem in Agent Blueprint

To prevent an agent from executing write operations or modifying source files:

```typescript
import type { AgentBlueprint } from '../../src/core/blueprint/AgentBlueprint.js';
import { RuntimeSentinel } from '../../src/services/runtime/RuntimeInfrastructure.js';

const auditAgentBlueprint: AgentBlueprint = {
  metadata: {
    id: 'code-auditor',
    name: 'Read-Only Code Auditor',
    version: '1.0.0',
  },
  action_space: {
    allowed_tools: ['read_file', 'list_directory', 'ast_grep'],
  },
  constraints: {
    read_only_fs: true,
    max_budget_usd: 0.5,
    max_iterations: 8,
  },
  mindos: { drives: [] },
};

const sentinel = new RuntimeSentinel();
```

When `read_only_fs: true` is active, `RuntimeSentinel` intercepts any call to `edit_file`, `write_file`, or `delete_file` before execution:

```typescript
const result = await sentinel.evaluate(
  { function: { name: 'edit_file', arguments: '{"path":"main.ts"}' } },
  { authorityLevel: 'User', senderName: 'Alice', isGroup: false, chatId: 'c1' },
  [],
  auditAgentBlueprint,
);

console.log(result.allowed); // false
console.log(result.risk_level); // 'high'
```

## 2. Testing Safety Sentinel with Unit Tests

Run the dedicated test suite to verify that your safety policies pass:

```bash
NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=dummy REDIS_URL=redis://localhost:6379 NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest src/tests/unit/runtime/RuntimeSentinel.test.ts
```

## 3. Configuring Session Budget & FinOps Multiplier

In `pricing.json` (resolved via `ConfigPathResolver` at `~/.hivemind/config/pricing.json`, `./config/pricing.json` with `HIVE_TRUST_PROJECT_CONFIG=1`, or embedded defaults in `src/config/defaults/pricing.json`):

> [!IMPORTANT]
> Rates in `pricing.json` are specified in **USD per million tokens ($/1M tokens)**. `RuntimeFinOps` calculates token cost using `(tokens * rate) / 1_000_000`. Supplying raw single-token fractions (such as `0.000001`) would artificially deflate calculated spending by a factor of 1,000,000 and render the session budget ineffective.

```json
{
  "default": { "input": 0.15, "output": 0.6 },
  "models": {
    "gemini-2.5-flash": { "input": 0.075, "output": 0.3 },
    "claude-4-5-sonnet-20250929": { "input": 3.0, "output": 15.0 }
  }
}
```

Monitor session spending via `AIRuntimeInfrastructure` and `RuntimeFinOps`:

```typescript
import { AIRuntimeInfrastructure } from '../../src/services/runtime/RuntimeInfrastructure.js';

const maxBudget = 2.0;
const runtime = new AIRuntimeInfrastructure(maxBudget);
const lambda = runtime.finOps.calculateLambda();
if (lambda > 1.0) {
  console.warn(
    `[FinOps] Budget pressure high (lambda = ${lambda.toFixed(2)}). Downgrading model tier.`,
  );
}
```
