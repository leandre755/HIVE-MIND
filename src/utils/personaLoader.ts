import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeReadFileSync } from './safeFs.js';

export interface PersonaConfig {
  name: string;
  role: string;
  languageStyle: string;
}

const currentDir = dirname(fileURLToPath(import.meta.url));

function parseLine(line: string, key: string, defaultValue: string): string {
  if (!line.startsWith(`${key}:`)) return defaultValue;
  let val = line.substring(key.length + 1).trim();
  if (val.startsWith('"') && val.endsWith('"')) {
    val = val.substring(1, val.length - 1);
    val = val.replaceAll(String.raw`\"`, '"');
  } else if (val.startsWith("'") && val.endsWith("'")) {
    val = val.substring(1, val.length - 1);
    val = val.replaceAll("''", "'");
  }
  return val;
}

function parseFrontmatter(frontmatter: string): { name: string; role: string } {
  const result = { name: 'HIVE-MIND', role: 'Assistant' };
  const lines = frontmatter.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('name:')) {
      result.name = parseLine(trimmed, 'name', 'HIVE-MIND');
    } else if (trimmed.startsWith('role:')) {
      result.role = parseLine(trimmed, 'role', 'Assistant');
    }
  }
  return result;
}

function parsePersonaContent(content: string): PersonaConfig {
  const lines = content.split('\n');
  let frontmatterStart = -1;
  let frontmatterEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines.at(i)?.trim() === '---') {
      if (frontmatterStart === -1) {
        frontmatterStart = i;
      } else if (frontmatterEnd === -1) {
        frontmatterEnd = i;
        break;
      }
    }
  }

  if (frontmatterStart !== -1 && frontmatterEnd !== -1 && frontmatterStart < frontmatterEnd) {
    const frontmatter = lines.slice(frontmatterStart + 1, frontmatterEnd).join('\n');
    const markdownBody = lines
      .slice(frontmatterEnd + 1)
      .join('\n')
      .trim();
    const parsed = parseFrontmatter(frontmatter);

    return {
      name: parsed.name,
      role: parsed.role,
      languageStyle: markdownBody,
    };
  }

  return {
    name: 'HIVE-MIND',
    role: 'Assistant',
    languageStyle: content.trim(),
  };
}

export function loadPersona(): PersonaConfig {
  try {
    const personaPath = join(currentDir, '..', 'persona', 'persona.md');
    const content = safeReadFileSync(personaPath, 'utf-8');
    return parsePersonaContent(content);
  } catch {
    console.warn('[PersonaLoader] Error reading persona.md, using fallback.');
    return {
      name: 'HIVE-MIND',
      role: 'Assistant',
      languageStyle:
        'You communicate in a neutral, technical, and precise manner. You avoid filler words and focus directly on the task.',
    };
  }
}

export const persona = loadPersona();
