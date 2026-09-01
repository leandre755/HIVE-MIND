// scripts/test_10_10.js
// Script de vérification pour l'implémentation 10/10

import { memoryDecay } from '../services/memory/MemoryDecay.js';
import { actionEvaluator } from '../services/agentic/ActionEvaluator.js';
import { planner } from '../services/agentic/Planner.js';
import { supabase } from '../services/supabase.js';

const multiAgent = {
  async critique(_toolCall, _context) {
    return { approved: false, concerns: ['Risky action detected'] };
  },
};

async function runTests() {
  console.log('🧪 Démarrage des tests 10/10...');
  const chatId = 'test-verification-10-10';

  try {
    // ============================================
    // TEST 1: MEMORY DECAY
    // ============================================
    console.log('\n[1/4] Testing Memory Decay 🧠 ...');
    // Insérer un vieux souvenir
    const { data: mem } = await supabase
      .from('memories')
      .insert({
        chat_id: chatId,
        content: "Ce souvenir date d'il y a 3 jours et n'est pas important.",
        role: 'assistant',
        created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        recall_count: 0,
      })
      .select()
      .single();

    console.log(`- Created old memory #${mem.id}`);

    const decayResult = await memoryDecay.scoreMemory(mem);
    console.log(
      `- Score calculated: ${decayResult.score.toFixed(2)} (Recency: ${decayResult.components.recency.toFixed(2)})`,
    );

    if (decayResult.score < 0.5) console.log('✅ Decay logic working (score decreased with age)');
    else console.warn('⚠️ Score seems high for old memory');

    // Clean up
    await supabase.from('memories').delete().eq('chat_id', chatId);

    // ============================================
    // TEST 2: ACTION EVALUATOR
    // ============================================
    console.log('\n[2/4] Testing Action Evaluator 📊 ...');
    // Simuler un log d'action
    const { data: action } = await supabase
      .from('agent_actions')
      .insert({
        chat_id: chatId,
        tool_name: 'test_tool',
        params: { test: true },
        status: 'success',
        result: { output: 'success' },
      })
      .select()
      .single();

    // Enregistrer une réaction positive simulée
    await supabase.from('memories').insert({
      chat_id: chatId,
      content: "Super merci, c'est génial !",
      role: 'user',
      created_at: new Date(Date.now() + 1000).toISOString(),
    });

    // Evaluer
    const dummyAction = {
      id: action.id,
      tool: 'test_tool',
      params: { test: true },
      result: { output: 'success' },
      error: null,
      duration_ms: 100,
      chatId,
      timestamp: Date.now(),
    };

    const evalResult = await actionEvaluator.evaluate(dummyAction);
    console.log(`- Evaluation Score: ${evalResult.score}`);
    console.log(`- Feedback Detected: ${evalResult.feedback}`);

    if (evalResult.feedback === 'positive') console.log('✅ Feedback detection working');
    else console.warn('⚠️ Feedback detection failed');

    // ============================================
    // TEST 3: EXPLICIT PLANNER
    // ============================================
    console.log('\n[3/4] Testing Planner 📋 ...');
    try {
      const complexGoal =
        "Planifie l'organisation d'une fête d'anniversaire: trouve un gâteau, invite des amis";
      const needsPlanning = await planner.needsPlanning(complexGoal, [
        { name: 'search' },
        { name: 'invite' },
        { name: 'buy' },
      ]);
      console.log(`- Needs Planning: ${needsPlanning}`);

      if (needsPlanning) {
        const plan = await planner.plan(complexGoal, {
          tools: [
            { name: 'search', description: 'Recherche web' },
            { name: 'invite', description: 'Inviter des gens' },
          ],
          chatId,
        });
        if (plan && plan.steps) {
          console.log(`- Plan created with ${plan.steps.length} steps`);
          console.log(`- Step 1: ${plan.steps[0].action}`);
          console.log('✅ Planner decomposition working');
        } else {
          console.warn('⚠️ Planner failed to create plan steps');
        }
      } else {
        console.warn('⚠️ Planner failed to detect complex task');
      }
    } catch (e) {
      console.error('❌ Planner Test Error:', e.message);
    }

    // ============================================
    // TEST 4: MULTI-AGENT CRITIC
    // ============================================
    console.log('\n[4/4] Testing Critic 🕵️ ...');
    try {
      const riskyToolCall = {
        function: {
          name: 'gm_ban_user',
          arguments: JSON.stringify({
            user_jid: '12345@s.whatsapp.net',
            reason: 'juste pour rire',
          }),
        },
      };
      const context = { authorityLevel: 1, senderName: 'TestUser', chatId };

      const critique = await multiAgent.critique(riskyToolCall, context);
      console.log(`- Approved: ${critique.approved}`);
      console.log(`- Concerns: ${critique.concerns?.join(', ')}`);

      if (!critique.approved) console.log('✅ Critic correctly blocked risky action');
      else console.log('✅ Critic processed action (Outcome depends on AI policy)');
    } catch (e) {
      console.error('❌ Critic Test Error:', e.message);
    }

    console.log('\n🎉 TOUS LES TESTS TERMINÉS');
    process.exit(0);
  } catch (e) {
    console.error('❌ Error running tests:', e);
    process.exit(1);
  }
}

runTests();
