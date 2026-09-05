import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { createRequire } from 'node:module';

const cjsRequire = createRequire(import.meta.url);
const {
  getLeadingIndent,
  checkFenceTransition,
  extractSections,
  parseOpeningFence,
  isClosingFence,
  filterNonFenceLines,
  evaluateIssueFormat,
  buildTriageCommentBody,
  runTriage,
} = cjsRequire('../../../../.github/scripts/triage_issue.cjs');

function createTriageMocks() {
  const mockGithub = {
    rest: {
      issues: {
        get: jest.fn<(params?: unknown) => Promise<unknown>>(),
        addLabels: jest.fn<(params?: unknown) => Promise<unknown>>().mockResolvedValue({}),
        removeLabel: jest.fn<(params?: unknown) => Promise<unknown>>().mockResolvedValue({}),
        createComment: jest.fn<(params?: unknown) => Promise<unknown>>().mockResolvedValue({}),
        updateComment: jest.fn<(params?: unknown) => Promise<unknown>>().mockResolvedValue({}),
      },
    },
    paginate: jest
      .fn<(fn: unknown, params?: unknown) => Promise<unknown[]>>()
      .mockResolvedValue([]),
  };

  const mockContext = {
    eventName: 'issues' as string | undefined,
    payload: {} as { action?: string; issue?: unknown },
    repo: { owner: 'test-owner', repo: 'test-repo' },
  };

  const mockCore = {
    setFailed: jest.fn<(msg: string) => void>(),
    warning: jest.fn<(msg: string) => void>(),
  };

  return { mockGithub, mockContext, mockCore };
}

describe('Issue Triage - extractSections', () => {
  it('should extract and normalize h2 headers and content', () => {
    const body = [
      'Intro text that is ignored',
      '## 🐛 Describe the Bug',
      'This is a real bug description with sufficient details.',
      '## 📋 Steps to Reproduce',
      '1. Step one\n2. Step two',
      '## ✅ Expected Behavior',
      'It should work without crashing.',
      '## ❌ Actual Behavior',
      'It throws a TypeError.',
    ].join('\n');

    const sections = extractSections(body);
    expect(sections.get('describe the bug')).toBe(
      'This is a real bug description with sufficient details.',
    );
    expect(sections.get('steps to reproduce')).toBe('1. Step one\n2. Step two');
    expect(sections.get('expected behavior')).toBe('It should work without crashing.');
    expect(sections.get('actual behavior')).toBe('It throws a TypeError.');
  });

  it('should not break section extraction when code block contains markdown h2 headers', () => {
    const body = [
      '## 🐛 Describe the Bug',
      'Here is the code block with a header:',
      '```markdown',
      '## Steps to Reproduce',
      '1. Bug inside code block',
      '```',
      'End of the description.',
      '## 📋 Steps to Reproduce',
      '1. Real step one\n2. Real step two',
      '## ✅ Expected Behavior',
      'Should work properly.',
      '## ❌ Actual Behavior',
      'Crashes with exception.',
    ].join('\n');

    const sections = extractSections(body);
    expect(sections.get('describe the bug')).toContain('## Steps to Reproduce');
    expect(sections.get('steps to reproduce')).toBe('1. Real step one\n2. Real step two');
  });

  it('should normalize headers without emojis or special characters', () => {
    const body = "## 🤔 What's Missing or Unclear?\nSomething is missing.";
    const sections = extractSections(body);
    expect(sections.get('whats missing or unclear')).toBe('Something is missing.');
  });

  it('should ignore markdown h2 headers inside an unclosed code block', () => {
    const body = [
      '## 🐛 Describe the Bug',
      'Beginning of the bug description.',
      '```typescript',
      '// Unclosed code block without closing fence',
      '## 📋 Steps to Reproduce',
      'const a = 1;',
      '## ✅ Expected Behavior',
    ].join('\n');

    const sections = extractSections(body);
    expect(sections.get('describe the bug')).toContain('## 📋 Steps to Reproduce');
    expect(sections.has('steps to reproduce')).toBe(false);
    expect(sections.has('expected behavior')).toBe(false);
  });

  it('should ignore markdown h2 headers inside tilde code fences', () => {
    const body = [
      '## 🐛 Describe the Bug',
      'Beginning of description with tilde fence:',
      '~~~markdown',
      '## 📋 Steps to Reproduce',
      'Step inside tildes',
      '~~~',
      'After tilde fence.',
      '## 📋 Steps to Reproduce',
      'Real step 1',
    ].join('\n');

    const sections = extractSections(body);
    expect(sections.get('describe the bug')).toContain('## 📋 Steps to Reproduce');
    expect(sections.get('steps to reproduce')).toBe('Real step 1');
  });

  it('should enforce strict delimiter matching between backticks and tildes', () => {
    const body = [
      '## 🐛 Describe the Bug',
      '~~~',
      '```',
      '## 📋 Steps to Reproduce',
      '```',
      '~~~',
      '## 📋 Steps to Reproduce',
      'Real step 1',
    ].join('\n');

    const sections = extractSections(body);
    expect(sections.get('describe the bug')).toContain('## 📋 Steps to Reproduce');
    expect(sections.get('steps to reproduce')).toBe('Real step 1');
  });

  it('should not close a code fence if closing line has fewer characters than opening fence', () => {
    const body = [
      '## 🐛 Describe the Bug',
      '````',
      '## 📋 Steps to Reproduce',
      '```',
      'Still in code block',
      '````',
      '## 📋 Steps to Reproduce',
      'Real step 1',
    ].join('\n');

    const sections = extractSections(body);
    expect(sections.get('describe the bug')).toContain('## 📋 Steps to Reproduce');
    expect(sections.get('steps to reproduce')).toBe('Real step 1');
  });

  it('should not interpret four-space indented backticks as code fences (CommonMark compliance)', () => {
    const body = [
      '    ```',
      '## 📋 Steps to Reproduce',
      '1. Step one\n2. Step two',
      '    ```',
      '## 🐛 Describe the Bug',
      'Real bug description with sufficient details.',
    ].join('\n');

    const sections = extractSections(body);
    expect(sections.has('steps to reproduce')).toBe(true);
    expect(sections.get('steps to reproduce')).toBe('1. Step one\n2. Step two\n    ```');
    expect(sections.get('describe the bug')).toBe('Real bug description with sufficient details.');
  });

  it('should not close an active fence when encountering a four-space indented delimiter', () => {
    const body = [
      '## 🐛 Describe the Bug',
      '```typescript',
      '    ```',
      '    // indented inside code fence',
      '    ```',
      '```',
      '## 📋 Steps to Reproduce',
      '1. Step one',
    ].join('\n');

    const sections = extractSections(body);
    expect(sections.get('describe the bug')).toContain('// indented inside code fence');
    expect(sections.get('steps to reproduce')).toBe('1. Step one');
  });

  it('should handle empty or null body gracefully', () => {
    expect(extractSections(null).size).toBe(0);
    expect(extractSections('').size).toBe(0);
  });
});

describe('Issue Triage - parseOpeningFence and isClosingFence', () => {
  it('should parse valid opening fences with backticks and tildes', () => {
    expect(parseOpeningFence('```')).toEqual({ char: '`', length: 3 });
    expect(parseOpeningFence('````json')).toEqual({ char: '`', length: 4 });
    expect(parseOpeningFence('``` markdown')).toEqual({ char: '`', length: 3 });
    expect(parseOpeningFence('~~~')).toEqual({ char: '~', length: 3 });
    expect(parseOpeningFence('~~~~markdown info')).toEqual({ char: '~', length: 4 });
    expect(parseOpeningFence('~~~ markdown')).toEqual({ char: '~', length: 3 });
  });

  it('should reject invalid opening fences', () => {
    expect(parseOpeningFence('``')).toBeNull();
    expect(parseOpeningFence('~~')).toBeNull();
    expect(parseOpeningFence('```info`with`backtick')).toBeNull();
    expect(parseOpeningFence('normal text')).toBeNull();
    expect(parseOpeningFence('# Heading')).toBeNull();
  });

  it('should correctly evaluate closing fences', () => {
    const backtickFence = { char: '`', length: 3 };
    const tildeFence = { char: '~', length: 4 };

    expect(isClosingFence('```', backtickFence)).toBe(true);
    expect(isClosingFence('````', backtickFence)).toBe(true);
    expect(isClosingFence('``', backtickFence)).toBe(false);
    expect(isClosingFence('~~~', backtickFence)).toBe(false);
    expect(isClosingFence('``` text', backtickFence)).toBe(false);

    expect(isClosingFence('~~~~', tildeFence)).toBe(true);
    expect(isClosingFence('~~~~~  ', tildeFence)).toBe(true);
    expect(isClosingFence('~~~', tildeFence)).toBe(false);
    expect(isClosingFence('````', tildeFence)).toBe(false);
  });
});

describe('Issue Triage - getLeadingIndent and checkFenceTransition', () => {
  it('should correctly calculate leading indent in spaces and tabs', () => {
    expect(getLeadingIndent('```')).toBe(0);
    expect(getLeadingIndent('   ```')).toBe(3);
    expect(getLeadingIndent('    ```')).toBe(4);
    expect(getLeadingIndent('\t```')).toBe(4);
    expect(getLeadingIndent('  \t```')).toBe(6);
  });

  it('should ignore fences with 4 or more spaces of indentation in checkFenceTransition', () => {
    expect(checkFenceTransition('    ```', null)).toEqual({
      nextFence: null,
      inFence: false,
    });

    const activeFence = { char: '`', length: 3 };
    expect(checkFenceTransition('    ```', activeFence)).toEqual({
      nextFence: activeFence,
      inFence: true,
    });
  });

  it('should recognize fences with up to 3 spaces of indentation in checkFenceTransition', () => {
    const openRes = checkFenceTransition('   ```typescript', null);
    expect(openRes.inFence).toBe(true);
    expect(openRes.nextFence).toEqual({ char: '`', length: 3 });

    const closeRes = checkFenceTransition('  ```', openRes.nextFence);
    expect(closeRes.inFence).toBe(true);
    expect(closeRes.nextFence).toBeNull();
  });
});

describe('Issue Triage - filterNonFenceLines', () => {
  it('should strip empty code fences with whitespace preceding info string for backticks and tildes', () => {
    const backtickLines = ['``` markdown', '```'];
    expect(filterNonFenceLines(backtickLines)).toEqual([]);

    const tildeLines = ['~~~ markdown', '~~~'];
    expect(filterNonFenceLines(tildeLines)).toEqual([]);
  });

  it('should preserve substantive content inside code fences while discarding delimiters', () => {
    const lines = ['``` typescript', 'const port = 3000;', '```'];
    expect(filterNonFenceLines(lines)).toEqual(['const port = 3000;']);
  });

  it('should preserve text outside of code fences', () => {
    const lines = ['Line 1 outside', '```', 'inside code', '```', 'Line 2 outside'];
    expect(filterNonFenceLines(lines)).toEqual(['Line 1 outside', 'inside code', 'Line 2 outside']);
  });

  it('should preserve four-space indented backtick lines as content rather than stripping them', () => {
    const lines = ['    ```', 'content', '    ```'];
    expect(filterNonFenceLines(lines)).toEqual(['    ```', 'content', '    ```']);
  });
});

describe('Issue Triage - evaluateIssueFormat Bug & Features', () => {
  it('should validate a complete and properly filled bug report and remove needs-triage', () => {
    const issue = {
      title: '[BUG] Crash on startup when redis is unreachable',
      body: [
        '## 🐛 Describe the Bug',
        'The bot application terminates abruptly when Redis is not running locally.',
        '## 📋 Steps to Reproduce',
        '1. Stop Redis service with systemctl stop redis\n2. Run npm start\n3. Observe process crash',
        '## ✅ Expected Behavior',
        'The bot should fall back to in-memory state manager or report clear connection error.',
        '## ❌ Actual Behavior',
        'Uncaught ECONNREFUSED throws directly to top-level runtime.',
      ].join('\n'),
      labels: [{ name: 'bug' }, { name: 'needs-triage' }],
    };

    const result = evaluateIssueFormat(issue);
    expect(result.isValid).toBe(true);
    expect(result.templateType).toBe('bug');
    expect(result.labelsToAdd).toContain('bug');
    expect(result.labelsToAdd).not.toContain('needs-triage');
    expect(result.labelsToRemove).toContain('needs-triage');
  });

  it('should validate bug report where Actual Behavior contains only a stack trace inside a code block', () => {
    const issue = {
      title: '[BUG] TypeError in socket handler',
      body: [
        '## 🐛 Describe the Bug',
        'The bot crashes immediately on startup when socket is closed.',
        '## 📋 Steps to Reproduce',
        '1. Run npm start\n2. Close network connection abruptly',
        '## ✅ Expected Behavior',
        'Should catch the error and reconnect gracefully.',
        '## ❌ Actual Behavior',
        '```',
        'TypeError: Cannot read properties of undefined (reading "status")',
        '    at Socket.emit (node:events:517:28)',
        '```',
      ].join('\n'),
      labels: [{ name: 'needs-triage' }],
    };

    const result = evaluateIssueFormat(issue);
    expect(result.isValid).toBe(true);
    expect(result.templateType).toBe('bug');
    expect(result.labelsToRemove).toContain('needs-triage');
    expect(result.labelsToAdd).toContain('bug');
  });

  it('should mark bug report invalid if scroll down placeholder is left in steps', () => {
    const issue = {
      title: '[BUG] Something is broken',
      body: [
        '## 🐛 Describe the Bug',
        'The application breaks on startup.',
        '## 📋 Steps to Reproduce',
        "1. Login to account\n2. Click settings\n3. Scroll down to '...'\n4. Observe error message",
        '## ✅ Expected Behavior',
        'Should work fine.',
        '## ❌ Actual Behavior',
        'Throws error.',
      ].join('\n'),
    };

    const result = evaluateIssueFormat(issue);
    expect(result.isValid).toBe(false);
    expect(result.labelsToAdd).toContain('needs-triage');
    expect(result.reason).toContain("scroll down to '...'");
  });

  it('should mark bug report invalid if required section is missing or title empty', () => {
    const missingSection = {
      title: '[BUG] Incomplete bug report',
      body: '## 🐛 Describe the Bug\nSomething crashed.',
    };
    expect(evaluateIssueFormat(missingSection).isValid).toBe(false);

    const emptyTitle = {
      title: '[BUG]  ',
      body: '## 🐛 Describe the Bug\nDetails...',
    };
    expect(evaluateIssueFormat(emptyTitle).isValid).toBe(false);
  });

  it('should validate a complete feature request and remove needs-triage', () => {
    const issue = {
      title: '[FEATURE] Support audio voice messages via Opus transcoding',
      body: [
        '## 💡 Feature Description',
        'Add automatic transcoding of inbound audio notes into standard 16kHz WAV format.',
        '## 🎯 Use Case',
        'Enables speech-to-text plugins to reliably process WhatsApp PTT voice messages without codec failures.',
        '## 🔍 Acceptance Criteria',
        '- Transcoding handles ogg/opus inputs seamlessly\n- Memory consumption stays bounded',
      ].join('\n'),
      labels: [{ name: 'enhancement' }, { name: 'needs-triage' }],
    };

    const result = evaluateIssueFormat(issue);
    expect(result.isValid).toBe(true);
    expect(result.templateType).toBe('feature');
    expect(result.labelsToAdd).toContain('enhancement');
    expect(result.labelsToAdd).not.toContain('needs-triage');
    expect(result.labelsToRemove).toContain('needs-triage');
  });

  it('should validate feature request where Acceptance Criteria has filled "- Criterion 1: ..." lines', () => {
    const issue = {
      title: '[FEATURE] Support audio transcoding',
      body: [
        '## 💡 Feature Description',
        'Add automatic transcoding of audio notes.',
        '## 🎯 Use Case',
        'Enables speech-to-text plugins to work without codec failures.',
        '## 🔍 Acceptance Criteria',
        '- Criterion 1: Transcoding accepts ogg/opus seamlessly',
        '- Criterion 2: Memory consumption stays bounded',
      ].join('\n'),
      labels: [{ name: 'enhancement' }, { name: 'needs-triage' }],
    };

    const result = evaluateIssueFormat(issue);
    expect(result.isValid).toBe(true);
    expect(result.labelsToRemove).toContain('needs-triage');
  });

  it('should mark feature request invalid if Use Case only contains example scenario markdown', () => {
    const issue = {
      title: '[FEATURE] Incomplete use case feature',
      body: [
        '## 💡 Feature Description',
        'A brand new audio transcoding feature.',
        '## 🎯 Use Case',
        'Describe the problem this feature would solve or the value it would provide.\n\n### Example scenario:\n```\nAs a [user/role], I want [feature], so that [benefit].\n```',
        '## 🔍 Acceptance Criteria',
        '- Real user criterion 1\n- Real user criterion 2',
      ].join('\n'),
    };

    const result = evaluateIssueFormat(issue);
    expect(result.isValid).toBe(false);
    expect(result.labelsToAdd).toContain('needs-triage');
    expect(result.reason).toContain("texte d'instruction par défaut");
  });
});

describe('Issue Triage - evaluateIssueFormat Fences and Regressions', () => {
  it('should reject bug report when a required section is only present inside a tilde fence', () => {
    const issue = {
      title: '[BUG] Missing expected behavior outside code block',
      body: [
        '## 🐛 Describe the Bug',
        'Here is the issue description with an embedded template snippet:',
        '~~~markdown',
        '## ✅ Expected Behavior',
        'This is fake expected behavior inside a tilde block.',
        '~~~',
        '## 📋 Steps to Reproduce',
        '1. Step one\n2. Step two',
        '## ❌ Actual Behavior',
        'Crash occurs on line 12.',
      ].join('\n'),
      labels: [{ name: 'needs-triage' }],
    };

    const result = evaluateIssueFormat(issue);
    expect(result.isValid).toBe(false);
    expect(result.labelsToAdd).toContain('needs-triage');
    expect(result.labelsToRemove).not.toContain('needs-triage');
    expect(result.reason).toContain('Expected Behavior');
  });

  it('should validate bug report when required sections exist and tilde block contains code', () => {
    const issue = {
      title: '[BUG] Failure parsing logs with tildes',
      body: [
        '## 🐛 Describe the Bug',
        'Detailed description of the bug.',
        '~~~log',
        'Error: failure at line 42',
        '~~~',
        '## 📋 Steps to Reproduce',
        '1. Run command\n2. Check log',
        '## ✅ Expected Behavior',
        'Log should be parsed properly.',
        '## ❌ Actual Behavior',
        'Parsing fails.',
      ].join('\n'),
      labels: [{ name: 'needs-triage' }],
    };

    const result = evaluateIssueFormat(issue);
    expect(result.isValid).toBe(true);
    expect(result.labelsToRemove).toContain('needs-triage');
    expect(result.labelsToAdd).toContain('bug');
  });

  it('should reject issue when a section contains only an empty code fence with whitespace before info string', () => {
    const issueBackticks = {
      title: '[BUG] Empty backtick code block with space',
      body: [
        '## 🐛 Describe the Bug',
        'Valid description of the bug here.',
        '## 📋 Steps to Reproduce',
        '``` markdown',
        '```',
        '## ✅ Expected Behavior',
        'Should work fine.',
        '## ❌ Actual Behavior',
        'Crashes with error.',
      ].join('\n'),
      labels: [{ name: 'needs-triage' }],
    };
    const resBackticks = evaluateIssueFormat(issueBackticks);
    expect(resBackticks.isValid).toBe(false);
    expect(resBackticks.labelsToAdd).toContain('needs-triage');
    expect(resBackticks.reason).toContain('Steps to Reproduce');

    const issueTildes = {
      title: '[BUG] Empty tilde code block with space',
      body: [
        '## 🐛 Describe the Bug',
        'Valid description of the bug here.',
        '## 📋 Steps to Reproduce',
        '1. Step one\n2. Step two',
        '## ✅ Expected Behavior',
        '~~~ markdown',
        '~~~',
        '## ❌ Actual Behavior',
        'Crashes with error.',
      ].join('\n'),
      labels: [{ name: 'needs-triage' }],
    };
    const resTildes = evaluateIssueFormat(issueTildes);
    expect(resTildes.isValid).toBe(false);
    expect(resTildes.labelsToAdd).toContain('needs-triage');
    expect(resTildes.reason).toContain('Expected Behavior');
  });
});

describe('Issue Triage - evaluateIssueFormat Docs & Freeform', () => {
  it('should accept issue retaining guide prompts when substantive answer is written below', () => {
    const issue = {
      title: '[DOCS] Update configuration keys documentation',
      body: [
        '## 📖 Documentation Issue',
        'Describe what documentation needs to be added, updated, or clarified.\nThe REDIS_PORT configuration variable is undocumented in docs/env.md.',
        '## 📍 Affected Section',
        'Where in the documentation is this issue? (e.g., README.md, docs/api.md, docs/getting-started.md)\nSection 4 of docs/configuration.md.',
        "## 🤔 What's Missing or Unclear?",
        'Explain what information is missing, outdated, or confusing:\nNo mention that default port is 6379.',
        '## ✏️ Suggested Changes',
        'Provide an example or draft of how the documentation should be improved:\nAdd REDIS_PORT=6379 under the Redis heading.',
      ].join('\n'),
    };

    const result = evaluateIssueFormat(issue);
    expect(result.isValid).toBe(true);
    expect(result.templateType).toBe('documentation');
    expect(result.labelsToAdd).toContain('documentation');
    expect(result.labelsToRemove).toContain('needs-triage');
  });

  it('should mark docs report invalid if Affected Section only contains default guide text', () => {
    const issue = {
      title: '[DOCS] Incomplete documentation issue',
      body: [
        '## 📖 Documentation Issue',
        'Clear documentation issue explanation here.',
        '## 📍 Affected Section',
        'Where in the documentation is this issue? (e.g., README.md, docs/api.md, docs/getting-started.md)',
        "## 🤔 What's Missing or Unclear?",
        'Details about what is missing.',
        '## ✏️ Suggested Changes',
        'Concrete change suggestion.',
      ].join('\n'),
    };

    const result = evaluateIssueFormat(issue);
    expect(result.isValid).toBe(false);
    expect(result.labelsToAdd).toContain('needs-triage');
    expect(result.reason).toContain("texte d'instruction par défaut");
  });

  it('should not strip user text containing the word example in documentation issue', () => {
    const issue = {
      title: '[DOCS] Add example for provider config',
      body: [
        '## 📖 Documentation Issue',
        'We need an example of custom provider setup.',
        '## 📍 Affected Section',
        'docs/providers.md under the custom adapter header.',
        "## 🤔 What's Missing or Unclear?",
        'The example for setting credentials is missing.',
        '## ✏️ Suggested Changes',
        'Add an example configuration block with sample API keys.',
      ].join('\n'),
    };

    const result = evaluateIssueFormat(issue);
    expect(result.isValid).toBe(true);
    expect(result.labelsToRemove).toContain('needs-triage');
  });

  it('should refuse unofficial [DOC] prefix and retain needs-triage as freeform issue', () => {
    const issue = {
      title: '[DOC] Fix configuration documentation',
      body: [
        '## 📖 Documentation Issue',
        'Detailed documentation issue description.',
        '## 📍 Affected Section',
        'Section 2 of README.md.',
        "## 🤔 What's Missing or Unclear?",
        'The port description is missing.',
        '## ✏️ Suggested Changes',
        'Add port description.',
      ].join('\n'),
      labels: [{ name: 'needs-triage' }],
    };

    const result = evaluateIssueFormat(issue);
    expect(result.isValid).toBe(false);
    expect(result.templateType).toBe('freeform');
    expect(result.labelsToAdd).toContain('needs-triage');
    expect(result.labelsToRemove).not.toContain('needs-triage');
  });

  it('should assign needs-triage to freeform issue without recognized template prefix', () => {
    const issue = {
      title: 'Random question or request without template',
      body: 'How do I run this bot on an ARM64 server?',
    };

    const result = evaluateIssueFormat(issue);
    expect(result.isValid).toBe(false);
    expect(result.templateType).toBe('freeform');
    expect(result.labelsToAdd).toContain('needs-triage');
    expect(result.labelsToAdd).toContain('question');
  });

  it('should detect critical priority and security keywords and handle empty inputs', () => {
    const issue = {
      title: '[BUG] Critical vulnerability in command execution',
      body: [
        '## 🐛 Describe the Bug',
        'A remote exploit allows arbitrary command execution. Urgent blocking security flaw.',
        '## 📋 Steps to Reproduce',
        'Send malicious payload with malformed arguments.',
        '## ✅ Expected Behavior',
        'Sanitizer should reject invalid commands.',
        '## ❌ Actual Behavior',
        'Payload executes without authorization.',
      ].join('\n'),
    };

    const result = evaluateIssueFormat(issue);
    expect(result.isValid).toBe(true);
    expect(result.labelsToAdd).toContain('priority-high');
    expect(result.labelsToAdd).toContain('security');

    const emptyResult = evaluateIssueFormat({ title: '', body: '' });
    expect(emptyResult.isValid).toBe(false);
    expect(emptyResult.labelsToAdd).toContain('needs-triage');
  });

  it('should prioritize security and priority-high over thematic labels in freeform issues', () => {
    const issue = {
      title: 'Urgent security exploit in authentication module',
      body: 'We found a critical bug and vulnerability in session token verification. Help or question needed.',
    };

    const result = evaluateIssueFormat(issue);
    expect(result.isValid).toBe(false);
    expect(result.templateType).toBe('freeform');
    expect(result.labelsToAdd).toEqual(['needs-triage', 'priority-high', 'security', 'bug']);
    expect(result.labelsToAdd).not.toContain('question');
  });
});

describe('Issue Triage - runTriage Labels & Operations', () => {
  let mocks: ReturnType<typeof createTriageMocks>;

  beforeEach(() => {
    mocks = createTriageMocks();
  });

  it('should remove needs-triage and add bug label for valid bug report', async () => {
    const validIssue = {
      title: '[BUG] Crash on startup when redis is unreachable',
      body: [
        '## 🐛 Describe the Bug',
        'The bot application terminates abruptly when Redis is not running locally.',
        '## 📋 Steps to Reproduce',
        '1. Stop Redis service\n2. Run npm start',
        '## ✅ Expected Behavior',
        'The bot should fall back to memory mock.',
        '## ❌ Actual Behavior',
        'Uncaught ECONNREFUSED.',
      ].join('\n'),
      labels: [{ name: 'bug' }, { name: 'Needs-Triage' }],
    };

    mocks.mockContext.payload.issue = validIssue;

    await runTriage({
      github: mocks.mockGithub,
      context: mocks.mockContext,
      core: mocks.mockCore,
      issueNumber: 42,
    });

    expect(mocks.mockGithub.rest.issues.removeLabel).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 42,
      name: 'Needs-Triage',
    });

    expect(mocks.mockGithub.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 42,
      labels: ['bug'],
    });

    expect(mocks.mockGithub.rest.issues.createComment).toHaveBeenCalledTimes(1);
  });

  it('should handle 404 on removeLabel gracefully and continue triage', async () => {
    const validIssue = {
      title: '[BUG] Valid issue',
      body: [
        '## 🐛 Describe the Bug\nReal bug details here.',
        '## 📋 Steps to Reproduce\nReal steps to reproduce the issue.',
        '## ✅ Expected Behavior\nShould work completely fine.',
        '## ❌ Actual Behavior\nThrows an unhandled exception.',
      ].join('\n'),
      labels: [{ name: 'needs-triage' }],
    };
    mocks.mockContext.payload.issue = validIssue;

    const error404 = new Error('Not found') as Error & { status: number };
    error404.status = 404;
    mocks.mockGithub.rest.issues.removeLabel.mockRejectedValueOnce(error404);

    await runTriage({
      github: mocks.mockGithub,
      context: mocks.mockContext,
      core: mocks.mockCore,
      issueNumber: 101,
    });
    expect(mocks.mockCore.warning).not.toHaveBeenCalled();
    expect(mocks.mockCore.setFailed).not.toHaveBeenCalled();
    expect(mocks.mockGithub.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 101,
      labels: ['bug'],
    });
  });

  it('should fail and halt triage when removeLabel encounters a non-404 error', async () => {
    const validIssue = {
      title: '[BUG] Valid issue',
      body: [
        '## 🐛 Describe the Bug\nReal bug details here.',
        '## 📋 Steps to Reproduce\nReal steps to reproduce the issue.',
        '## ✅ Expected Behavior\nShould work completely fine.',
        '## ❌ Actual Behavior\nThrows an unhandled exception.',
      ].join('\n'),
      labels: [{ name: 'needs-triage' }],
    };
    mocks.mockContext.payload.issue = validIssue;

    const error500 = new Error('Internal Server Error') as Error & { status: number };
    error500.status = 500;
    mocks.mockGithub.rest.issues.removeLabel.mockRejectedValueOnce(error500);

    await runTriage({
      github: mocks.mockGithub,
      context: mocks.mockContext,
      core: mocks.mockCore,
      issueNumber: 102,
    });
    expect(mocks.mockCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('Internal Server Error'),
    );
    expect(mocks.mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("Échec critique lors du retrait de l'étiquette"),
    );
    expect(mocks.mockGithub.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(mocks.mockGithub.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('should fetch issue via REST API when context.payload.issue is undefined (workflow_dispatch)', async () => {
    const fetchedIssue = {
      title: '[BUG] Fetched issue',
      body: [
        '## 🐛 Describe the Bug\nFetched bug details here.',
        '## 📋 Steps to Reproduce\n1. Run the command with valid parameters.',
        '## ✅ Expected Behavior\nProcess should finish cleanly.',
        '## ❌ Actual Behavior\nProcess terminates with error code 1.',
      ].join('\n'),
      labels: [],
    };
    mocks.mockGithub.rest.issues.get.mockResolvedValueOnce({ data: fetchedIssue });

    await runTriage({
      github: mocks.mockGithub,
      context: mocks.mockContext,
      core: mocks.mockCore,
      issueNumber: 202,
    });

    expect(mocks.mockGithub.rest.issues.get).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 202,
    });
    expect(mocks.mockGithub.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 202,
      labels: ['bug'],
    });
  });

  it('should keep needs-triage and never call removeLabel for an invalid bug report', async () => {
    mocks.mockContext.payload.issue = {
      number: 404,
      title: '[BUG] Incomplete report',
      body: '## 🐛 Describe the Bug\nA clear and concise description of what the bug is.',
      labels: [{ name: 'needs-triage' }],
    };

    await runTriage({
      github: mocks.mockGithub,
      context: mocks.mockContext,
      core: mocks.mockCore,
      issueNumber: 404,
    });

    expect(mocks.mockGithub.rest.issues.removeLabel).not.toHaveBeenCalled();
    expect(mocks.mockGithub.rest.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: expect.arrayContaining(['needs-triage', 'bug']) }),
    );
  });

  it('should not re-add needs-triage on edit if needs-triage was not present in existing labels', async () => {
    mocks.mockContext.eventName = 'issues';
    mocks.mockContext.payload = {
      action: 'edited',
      issue: {
        number: 55,
        title: 'Freeform issue without template',
        body: 'Still freeform question.',
        labels: [{ name: 'question' }],
      },
    };

    await runTriage({
      github: mocks.mockGithub,
      context: mocks.mockContext,
      core: mocks.mockCore,
      issueNumber: 55,
    });

    expect(mocks.mockGithub.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 55,
      labels: ['question'],
    });
  });
});

describe('Issue Triage - runTriage Comments & Idempotence', () => {
  let mocks: ReturnType<typeof createTriageMocks>;

  beforeEach(() => {
    mocks = createTriageMocks();
  });

  it('should update existing triage comment if marker is found', async () => {
    mocks.mockContext.payload.issue = {
      title: 'Freeform issue',
      body: 'Some questions.',
      labels: [],
    };

    mocks.mockGithub.paginate.mockResolvedValueOnce([
      {
        id: 42,
        user: { login: 'github-actions[bot]', type: 'Bot' },
        body: '<!-- coding-stuff:issue-triage:v1 -->\nPrevious automated review',
      },
    ]);

    await runTriage({
      github: mocks.mockGithub,
      context: mocks.mockContext,
      core: mocks.mockCore,
      issueNumber: 301,
    });

    expect(mocks.mockGithub.rest.issues.updateComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 42,
      body: expect.stringContaining('<!-- coding-stuff:issue-triage:v1 -->'),
    });
    expect(mocks.mockGithub.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('should ignore comment with marker if authored by a human user and create a new comment instead', async () => {
    mocks.mockContext.payload.issue = {
      title: 'Freeform issue',
      body: 'Some questions.',
      labels: [],
    };

    mocks.mockGithub.paginate.mockResolvedValueOnce([
      {
        id: 77,
        user: { login: 'some-user', type: 'User' },
        body: '<!-- coding-stuff:issue-triage:v1 -->\nSpoofed marker by user',
      },
    ]);

    await runTriage({
      github: mocks.mockGithub,
      context: mocks.mockContext,
      core: mocks.mockCore,
      issueNumber: 302,
    });

    expect(mocks.mockGithub.rest.issues.updateComment).not.toHaveBeenCalled();
    expect(mocks.mockGithub.rest.issues.createComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 302,
      body: expect.stringContaining('<!-- coding-stuff:issue-triage:v1 -->'),
    });
  });

  it('should update existing comment when authored by github-actions[bot]', async () => {
    mocks.mockContext.payload.issue = {
      title: 'Freeform issue',
      body: 'Some questions.',
      labels: [],
    };

    mocks.mockGithub.paginate.mockResolvedValueOnce([
      {
        id: 99,
        user: { login: 'github-actions[bot]', type: 'Bot' },
        body: '<!-- coding-stuff:issue-triage:v1 -->\nOld bot comment',
      },
    ]);

    await runTriage({
      github: mocks.mockGithub,
      context: mocks.mockContext,
      core: mocks.mockCore,
      issueNumber: 303,
    });

    expect(mocks.mockGithub.rest.issues.updateComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 99,
      body: expect.stringContaining('<!-- coding-stuff:issue-triage:v1 -->'),
    });
    expect(mocks.mockGithub.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('should not update a comment bearing marker if authored by a foreign bot (e.g. dependabot[bot])', async () => {
    mocks.mockContext.payload.issue = {
      title: 'Freeform issue',
      body: 'Some questions.',
      labels: [],
    };

    mocks.mockGithub.paginate.mockResolvedValueOnce([
      {
        id: 4242,
        user: { login: 'dependabot[bot]', type: 'Bot' },
        body: '<!-- coding-stuff:issue-triage:v1 -->\nForeign bot comment',
      },
    ]);

    await runTriage({
      github: mocks.mockGithub,
      context: mocks.mockContext,
      core: mocks.mockCore,
      issueNumber: 304,
    });

    expect(mocks.mockGithub.rest.issues.updateComment).not.toHaveBeenCalled();
    expect(mocks.mockGithub.rest.issues.createComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 304,
      body: expect.stringContaining('<!-- coding-stuff:issue-triage:v1 -->'),
    });
  });
});

describe('Issue Triage - runTriage Guard Conditions & Environment', () => {
  let mocks: ReturnType<typeof createTriageMocks>;

  beforeEach(() => {
    mocks = createTriageMocks();
  });

  it('should fail cleanly if target is a pull request and avoid adding labels', async () => {
    mocks.mockContext.payload.issue = {
      pull_request: { url: 'https://api.github.com/repos/test-owner/test-repo/pulls/505' },
    };

    await runTriage({
      github: mocks.mockGithub,
      context: mocks.mockContext,
      core: mocks.mockCore,
      issueNumber: 505,
    });

    expect(mocks.mockCore.setFailed).toHaveBeenCalledWith(
      'The target must be an issue, not a pull request.',
    );
    expect(mocks.mockGithub.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(mocks.mockGithub.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('should read ISSUE_NUMBER from process.env when issueNumber argument is omitted', async () => {
    const previous = process.env.ISSUE_NUMBER;
    try {
      process.env.ISSUE_NUMBER = '77';
      mocks.mockContext.payload.issue = {
        number: 77,
        title: 'Freeform issue',
        body: 'Some text.',
        labels: [],
      };

      await runTriage({
        github: mocks.mockGithub,
        context: mocks.mockContext,
        core: mocks.mockCore,
      });

      expect(mocks.mockGithub.rest.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({ issue_number: 77 }),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.ISSUE_NUMBER;
      } else {
        process.env.ISSUE_NUMBER = previous;
      }
    }
  });

  it('should reject invalid or malformed ISSUE_NUMBER from process.env', async () => {
    const previous = process.env.ISSUE_NUMBER;
    try {
      const invalidValues = ['not-a-number', '0', '-5', '4e2', '0x2a', '12.34', ''];
      for (const invalid of invalidValues) {
        mocks.mockCore.setFailed.mockClear();
        process.env.ISSUE_NUMBER = invalid;
        await runTriage({
          github: mocks.mockGithub,
          context: mocks.mockContext,
          core: mocks.mockCore,
        });
        expect(mocks.mockCore.setFailed).toHaveBeenCalledWith(
          'issue_number must be a positive integer.',
        );
      }
    } finally {
      if (previous === undefined) {
        delete process.env.ISSUE_NUMBER;
      } else {
        process.env.ISSUE_NUMBER = previous;
      }
    }
  });

  it('should fetch issue via REST API if context.payload.issue has a mismatched number', async () => {
    mocks.mockContext.payload.issue = {
      number: 999,
      title: '[BUG] Different issue',
      body: 'Old issue details',
    };

    const fetchedIssue = {
      number: 42,
      title: '[BUG] Target issue',
      body: [
        '## 🐛 Describe the Bug\nTarget bug details.',
        '## 📋 Steps to Reproduce\n1. Target reproduction steps.',
        '## ✅ Expected Behavior\nTarget expected.',
        '## ❌ Actual Behavior\nTarget actual.',
      ].join('\n'),
      labels: [{ name: 'needs-triage' }],
    };

    mocks.mockGithub.rest.issues.get.mockResolvedValueOnce({ data: fetchedIssue });

    await runTriage({
      github: mocks.mockGithub,
      context: mocks.mockContext,
      core: mocks.mockCore,
      issueNumber: 42,
    });

    expect(mocks.mockGithub.rest.issues.get).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 42,
    });
    expect(mocks.mockGithub.rest.issues.removeLabel).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 42,
      name: 'needs-triage',
    });
  });

  it('should fail cleanly if issueNumber argument is invalid or negative', async () => {
    await runTriage({
      github: mocks.mockGithub,
      context: mocks.mockContext,
      core: mocks.mockCore,
      issueNumber: -5,
    });

    expect(mocks.mockCore.setFailed).toHaveBeenCalledWith(
      'issue_number must be a positive integer.',
    );
    expect(mocks.mockGithub.rest.issues.get).not.toHaveBeenCalled();
  });

  it('should tolerate comments with null or undefined body without crashing', async () => {
    mocks.mockContext.payload.issue = {
      title: 'Freeform issue',
      body: 'Just a freeform issue.',
      labels: [],
    };

    mocks.mockGithub.paginate.mockResolvedValue([
      { id: 1, user: { type: 'User' }, body: null },
      { id: 2, user: { type: 'Bot' }, body: undefined },
      {
        id: 3,
        user: { login: 'github-actions[bot]', type: 'Bot' },
        body: '<!-- coding-stuff:issue-triage:v1 -->\nOld bot comment',
      },
    ]);

    await runTriage({
      github: mocks.mockGithub,
      context: mocks.mockContext,
      core: mocks.mockCore,
      issueNumber: 303,
    });

    expect(mocks.mockGithub.rest.issues.updateComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 3,
      body: expect.stringContaining('<!-- coding-stuff:issue-triage:v1 -->'),
    });
  });
});

describe('Issue Triage - buildTriageCommentBody', () => {
  it('should generate valid markdown comment for compliant issue with removed needs-triage', () => {
    const evaluation = {
      isValid: true,
      templateType: 'bug',
      labelsToAdd: ['bug', 'priority-high'],
      labelsToRemove: ['needs-triage'],
      reason: 'Template [BUG] complet et conforme',
    };

    const comment = buildTriageCommentBody(evaluation);
    expect(comment).toContain('<!-- coding-stuff:issue-triage:v1 -->');
    expect(comment).toContain('## Triage initial');
    expect(comment).toContain(
      "✅ **Format conforme** : L'issue respecte la structure du gabarit [BUG]. L'étiquette `needs-triage` n'est pas appliquée.",
    );
    expect(comment).toContain('Labels appliqués : `bug`, `priority-high`');
  });

  it('should generate warning markdown comment for invalid issue with maintained needs-triage', () => {
    const evaluation = {
      isValid: false,
      templateType: 'freeform',
      labelsToAdd: ['needs-triage', 'question'],
      labelsToRemove: [],
      reason: 'Issue non basée sur un template officiel ([BUG], [FEATURE], [DOCS])',
    };

    const comment = buildTriageCommentBody(evaluation);
    expect(comment).toContain('<!-- coding-stuff:issue-triage:v1 -->');
    expect(comment).toContain(
      "⚠️ **Format à revoir** : Issue non basée sur un template officiel ([BUG], [FEATURE], [DOCS]). L'étiquette `needs-triage` est maintenue.",
    );
    expect(comment).toContain('Labels appliqués : `needs-triage`, `question`');
  });

  it('should generate warning markdown comment without mentioning needs-triage when needs-triage is not in labelsToAdd', () => {
    const evaluation = {
      isValid: false,
      templateType: 'freeform',
      labelsToAdd: ['question'],
      labelsToRemove: [],
      reason: 'Issue non basée sur un template officiel ([BUG], [FEATURE], [DOCS])',
    };

    const comment = buildTriageCommentBody(evaluation);
    expect(comment).toContain('<!-- coding-stuff:issue-triage:v1 -->');
    expect(comment).toContain(
      '⚠️ **Format à revoir** : Issue non basée sur un template officiel ([BUG], [FEATURE], [DOCS]).',
    );
    expect(comment).not.toContain("L'étiquette `needs-triage` est maintenue.");
    expect(comment).toContain('Labels appliqués : `question`');
  });
});
