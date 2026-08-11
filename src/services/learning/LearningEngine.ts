import { safeReaddir, safeReadFile } from '../../utils/safeFs.js';
import { join, basename } from 'path';
import { providerRouter } from '../../providers/index.js';
import { factsMemory } from '../memory.js';
import { workingMemory } from '../workingMemory.js';
import { tryParseJson } from '../../utils/ResponseFormatEnforcer.js';
import { eventBus, BotEvents } from '../../core/events.js';

interface ExtractedInsight {
  readonly type: string;
  readonly key: string;
  readonly value: string;
}

interface SkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly yamlBlock: string;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function parseYamlFrontmatter(frontmatter: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = frontmatter.split(/\r?\n/);
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.substring(1, val.length - 1);
      }
      Reflect.set(result, key, val);
    }
  }
  return result;
}

export const learningEngine = {
  async extractInsights(chatId: string): Promise<void> {
    console.log(`[MAPLE] 🧠 Extraction d'insights pour ${chatId}...`);

    // 1. Lire la mémoire de travail (les derniers messages)
    const context = await workingMemory.getContext(chatId, 20);
    if (context.length < 4) return; // Pas assez de matière

    eventBus.publish(BotEvents.SERVICE_START, {
      service: 'MAPLE',
      action: `extracting insights for ${chatId}`,
      timestamp: Date.now(),
    });

    const transcript = context
      .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
      .join('\n');

    // 2. Prompt MAPLE strict
    const prompt = `
You are the MAPLE Background Learner. Analyze this conversation and extract structured insights about the user.
Categories:
- [fact]: Static attributes (Role, tech stack, location)
- [pref]: Behavioral preferences (Tone, verbosity, likes/dislikes)
- [goal]: Implicit or explicit long-term goals

Conversation:
${transcript}

<output_format>
Return ONLY a valid JSON array matching this schema:
[{"type": "fact|pref|goal", "key": "short_name", "value": "detailed insight"}]

Few-shot examples:
[
  {"type": "fact", "key": "preferred_language", "value": "TypeScript"},
  {"type": "pref", "key": "tone_preference", "value": "Prefers detailed technical explanations with code snippets"},
  {"type": "goal", "key": "current_project", "value": "Deploying HIVE-MIND on Railway infrastructure"}
]
</output_format>`;

    try {
      const response = await providerRouter.chat(
        [
          { role: 'system', content: 'You are an objective data extractor. Output JSON only.' },
          { role: 'user', content: prompt },
        ],
        { category: 'FAST_CHAT', temperature: 0.1 },
      );

      if (!response?.content) return;

      let insights: ExtractedInsight[] = [];
      try {
        insights = tryParseJson<ExtractedInsight[]>(response.content);
      } catch {
        // Fallback sans regex en cas de bruit autour
        const firstBracket = response.content.indexOf('[');
        const lastBracket = response.content.lastIndexOf(']');
        if (firstBracket === -1 || lastBracket <= firstBracket) return;
        insights = tryParseJson<ExtractedInsight[]>(
          response.content.slice(firstBracket, lastBracket + 1),
        );
      }

      // 3. Sauvegarder dans la DB avec la taxonomie MAPLE
      for (const insight of insights) {
        if (!insight.type || !insight.key || !insight.value) continue;
        const factKey = `${insight.type.toLowerCase()}:${insight.key.toLowerCase().replace(/\s+/g, '_')}`;
        await factsMemory.remember(chatId, factKey, insight.value);
        console.log(`[MAPLE] ✨ Appris : ${factKey} = ${insight.value}`);
      }
    } catch (error: unknown) {
      console.error('[MAPLE] Erreur extraction:', extractErrorMessage(error));
    } finally {
      eventBus.publish(BotEvents.SERVICE_END, {
        service: 'MAPLE',
        timestamp: Date.now(),
      });
    }
  },

  async getAllExpertSkills(): Promise<SkillDefinition[]> {
    const skillsDir = join(process.cwd(), 'skills');
    const skills: SkillDefinition[] = [];
    try {
      const entries = (await safeReaddir(skillsDir, {
        withFileTypes: true,
      })) as import('fs').Dirent[];
      const directories = entries.filter((e) => e.isDirectory() && e.name !== 'survival');

      for (const dir of directories) {
        const skillPath = join(skillsDir, dir.name);
        let skillFileContent = '';
        let filePath = '';

        try {
          filePath = join(skillPath, 'SKILL.md');
          skillFileContent = await safeReadFile(filePath);
        } catch {
          try {
            filePath = join(skillPath, 'skill.md');
            skillFileContent = await safeReadFile(filePath);
          } catch {
            continue;
          }
        }

        const frontmatterMatch = skillFileContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (frontmatterMatch) {
          const rawYaml = frontmatterMatch[1];
          const relativePath = join('skills', dir.name, basename(filePath));
          const yamlBlock = `---\n${rawYaml.trim()}\npath: "${relativePath}"\n---`;
          const parsed = parseYamlFrontmatter(rawYaml);
          skills.push({
            name: parsed.name || dir.name,
            description: parsed.description || '',
            path: relativePath,
            yamlBlock,
          });
        }
      }
    } catch (error) {
      console.error('[LearningEngine] Error reading expert skills:', extractErrorMessage(error));
    }
    return skills;
  },

  async routeSkills(
    userMessage: string,
    chatId: string,
  ): Promise<{ yamlBlock: string; comments: string[] } | null> {
    const skills = await this.getAllExpertSkills();
    if (skills.length === 0) return null;

    const prompt = `You are the HIVE-MIND Skill Router. Given a user query and a list of available expert skills, select the single best matching skill if and only if it directly helps resolve the user's intent. If no skill is highly relevant, return null.

User Query: "${userMessage}"

Available Skills:
${skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')}

<output_format>
Return ONLY a valid JSON object matching this schema:
{ "selected_skill": "name_of_skill" | null }
</output_format>`;

    try {
      const response = await providerRouter.chat(
        [
          {
            role: 'system',
            content: 'You are an objective classification tool. Output JSON only.',
          },
          { role: 'user', content: prompt },
        ],
        { category: 'FAST_CHAT', temperature: 0.1 },
      );

      if (!response?.content) return null;

      let parsed: { selected_skill: string | null } = { selected_skill: null };
      try {
        parsed = tryParseJson<{ selected_skill: string | null }>(response.content);
      } catch {
        const firstBrace = response.content.indexOf('{');
        const lastBrace = response.content.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          parsed = tryParseJson<{ selected_skill: string | null }>(
            response.content.slice(firstBrace, lastBrace + 1),
          );
        }
      }

      if (!parsed.selected_skill) return null;

      const selected = skills.find((s) => s.name === parsed.selected_skill);
      if (!selected) return null;

      const comments = await this.getCommentsForSkill(selected.name, chatId, userMessage);

      return {
        yamlBlock: selected.yamlBlock,
        comments,
      };
    } catch (error) {
      console.error('[LearningEngine] Error routing skills:', extractErrorMessage(error));
      return null;
    }
  },

  async getCommentsForSkill(
    skillName: string,
    chatId: string,
    userMessage: string,
  ): Promise<string[]> {
    try {
      const preferences = await factsMemory.getAll(chatId);
      const userPrefsFiltered = Object.entries(preferences)
        .filter(([key]) => key.startsWith('pref:'))
        .map(([key, val]) => `${key.replace('pref:', '')}: ${val}`);

      if (userPrefsFiltered.length === 0) return [];

      const prompt = `You are the HIVE-MIND Skill Advisor. Given the selected skill "${skillName}", the user's query "${userMessage}", and the known user preferences:
${userPrefsFiltered.map((p) => `- ${p}`).join('\n')}

Write 1-2 concise, actionable advices or guidelines for the agent to follow when executing this skill. Make sure to reference specific user preferences if they relate to the task (e.g. style, theme, tone, tools).
Example: "user dark theme is better in this situation, do ..."

<output_format>
Return ONLY a valid JSON array of strings:
["advice 1", "advice 2"]
</output_format>`;

      const response = await providerRouter.chat(
        [
          { role: 'system', content: 'You are a technical advisor. Output JSON only.' },
          { role: 'user', content: prompt },
        ],
        { category: 'FAST_CHAT', temperature: 0.1 },
      );

      if (!response?.content) return [];

      try {
        return tryParseJson<string[]>(response.content);
      } catch {
        const firstBracket = response.content.indexOf('[');
        const lastBracket = response.content.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket > firstBracket) {
          return tryParseJson<string[]>(response.content.slice(firstBracket, lastBracket + 1));
        }
      }
    } catch (error) {
      console.error('[LearningEngine] Error generating comments:', extractErrorMessage(error));
    }
    return [];
  },
};
