import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
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
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.substring(1, val.length - 1);
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
  const frontmatterStart = content.indexOf('---');
  const frontmatterEnd =
    frontmatterStart !== -1 ? content.indexOf('---', frontmatterStart + 3) : -1;

  if (frontmatterStart !== -1 && frontmatterEnd !== -1) {
    const frontmatter = content.substring(frontmatterStart + 3, frontmatterEnd);
    const markdownBody = content.substring(frontmatterEnd + 3).trim();
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
