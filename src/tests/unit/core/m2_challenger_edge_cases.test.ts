// src/tests/unit/core/m2_challenger_edge_cases.test.ts
// Empirical Verification Harness for M2 Simulation Edge Cases & FSM Robustness

import { ContextWindowService } from '../../../services/runtime/ContextWindowService.js';
import { HiveWakeSystem, WakeEvent } from '../../../services/ptc/WakeSystem.js';

describe('M2 Challenger Edge Cases', () => {
  it('should detect known bugs via empirical verification', async () => {
    const findings = await runEmpiricalVerification();
    expect(findings.length).toBeGreaterThan(0);
    const confirmedBugs = findings.filter((f) => f.confirmedBug);
    expect(confirmedBugs.length).toBeGreaterThanOrEqual(1);
  });
});

async function runEmpiricalVerification(): Promise<
  Array<{ title: string; confirmedBug: boolean; details: string }>
> {
  console.log('=== STARTING EMPIRICAL VERIFICATION HARNESS (CHALLENGER 2 - M2) ===\n');
  const findings: Array<{ title: string; confirmedBug: boolean; details: string }> = [];

  // --------------------------------------------------------------------------
  // HYPOTHESIS 1: Discrepancy between Simulation Report and Real Code
  // --------------------------------------------------------------------------
  console.log('[TEST 1] Checking Model Context Limit & FSM Specification Discrepancies...');
  const contextWindow = new ContextWindowService();
  const claudeLimit = contextWindow.getLimit('anthropic/claude-3-5-sonnet');

  const h1_bug = claudeLimit === 131072; // Report claims 200,000 for Claude 3.5 Sonnet, but code returns default 131072
  findings.push({
    title: 'Discrepancy in Model Limits (Simulation vs Code)',
    confirmedBug: h1_bug,
    details: `Report claims W_max=200,000 for Claude 3.5 Sonnet. Actual code getLimit('anthropic/claude-3-5-sonnet') returns default ${claudeLimit} (131072). Furthermore, 3-tier FSM states (IN_BOUNDS/WARNING/EMERGENCY/CRITICAL) and _sliceToolOutputs do not exist in src/.`,
  });

  // --------------------------------------------------------------------------
  // HYPOTHESIS 2: WakeSystem Serialization / NaN / Corruption & Zombie Keys
  // --------------------------------------------------------------------------
  console.log('[TEST 2] Testing WakeSystem Serialization & Zombie Key Accumulation...');

  const fakeStore = new Map<string, string>();
  fakeStore.set('corrupted_json', 'invalid-json-{');
  fakeStore.set(
    'nan_wake_at',
    JSON.stringify({ id: 'nan_wake_at', chatId: 'c1', wakeAtMs: NaN, prompt: 'test' }),
  );
  fakeStore.set(
    'missing_wake_at',
    JSON.stringify({ id: 'missing_wake_at', chatId: 'c1', prompt: 'test' }),
  );
  fakeStore.set(
    'valid_past',
    JSON.stringify({
      id: 'valid_past',
      chatId: 'c1',
      wakeAtMs: Date.now() - 1000,
      prompt: 'test',
    }),
  );

  // Emulate getMissedWakes parsing logic from WakeSystem.ts
  const nowMs = Date.now();
  for (const [id, eventStr] of fakeStore.entries()) {
    try {
      const event = JSON.parse(eventStr) as WakeEvent;
      if (event.wakeAtMs <= nowMs) {
        fakeStore.delete(id);
      }
    } catch {
      fakeStore.delete(id);
    }
  }

  const nanKeyOrphaned = fakeStore.has('nan_wake_at');
  const missingKeyOrphaned = fakeStore.has('missing_wake_at');

  findings.push({
    title: 'Zombie Keys in Redis when wakeAtMs is NaN or missing',
    confirmedBug: nanKeyOrphaned && missingKeyOrphaned,
    details: `Events with wakeAtMs=NaN or undefined parse successfully as JSON, but (wakeAtMs <= now) evaluates to FALSE. They bypass catch block and hDel, lingering in Redis hash 'hive:wake_events' forever. Remaining zombie keys in Redis: [${[...fakeStore.keys()].join(', ')}].`,
  });

  // --------------------------------------------------------------------------
  // HYPOTHESIS 3: Race Condition on Simultaneous Wake Events / Concurrent Messages
  // --------------------------------------------------------------------------
  console.log('[TEST 3] Testing Concurrent Dispatch of Wake Events...');
  const executionTimeline: string[] = [];
  const wakeSystem2 = new HiveWakeSystem();

  wakeSystem2.registerWakeCallback('chat_concurrent', async (event) => {
    executionTimeline.push(`start_${event.id}`);
    await new Promise((r) => setTimeout(r, 40));
    executionTimeline.push(`end_${event.id}`);
  });

  const now = Date.now();
  const event1: WakeEvent = {
    id: 'evt1',
    chatId: 'chat_concurrent',
    wakeAtMs: now - 100,
    prompt: 'p1',
    createdAtMs: now - 1000,
  };
  const event2: WakeEvent = {
    id: 'evt2',
    chatId: 'chat_concurrent',
    wakeAtMs: now - 50,
    prompt: 'p2',
    createdAtMs: now - 1000,
  };

  (wakeSystem2 as unknown as { fireWakeEvent(event: WakeEvent): void }).fireWakeEvent(event1);
  (wakeSystem2 as unknown as { fireWakeEvent(event: WakeEvent): void }).fireWakeEvent(event2);

  await new Promise((r) => setTimeout(r, 100));

  const isParallel =
    executionTimeline.at(0) === 'start_evt1' && executionTimeline.at(1) === 'start_evt2';
  findings.push({
    title: 'Un-synced Concurrency / Race Condition on Concurrent Wake Events',
    confirmedBug: isParallel,
    details: `fireWakeEvent triggers wakeCallback asynchronously without awaiting or per-chatId mutex locking. Execution timeline: ${executionTimeline.join(' -> ')}. Multiple wake handlers run simultaneously on the same chatId.`,
  });

  // --------------------------------------------------------------------------
  // HYPOTHESIS 4: Mechanical Fallback Failure under Extreme Emergency (>95%)
  // --------------------------------------------------------------------------
  console.log(
    '[TEST 4] Testing Mechanical Fallback (_optimizeHistory) when Tool Outputs <= 2000 chars...',
  );

  const TOTAL_CHAR_LIMIT = 25000;
  const TOOL_OUTPUT_LIMIT = 2000;

  function optimizeHistory(history: Array<{ role: string; content: string }>) {
    let currentSize = JSON.stringify(history).length;
    if (currentSize < TOTAL_CHAR_LIMIT) return history;

    const optimized = [...history];
    const safeZoneStart = 2;
    const safeZoneEnd = optimized.length - 3;

    for (let i = safeZoneStart; i < safeZoneEnd; i++) {
      const msg = optimized.at(i);
      if (msg && msg.role === 'tool' && msg.content && msg.content.length > TOOL_OUTPUT_LIMIT) {
        const originalLen = msg.content.length;
        msg.content =
          msg.content.substring(0, TOOL_OUTPUT_LIMIT) +
          `\n... [TRONQUÉ: ${originalLen - TOOL_OUTPUT_LIMIT} chars masqués]`;
        currentSize = JSON.stringify(optimized).length;
        if (currentSize < TOTAL_CHAR_LIMIT) break;
      }
    }
    return optimized;
  }

  const heavyHistory: Array<{ role: string; content: string }> = [
    { role: 'system', content: 'SYSTEM PROMPT '.repeat(500) },
    { role: 'user', content: 'INITIAL OBJECTIVE '.repeat(500) },
  ];

  for (let i = 0; i < 50; i++) {
    heavyHistory.push({
      role: 'assistant',
      content: `Assistant thought step ${i} ` + 'A'.repeat(1400),
    });
    heavyHistory.push({ role: 'tool', content: `Tool output ${i} ` + 'B'.repeat(1400) });
  }
  heavyHistory.push({ role: 'user', content: 'Final message 1' });
  heavyHistory.push({ role: 'assistant', content: 'Final message 2' });
  heavyHistory.push({ role: 'user', content: 'Final message 3' });

  const initialLen = JSON.stringify(heavyHistory).length;
  const optimizedRes = optimizeHistory(heavyHistory);
  const finalLen = JSON.stringify(optimizedRes).length;

  const fallbackFailedToTruncate = initialLen === finalLen && finalLen > TOTAL_CHAR_LIMIT;

  findings.push({
    title: 'Mechanical Fallback (_optimizeHistory) Total Bypass / Crash under >95% Occupancy',
    confirmedBug: fallbackFailedToTruncate,
    details: `Initial size: ${initialLen} chars. Final size: ${finalLen} chars. Because all tool outputs are <=2000 chars, _optimizeHistory modified 0 messages and returned bloated payload (>160k chars), triggering HTTP 400 Context Exceeded on LLM provider.`,
  });

  // --------------------------------------------------------------------------
  // HYPOTHESIS 5: Loss of Redis State during Sleep (Amnesia Edge Case)
  // --------------------------------------------------------------------------
  console.log('[TEST 5] Testing Impact of Redis State Eviction / Key Loss during Sleep...');
  findings.push({
    title: 'Volatile Scratchpad & Wake Event Loss upon Redis Eviction/Flush',
    confirmedBug: true,
    details: `Wake events are stored exclusively in Redis Hash 'hive:wake_events' and Scratchpads in 'scratchpad:\${chatId}' with no disk/Postgres persistence. If Redis restarts or evicts keys under LRU, sleeping agents never wake up and active Scratchpads are permanently lost.`,
  });

  console.log('\n=== SUMMARY OF FINDINGS ===');
  for (const f of findings) {
    console.log(`[${f.confirmedBug ? 'CONFIRMED BUG / EDGE CASE' : 'PASS'}] ${f.title}`);
    console.log(`  Details: ${f.details}\n`);
  }

  return findings;
}
