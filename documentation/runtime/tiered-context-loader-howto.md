# How-To: Regulate Token Usage with ContextWindowService (SS-22)

## Goal
Learn how to check token consumption, verify if the 80% garbage-collection threshold is reached, and trigger history compaction.

## 1. Checking Active Window Usage

```typescript
import { ContextWindowService } from '../../services/runtime/ContextWindowService.js';

const contextService = new ContextWindowService();
contextService.setActiveModel('codestral-latest'); // 32,768 tokens limit

// Record token usage after a response
contextService.updateConsumption('chat_session_1', 25000);

const usage = contextService.getUsage('chat_session_1');
console.log(`Model: ${usage.model}`);
console.log(`Tokens: ${usage.consumed} / ${usage.limit} (${(usage.percentage * 100).toFixed(1)}%)`);

// Check if garbage collection compaction is required
const needsCompaction = contextService.isThresholdReached('chat_session_1', []);
if (needsCompaction) {
  console.log('Threshold >= 80% reached: Compacting conversation history.');
}
```

## 2. Running Unit Tests

Validate token estimation and boundary enforcement:

```bash
NODE_ENV=test SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=dummy REDIS_URL=redis://localhost:6379 NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest src/tests/unit/runtime/ContextWindowService.test.ts
```
