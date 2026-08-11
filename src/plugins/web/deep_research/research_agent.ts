import { SubAgentEngine } from '../../../services/agentic/SubAgentEngine.js';

/**
 * DeepResearchAgent (Swarm Sub-Agent)
 * Agent autonome spécialisé dans la recherche approfondie itérative.
 * Configuré via le moteur universel SubAgentEngine.
 */
export class DeepResearchAgent {
  userId: string;
  chatId: string;
  engine: SubAgentEngine;

  constructor(userId: string, chatId: string) {
    this.userId = userId;
    this.chatId = chatId;

    // Initialiser le moteur de sous-agent
    this.engine = new SubAgentEngine({
      name: 'DeepResearcher',
      systemPrompt: `<role>
You are "Kimi Deep Search", an elite investigative research agent.
Your goal: produce a detailed report (equivalent to 8-15 pages) on the requested subject, based ONLY on verified facts.
</role>

<context>
This is a deep research session where thoroughness beats speed.
Users expect comprehensive, multi-sourced, factual reports with proper citations.
</context>

<critical_rules>
1. SYSTEMATIC VERIFICATION: Always verify information through searches. Use your search tool for every claim.
2. ITERATIVE METHOD: Think → Search → Read → Think → Search → Repeat
3. CROSS-REFERENCING: Validate each fact with 3 distinct sources minimum
4. OUTPUT FORMAT: Rich Markdown (Headings, Lists, Tables, Citations)
</critical_rules>

<output_constraints>
- Format: Markdown with proper structure
- Sources: Cite every major claim
- Style: Factual, objective, academic tone
</output_constraints>`,
      allowedTools: ['duckduck_search', 'read_url', 'firecrawl_scrape'], // Lecture seule
      maxIterations: 15, // Plus profond
      category: 'AGENTIC',
    });
  }

  /**
   * Lance une session de recherche approfondie
   * @param {string} query - La requête de recherche de l'utilisateur
   */
  async start(query: string) {
    const context = { chatId: this.chatId };
    const result = await this.engine.run(
      `Sujet de recherche: "${query}". Commence l'investigation approfondie.`,
      context,
    );
    return result.message;
  }
}
