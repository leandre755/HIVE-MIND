// core/context/TieredContextLoader.ts
// ============================================================================
// UNIFIED CONTEXT LOADER — V3 Dynamic Context Engineering
//
// ARCHITECTURE: Single unified load() replaces the old FAST/AGENTIC split.
// Every message gets the same "Bureau de Travail" (Workspace Prompt):
//   1. CORE RULES     (~150 tokens, static from system.md template)
//   2. USER PASSPORT   (~50 tokens, L1 Redis hot cache)
//   3. SCRATCHPAD/GCC  (~150 tokens, L1 Redis hot cache)
//   4. ACTION HISTORY  (~200 tokens, L1 Redis compressed traces)
//   5. CHAT HISTORY    (~300 tokens, L1 Redis last 5 messages)
//
// RAG, Facts, and Workspace are NOT pushed into the prompt.
// The agent PULLS them via tools: search_long_term_memory, db_document_read.
// ============================================================================

import { container } from '../ServiceContainer.js';
import { botIdentity } from '../../utils/botIdentity.js';
import { safeReadFileSync, safeReadFile, resolveWithinRoot } from '../../utils/safeFs.js';
import { readdir } from 'node:fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { permissionManager } from '../security/PermissionManager.js';
import { blueprintManager } from '../blueprint/AgentBlueprint.js';
import {
  TOOL_USE_GUIDELINES,
  ERROR_HANDLING_RULES,
  FEW_SHOT_EXAMPLES,
} from '../../constants/systemPromptSections.js';
import { learningEngine } from '../../services/learning/LearningEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface WorkingMemoryService {
  getContext(chatId: string, limit: number): Promise<Array<{ role: string; content: string }>>;
  getPassport(sender: string): Promise<Passport | null>;
  getScratchpad(chatId: string): Promise<string | null>;
  getActionHistory(chatId: string): Promise<unknown>;
  formatPassport(passport: Passport): string;
  formatActionHistory(actionHistory: unknown): string;
  setPassport(sender: string, passport: Passport): Promise<void>;
}

interface UserService {
  getProfile(sender: string): Promise<{
    names?: string[];
    language?: string;
    timezone?: string;
    interaction_count?: number;
    last_seen?: unknown;
  }>;
}

interface GroupService {
  getContext(
    chatId: string,
    _arg2: null,
    _arg3: null,
  ): Promise<{
    group?: {
      name: string;
      description?: string;
      member_count?: number;
      bot_mission?: string;
      blueprint_id?: string;
      blueprintId?: string;
    };
  } | null>;
}

interface AdminService {
  isSuperUser(sender: string): Promise<boolean>;
  isGlobalAdmin(sender: string): Promise<boolean>;
}

interface Passport {
  name: string;
  lang: string;
  tz: string;
  topFacts: string[];
  maple: {
    facts: string[];
    prefs: string[];
    goals: string[];
  };
}

interface GroupBasics {
  name: string;
  description: string;
  memberCount: number;
  botMission: string;
  blueprintId: string;
}

interface UserSnapshot {
  jid: string;
  name: string;
  interactionCount: number;
  lastSeen?: unknown;
}

interface Authority {
  isSuperUser: boolean;
  isGlobalAdmin: boolean;
  isGroupAdmin: boolean;
  isBotAdmin: boolean;
  level: number;
}

export interface UnifiedContext {
  systemPrompt: string;
  recentMessages: Array<{ role: string; content: string }>;
  history: Array<{ role: string; content: string }>;
  authority: Authority;
  userSnapshot: UserSnapshot | null;
  groupBasics: GroupBasics | null;
  blueprint: Record<string, unknown>;
  mode: string;
}

// Load the V3 system prompt template (contains {{PLACEHOLDERS}})
let systemPromptTemplate = '';
try {
  systemPromptTemplate = safeReadFileSync(
    path.join(__dirname, '..', '..', 'persona', 'prompts', 'system.md'),
    'utf-8',
  );
} catch {
  systemPromptTemplate = 'You are HIVE-MIND V3, an autonomous AI agent.';
}

/**
 * Unified Context Loader — V3 Dynamic Context Engineering
 *
 * Single entry point: load(chatId, message) → UnifiedContext
 * No more FAST/AGENTIC distinction. Every message gets the full Bureau de Travail.
 */
export class TieredContextLoader {
  workingMemory: WorkingMemoryService | null;
  userService: UserService | null;
  groupService: GroupService | null;
  adminService: AdminService | null;
  factsMemory: { getAll(sender: string): Promise<Record<string, unknown>> } | null;
  browser: unknown;
  localCache: {
    botIdentity: { name: string };
    systemPromptTemplate: string;
  };
  authorityCache: Map<string, { data: Authority; timestamp: number }>;
  AUTHORITY_CACHE_TTL: number;

  constructor() {
    this.workingMemory = null;
    this.userService = null;
    this.groupService = null;
    this.adminService = null;
    this.factsMemory = null;
    this.browser = null;

    this.localCache = {
      botIdentity: { name: botIdentity.fullName },
      systemPromptTemplate,
    };

    this.authorityCache = new Map();
    this.AUTHORITY_CACHE_TTL = 600000; // 10 minutes
  }

  /**
   * Initialise les services depuis le container.
   * Must be called once at startup.
   */
  init() {
    try {
      this.workingMemory = container.get('workingMemory') as WorkingMemoryService;
      this.userService = container.get('userService') as UserService;
      this.groupService = container.get('groupService') as unknown as GroupService;
      this.adminService = container.get('adminService') as AdminService;
      this.factsMemory = container.get('facts') as {
        getAll(sender: string): Promise<Record<string, unknown>>;
      };
      this.browser = container.get('browser');

      console.log(
        `[TieredContext] ✅ V3 Unified Init. WM: ${!!this.workingMemory}, Browser: ${!!this.browser}`,
      );
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[TieredContext] ❌ Init Failed:', message);
    }
  }

  /**
   * UNIFIED LOAD — Single entry point for all messages.
   *
   * Assembles the "Bureau de Travail" from L1 Redis hot cache:
   * 1. User Passport  (identity, always present)
   * 2. Scratchpad/GCC (volatile working memory)
   * 3. Action History  (compressed tool traces)
   * 4. Chat History    (last 5 messages)
   * 5. Authority       (permissions for security)
   *
   * The system prompt template is hydrated with these blocks.
   *
   * @param {string} chatId
   * @param {Object} message - { sender, text, sourceChannel, ... }
   * @returns {Promise<UnifiedContext>}
   */
  async load(
    chatId: string,
    message: {
      sender: string;
      sourceChannel?: string;
      systemContext?: string;
      [key: string]: unknown;
    },
  ): Promise<UnifiedContext> {
    const startTime = Date.now();
    const isGroup = chatId?.endsWith('@g.us');

    // Safety check
    if (!this.workingMemory) {
      console.warn('[TieredContext] ⚠️ WorkingMemory missing, attempting re-init...');
      this.init();
      if (!this.workingMemory) {
        console.error('[TieredContext] 🛑 CRITICAL: WorkingMemory still missing.');
        return this._buildFallbackContext(chatId, message);
      }
    }

    // ── L1 HOT CACHE — All parallel, ~50ms total ──
    const [
      recentMessages,
      passport,
      scratchpad,
      actionHistory,
      userSnapshot,
      authority,
      groupBasics,
    ] = await Promise.all([
      this.workingMemory.getContext(chatId, 5),
      this._getOrBuildPassport(message.sender),
      this.workingMemory.getScratchpad(chatId),
      this.workingMemory.getActionHistory(chatId),
      this._getCachedUserProfile(message.sender),
      this._getAuthority(message.sender, chatId),
      isGroup ? this._getGroupBasics(chatId) : Promise.resolve(null),
    ]);

    // Resolve blueprint (with fallback to hive_main)
    let blueprintId = 'hive_main';
    if (groupBasics?.blueprintId) {
      blueprintId = groupBasics.blueprintId;
    }
    let blueprint;
    try {
      blueprint = blueprintManager.loadBlueprint(blueprintId);
    } catch {
      try {
        blueprint = blueprintManager.loadBlueprint('hive_main');
      } catch {
        blueprint = {
          metadata: { id: 'fallback', name: 'Safe Fallback', version: '0.1.0' },
          mindos: { drives: [] },
          action_space: { allowed_tools: [] },
          constraints: { read_only_fs: false, max_budget_usd: 1.0, max_iterations: 10 },
        };
      }
    }

    const systemPrompt = await this._hydrateTemplate({
      channel: message.sourceChannel || 'whatsapp',
      passport: passport || {
        name: 'Unknown',
        lang: 'auto',
        tz: 'auto',
        topFacts: [],
        maple: { facts: [], prefs: [], goals: [] },
      },
      scratchpad: scratchpad || '(Empty. Use update_scratchpad to write here.)',
      actionHistory: this.workingMemory.formatActionHistory(actionHistory),
      userSnapshot,
      authority,
      groupBasics,
      chatId,
      blueprint,
      userQuery: (message.text || '') as string,
      systemContext: message.systemContext,
    });

    const context = {
      systemPrompt,
      recentMessages: recentMessages || [],
      history: (recentMessages || []).map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      authority,
      userSnapshot,
      groupBasics,
      blueprint,
      mode: 'UNIFIED', // No more FAST/AGENTIC distinction
    };

    console.log(`[TieredContext] ⚡ Unified context loaded in ${Date.now() - startTime}ms`);
    return context;
  }

  // ========================================================================
  // PRIVATE — L1 Data Retrieval
  // ========================================================================

  /**
   * Gets passport from Redis L1 cache, or builds it on miss.
   */
  async _getOrBuildPassport(sender: string): Promise<Passport> {
    if (!this.workingMemory || !this.userService || !this.factsMemory) {
      return {
        name: 'Unknown',
        lang: 'auto',
        tz: 'auto',
        topFacts: [],
        maple: { facts: [], prefs: [], goals: [] },
      };
    }

    let passport = await this.workingMemory.getPassport(sender);
    if (passport) return passport;

    // Cache miss → build from userService + factsMemory
    try {
      const profile = await this.userService.getProfile(sender);
      const name = profile?.names?.[0] || 'Unknown';

      const maple = { facts: [] as string[], prefs: [] as string[], goals: [] as string[] };
      try {
        const allFacts = await this.factsMemory.getAll(sender);
        for (const [key, value] of Object.entries(allFacts)) {
          if (key.startsWith('fact:')) maple.facts.push(value as string);
          else if (key.startsWith('pref:')) maple.prefs.push(value as string);
          else if (key.startsWith('goal:')) maple.goals.push(value as string);
          else {
            // Fallback/Legacy facts
            maple.facts.push(`${key}: ${value}`);
          }
        }
      } catch {
        // Facts unavailable — non-blocking
      }

      passport = {
        name,
        lang: profile?.language || 'auto',
        tz: profile?.timezone || 'auto',
        topFacts: [...maple.facts, ...maple.prefs, ...maple.goals].slice(0, 4),
        maple,
      };

      // Cache in Redis L1 (1h TTL)
      await this.workingMemory.setPassport(sender, passport);
      return passport;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn('[TieredContext] Passport build failed:', message);
      return {
        name: 'Unknown',
        lang: 'auto',
        tz: 'auto',
        topFacts: [],
        maple: { facts: [], prefs: [], goals: [] },
      };
    }
  }

  async _getCachedUserProfile(sender: string): Promise<UserSnapshot> {
    if (!this.userService) {
      return { jid: sender, name: 'Unknown', interactionCount: 0 };
    }

    try {
      const profile = await this.userService.getProfile(sender);
      return {
        jid: sender,
        name: profile.names?.[0] || 'Unknown',
        interactionCount: profile.interaction_count || 0,
        lastSeen: profile.last_seen,
      };
    } catch {
      return { jid: sender, name: 'Unknown', interactionCount: 0 };
    }
  }

  async _getAuthority(sender: string, _chatId: string): Promise<Authority> {
    // Check local cache first
    const cached = this.authorityCache.get(sender);
    if (cached && Date.now() - cached.timestamp < this.AUTHORITY_CACHE_TTL) {
      return cached.data;
    }

    if (!this.adminService) {
      return {
        isSuperUser: false,
        isGlobalAdmin: false,
        isGroupAdmin: false,
        isBotAdmin: false,
        level: 0,
      };
    }

    try {
      const [isSuperUser, isGlobalAdmin] = await Promise.all([
        this.adminService.isSuperUser(sender),
        this.adminService.isGlobalAdmin(sender),
      ]);

      let level = 0;
      if (isSuperUser) {
        level = 100;
      } else if (isGlobalAdmin) {
        level = 80;
      }

      const authority = {
        isSuperUser,
        isGlobalAdmin,
        isGroupAdmin: false,
        isBotAdmin: false,
        level,
      };

      this.authorityCache.set(sender, {
        data: authority,
        timestamp: Date.now(),
      });

      return authority;
    } catch {
      return {
        isSuperUser: false,
        isGlobalAdmin: false,
        isGroupAdmin: false,
        isBotAdmin: false,
        level: 0,
      };
    }
  }

  async _getGroupBasics(chatId: string): Promise<GroupBasics | null> {
    if (!this.groupService) return null;

    try {
      const groupContext = await this.groupService.getContext(chatId, null, null);
      if (groupContext?.group) {
        return {
          name: groupContext.group.name,
          description: groupContext.group.description || '',
          memberCount: groupContext.group.member_count || 0,
          botMission: groupContext.group.bot_mission || '',
          blueprintId: groupContext.group.blueprint_id || groupContext.group.blueprintId || '',
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  // ========================================================================
  // PRIVATE — Template Hydration
  // ========================================================================

  /**
   * Hydrates the system.md template by replacing {{PLACEHOLDERS}} and
   * appending the execution engine block.
   */
  async _hydrateTemplate(data: {
    channel: string;
    passport: Passport;
    scratchpad: string;
    actionHistory: string;
    userSnapshot: UserSnapshot;
    authority: Authority;
    groupBasics: GroupBasics | null;
    chatId: string;
    blueprint?: unknown;
    userQuery: string;
    systemContext?: string;
  }): Promise<string> {
    const now = new Date();

    let prompt = this.localCache.systemPromptTemplate;

    // 1. Replace dynamic context placeholders
    prompt = prompt.replace('{{CURRENT_CHANNEL}}', data.channel);
    prompt = prompt.replace('{{CURRENT_TIMESTAMP}}', now.toISOString());
    if (this.workingMemory) {
      prompt = prompt.replace(
        '{{USER_PASSPORT}}',
        this.workingMemory.formatPassport(data.passport),
      );
    }
    prompt = prompt.replace('{{SCRATCHPAD}}', data.scratchpad);
    prompt = prompt.replace('{{ACTION_HISTORY}}', data.actionHistory);

    // 2. Build user model XML (Anthropic V3 user passport)
    const userModel = `
<user_model>
  <name>${data.userSnapshot.name}</name>
  <facts>${data.passport.maple?.facts.join(' | ') || 'None'}</facts>
  <preferences>${data.passport.maple?.prefs.join(' | ') || 'None'}</preferences>
  <active_goals>${data.passport.maple?.goals.join(' | ') || 'None'}</active_goals>
</user_model>
`;

    // 3. Build task harness context
    const harness = await this._buildHarnessContext(data.chatId);

    // 4. Append execution engine
    const executionBlock = this._buildExecutionBlock(data);

    // 5. Append social context
    const socialBlock = this._buildSocialContext(data);

    // 6. Build MindOS Drives and Economic Constraints XML blocks
    const mindosDrives = this._buildMindosDrivesXml(data.blueprint);

    const economicConstraint = this._buildEconomicConstraintXml(data.blueprint);

    // 7. Load survival and expert skills (progressive disclosure style)
    const survivalSkillsYaml = await this._loadSurvivalSkills();
    const survivalSkillsBlock = survivalSkillsYaml
      ? `\n<survie-skills>\n${survivalSkillsYaml}\n</survie-skills>\n`
      : '';

    const expertSkill = await learningEngine.routeSkills(data.userQuery, data.chatId);
    let expertSkillsBlock = '';
    if (expertSkill) {
      const commentsStr = expertSkill.comments.map((c) => `  <comment>${c}</comment>`).join('\n');
      expertSkillsBlock = `\n<skills>\n${expertSkill.yamlBlock}\n${commentsStr ? commentsStr + '\n' : ''}</skills>\n`;
    }

    let promptResult = `${prompt}\n${userModel}\n${harness}\n${socialBlock}\n${executionBlock}${survivalSkillsBlock}${expertSkillsBlock}${mindosDrives}${economicConstraint}`;

    if (data.systemContext && data.systemContext.trim()) {
      promptResult += `\n<local_instructions>\n${data.systemContext.trim()}\n</local_instructions>\n`;
    }

    return promptResult;
  }

  /**
   * Builds execution harness for ongoing actions and tasks.
   */
  async _buildHarnessContext(chatId: string): Promise<string> {
    try {
      const { actionMemory } = await import('../../services/memory/ActionMemory.js');
      let harness = '';

      if (!this.workingMemory) return '';

      // 1. Carnet de bord (Scratchpad)
      const scratchpad = await this.workingMemory.getScratchpad(chatId);
      if (scratchpad) {
        harness += `<scratchpad>\n${scratchpad}\n</scratchpad>\n`;
      }

      // 2. Tâche longue en cours (ActionMemory)
      const activeAction = await actionMemory.getActiveAction(chatId);
      if (activeAction) {
        const steps = activeAction.steps.map((s: { step: string }) => `- ${s.step}`).join('\n');
        harness += `
<execution_harness>
  <ongoing_goal>${activeAction.goal}</ongoing_goal>
  <completed_steps>
${steps || 'None yet'}
  </completed_steps>
  <directive>You are resuming an ongoing background task. Resume work immediately. Do not apologize. Use your tools to advance the goal.</directive>
</execution_harness>\n`;
      }

      return harness;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[TieredContext] Error building harness context:', message);
      return '';
    }
  }

  /**
   * Builds the execution engine block (sandbox paths, tool directives, etc.)
   */
  _buildExecutionBlock(_data: { blueprint?: unknown }): string {
    let block = '<execution_engine>\n';

    block +=
      '### 🛠️ TOOLS AND CAPABILITIES\nYou have native tools (functions) that you can call.\nIMPORTANT: If the user asks about your capabilities, your functions, or if you have a specific tool, **IMMEDIATELY CALL the `get_my_capabilities` tool**.\n';

    block +=
      '\n### 📂 EXECUTION ENVIRONMENT (FILESYSTEM)\n' +
      'You have **universal read access** to the entire filesystem (referred to as the **"Host Disk"** — e.g. `/home`, `/etc`, project root, etc.). Use `read_file`, `list_directory`, and `grep_search` anywhere.\n' +
      'However, for **Write access**, you are strictly sandboxed and can write only to your two authorized virtual disks:\n' +
      `- **Sandbox Execution Disk**: Located at \`${path.basename(permissionManager.sandboxDir)}/\`. Use this virtual disk for running scripts, compiling code, and handling transient execution files.\n` +
      `- **Dedicated Storage Disk**: Located at \`${path.basename(permissionManager.storageDir)}/\`. Use this virtual disk to persistently save your files, assets, stickers, documents, and screenshots. This is an independent disk from the Sandbox.\n` +
      'Any attempt to write outside these virtual disks (e.g. directly to the "Host Disk" or project source code) is blocked and will require explicit HITL permission. Always direct your file outputs to their respective virtual disks.\n';

    block += '\n### ⚡ EXECUTION DIRECTIVES (MANDATORY)\n';
    block +=
      '- **Actionable request → act NOW in this turn.** Never announce an action if you can execute it directly.\n';
    block +=
      '- **Continue until finished or blocked.** Do not reply with a plan or promise when a tool can advance the task.\n';
    block += '- **Weak or empty tool result → vary the query** before concluding failure.\n';
    block += '- **Mutable facts (git, process, api) require live checks** via tools.\n';
    block +=
      '- **Long task (>30s) → use `code_execution` with `HIVE.sleepAndWake(delayMs, prompt)`** to free the LLM loop. Never block.\n';

    block += '\n### 💻 DIRAC CODING PROTOCOL (Refactoring & Code)\n';
    block +=
      '1. **AST-Native First**: Only use `read_file` on a large file as a LAST resort. ALWAYS prefer `get_file_skeleton` to understand the structure, then `get_function` to target precise code. It is 90% faster.\n';
    block +=
      '2. **Hash-Anchored Edits**: Lines of code returned by AST tools and `read_file` are prefixed by a unique anchor (e.g., `AppleBanana§    def process():`).\n';
    block +=
      '3. **Surgical Editing**: To modify code, use `edit_file` providing the **exact anchor** (`AppleBanana`) or the full line with the anchor in `anchor`. This is highly precise and resilient to line shifts.\n';
    block +=
      '4. **Multi-File Batching**: Group ALL your file edits in a single `edit_file` call via the `files` parameter. Do not make separate calls.\n';

    block +=
      '\n### 🤫 SILENCE TOKEN\nWhen you have called HIVE.sleepAndWake() or have NOTHING to say to the user, reply ONLY with: `__HIVE_SILENT_7f3a__`\nThis must be your ONLY text.\n';
    block += '</execution_engine>\n';

    block += `\n${TOOL_USE_GUIDELINES}\n`;
    block += `\n${ERROR_HANDLING_RULES}\n`;
    block += `\n${FEW_SHOT_EXAMPLES}\n`;

    return block;
  }

  _buildMindosDrivesXml(blueprint?: unknown): string {
    const bp = blueprint as { mindos?: { drives?: string[] } } | undefined;
    if (bp?.mindos?.drives && bp.mindos.drives.length > 0) {
      const formattedDrives = bp.mindos.drives.map((d: string) => `- ${d}`).join('\n');
      return `\n<mindos_drives>\n${formattedDrives}\n</mindos_drives>\n`;
    }
    return '';
  }

  _buildEconomicConstraintXml(blueprint?: unknown): string {
    const bpFull = blueprint as
      | {
          constraints?: {
            read_only_fs?: boolean;
            max_budget_usd?: number;
            max_iterations?: number;
          };
        }
      | undefined;

    if (!bpFull?.constraints) return '';

    const c = bpFull.constraints;
    let lambda = 0;
    try {
      const runtime = container.get('runtime') as {
        finOps?: { calculateLambda(): number };
      } | null;
      if (runtime?.finOps) {
        lambda = runtime.finOps.calculateLambda();
      }
    } catch {
      // Non-blocking fallback
    }

    let xml = `\n<economic_constraint>\n  <read_only_fs>${c.read_only_fs}</read_only_fs>\n  <max_budget_usd>${c.max_budget_usd}</max_budget_usd>\n  <max_iterations>${c.max_iterations}</max_iterations>\n`;

    if (lambda > 0.8) {
      xml += `  <kkt_emergency>CRITICAL</kkt_emergency>\n  <lambda>${lambda.toFixed(2)}</lambda>\n  <kkt_directive>BUDGET EXHAUSTION NEARING. Minimize all tool execution and API requests. Conclude the current task immediately.</kkt_directive>\n`;
    }

    xml += '</economic_constraint>\n';
    return xml;
  }

  /**
   * Builds a compact social context block.
   */
  _buildSocialContext(data: {
    groupBasics: GroupBasics | null;
    userSnapshot: UserSnapshot;
    authority: Authority;
  }): string {
    const now = new Date();
    let block = '<current_consciousness_state>\n';
    block += `  <timestamp>${now.getTime()}</timestamp>\n`;
    block += `  <datetime>${now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} ${now.toLocaleTimeString('fr-FR')}</datetime>\n`;

    let statusLabel = 'Member';
    if (data.authority.isSuperUser) {
      statusLabel = '👑 SuperUser';
    } else if (data.authority.isGlobalAdmin) {
      statusLabel = '⭐ Admin';
    }

    if (data.groupBasics) {
      const g = data.groupBasics;
      block += `  <social_context>\nLocation: Group "${g.name}"\nInterlocutor: ${data.userSnapshot.name}\nStatus: ${statusLabel}\n  </social_context>\n`;
    } else {
      const dmStatus = data.authority.isSuperUser ? '👑 SuperUser' : 'Standard';
      block += `  <social_context>\nInterlocutor: ${data.userSnapshot.name}\nStatus: ${dmStatus}\n  </social_context>\n`;
    }

    block += '</current_consciousness_state>\n';
    return block;
  }

  /**
   * Fallback context when WorkingMemory is completely unavailable.
   */
  _buildFallbackContext(_chatId: string, message: { sender: string }): UnifiedContext {
    return {
      systemPrompt: this.localCache.systemPromptTemplate,
      recentMessages: [],
      history: [],
      authority: {
        isSuperUser: false,
        isGlobalAdmin: false,
        isGroupAdmin: false,
        isBotAdmin: false,
        level: 0,
      },
      userSnapshot: { jid: message.sender, name: 'Unknown', interactionCount: 0 },
      groupBasics: null,
      blueprint: {
        metadata: { id: 'fallback', name: 'Safe Fallback', version: '0.1.0' },
        mindos: { drives: [] },
        action_space: { allowed_tools: [] },
        constraints: { read_only_fs: false, max_budget_usd: 1.0, max_iterations: 10 },
      },
      mode: 'UNIFIED',
    };
  }

  /**
   * Scans skills/survival/<nom_du_skill>/SKILL.md and extracts their YAML frontmatters
   */
  async _loadSurvivalSkills(): Promise<string> {
    const survivalDir = path.join(process.cwd(), 'skills', 'survival');
    let output = '';
    try {
      const entries = await readdir(survivalDir, { withFileTypes: true });
      const directories = entries.filter((e) => e.isDirectory());

      for (const dir of directories) {
        const skillPath = resolveWithinRoot(survivalDir, dir.name);
        let skillFileContent = '';
        let filePath = '';

        try {
          filePath = resolveWithinRoot(skillPath, 'SKILL.md');
          skillFileContent = await safeReadFile(filePath, 'utf-8');
        } catch {
          try {
            filePath = resolveWithinRoot(skillPath, 'skill.md');
            skillFileContent = await safeReadFile(filePath, 'utf-8');
          } catch {
            continue;
          }
        }

        const frontmatterMatch = skillFileContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (frontmatterMatch) {
          const rawYaml = frontmatterMatch[1];
          const relativePath = path.join('skills', 'survival', dir.name, path.basename(filePath));
          output += `---\n${rawYaml.trim()}\npath: "${relativePath}"\n---\n\n`;
        }
      }
    } catch {
      // Graceful degradation if skills/survival folder does not exist yet
    }
    return output.trim();
  }

  /**
   * Vide le cache d'autorité (à appeler si les admins changent)
   */
  clearAuthorityCache() {
    this.authorityCache.clear();
    console.log('[TieredContext] Cache autorité vidé');
  }
}

// Export singleton
export const tieredContextLoader = new TieredContextLoader();
export default tieredContextLoader;
