# AI Runtime Control Plane (VIGIL, Ralph & FinOps) — Explanation

## Overview & Purpose

The **AI Runtime Control Plane (SS-21)** is HIVE-MIND's closed-loop supervisory architecture. In an autonomous multi-agent environment, LLMs are prone to behavioral degradation: infinite execution loops, destructive file operations, token budget exhaustion, and hallucinated tool calls. 

Rather than relying on unmonitored execution, SS-21 introduces a deterministic pre-action and post-action control loop operating across three core components:
1. **VIGIL Runtime Sentinel**: Pre-action invariant verification and permission gate.
2. **Ralph Anti-Slop Auditor**: Post-action loop detection, output quality critique, and behavioral stagnation check.
3. **FinOps Lagrange Cost Multiplier ($\lambda$)**: Dynamic budget regulation that penalizes expensive models as session spend approaches the allocated budget.

```
       [Proposed Tool Call]
                │
                ▼
      ┌──────────────────┐
      │  VIGIL Sentinel  │ ──► [BLOCKED / RISK CRITICAL] ──► Transport Error
      └─────────┬────────┘
                │ ALLOWED
                ▼
      ┌──────────────────┐
      │  Tool Execution  │
      └─────────┬────────┘
                │ Output
                ▼
      ┌──────────────────┐
      │   Ralph Auditor  │ ──► [SLOP / LOOP DETECTED] ──► Context Steering
      └─────────┬────────┘
                │ VERIFIED
                ▼
      [Next ReAct Step / Response]
```

## Architectural Components

### 1. VIGIL Pre-Action Sentinel (`RuntimeSentinel`)
Before any tool execution occurs in `BotCore` or `SubAgentEngine`, the action is evaluated by `RuntimeSentinel`:
- **Deterministic Fast Paths**:
  - *Fast Path 1 (Safe Read-Only)*: Commands in `SAFE_TOOLS` (`read_file`, `list_directory`, etc.) are approved immediately with zero LLM inference latency.
  - *Fast Path 2 (Global Administrator)*: Trusted administrative sessions bypass routine inspection.
  - *Fast Path 3 (Blueprint Constraints)*: If the active `AgentBlueprint` specifies `read_only_fs: true` or restricts `allowed_tools`, unlisted tools or write attempts are blocked with `risk_level: 'critical'`.
- **LLM Safety Recipe**: Sensible commands (e.g., shell executions, credential access) are submitted to a dedicated fast safety recipe (`SAFETY_SENTINEL`). If the model fails or times out, the system enforces a strict **Fail-Closed** policy on critical commands (`gm_ban_user`, `delete_group_data`), preventing unauthorized operations.

### 2. Ralph Anti-Slop & Anti-Loop Auditor
Post-execution, Ralph inspects tool returns and agent responses:
- **Loop Stagnation Detection**: Computes similarity across consecutive tool calls. If the agent repeats identical calls with matching failure messages, Ralph interrupts the ReAct cycle.
- **Slop Elimination**: Strips conversational filler, ungrounded apologies, and repetitive reasoning prefixes, keeping the working memory compact.

### 3. FinOps Lagrange Multiplier ($\lambda$)
To prevent runaway token costs, SS-21 computes an adaptive penalty factor based on session consumption:
$$\lambda = \left(\frac{\text{Current Cost}}{\text{Budget}}\right)^4$$
When $\lambda > 1.0$, the router automatically downgrades model tiers from reasoning powerhouses (e.g., Claude 3.5 Sonnet, Gemini 1.5 Pro) to lightweight execution models (e.g., Gemini 1.5 Flash, Groq Llama 3), preserving financial safety.

## Related Documentation
- [Runtime Control Plane Reference](./runtime-control-plane-reference.md)
- [How-To: Configure VIGIL Safety Policies](./runtime-control-plane-howto.md)
- [Tiered Context Loader Explanation](./tiered-context-loader-explanation.md)
