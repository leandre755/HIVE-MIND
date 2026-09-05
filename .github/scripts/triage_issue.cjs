/**
 * Module de triage et validation de conformité des issues GitHub.
 * Analyse la structure des templates ([BUG], [FEATURE], [DOCS]), vérifie l'absence de placeholders
 * par défaut et gère conditionnellement l'étiquette needs-triage.
 */

'use strict';

const BUG_STRICT_PLACEHOLDERS = [
  "go to '...'",
  "click on '...'",
  "scroll down to '...'",
  "see error '...'",
];

const BUG_GUIDE_PROMPTS = [
  'a clear and concise description of what the bug is.',
  'steps to reproduce the behavior:',
  'a clear and concise description of what you expected to happen.',
  'a clear and concise description of what actually happened.',
];

const FEATURE_STRICT_PLACEHOLDERS = ['criterion 1', 'criterion 2', 'criterion 3'];

const FEATURE_GUIDE_PROMPTS = [
  'a clear and concise description of what the feature should do.',
  'describe the problem this feature would solve or the value it would provide.',
  'as a [user/role], i want [feature], so that [benefit].',
  '### example scenario:',
  'example scenario:',
  'what should this feature accomplish? define clear acceptance criteria:',
  'what should this feature accomplish?',
  'define clear acceptance criteria:',
];

const DOCS_STRICT_PLACEHOLDERS = ['your suggested documentation content here'];

const DOCS_GUIDE_PROMPTS = [
  'describe what documentation needs to be added, updated, or clarified.',
  'where in the documentation is this issue? (e.g., readme.md, docs/api.md, docs/getting-started.md)',
  'where in the documentation is this issue?',
  '(e.g., readme.md, docs/api.md, docs/getting-started.md)',
  'explain what information is missing, outdated, or confusing:',
  'provide an example or draft of how the documentation should be improved:',
  '## example',
];

const TRIAGE_MARKER = '<!-- coding-stuff:issue-triage:v1 -->';

/**
 * Normalise un en-tête en supprimant les émojis et la ponctuation.
 * @param {string} rawHeader
 * @returns {string}
 */
function normalizeHeader(rawHeader) {
  return rawHeader
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Analyse si une ligne débute un bloc de code clôturé par ``` ou ~~~ (CommonMark/GFM).
 * Une ouverture doit comporter au moins 3 caractères de même type (` ou ~).
 * Pour les backticks, la chaîne d'information ne doit pas comporter de backtick.
 * @param {string} trimmedLine
 * @returns {{ char: string, length: number } | null}
 */
function parseOpeningFence(trimmedLine) {
  const firstChar = trimmedLine.charAt(0);
  if (firstChar !== '`' && firstChar !== '~') {
    return null;
  }
  let len = 0;
  while (len < trimmedLine.length && trimmedLine.charAt(len) === firstChar) {
    len++;
  }
  if (len < 3) {
    return null;
  }
  if (firstChar === '`' && trimmedLine.slice(len).includes('`')) {
    return null;
  }
  return { char: firstChar, length: len };
}

/**
 * Détermine si une ligne clôture le bloc de code actif.
 * La fermeture doit utiliser le même caractère, avoir une longueur supérieure ou égale
 * à l'ouverture, et ne comporter aucun caractère non-espace après le délimiteur.
 * @param {string} trimmedLine
 * @param {{ char: string, length: number }} activeFence
 * @returns {boolean}
 */
function isClosingFence(trimmedLine, activeFence) {
  let len = 0;
  while (len < trimmedLine.length && trimmedLine.charAt(len) === activeFence.char) {
    len++;
  }
  return len >= activeFence.length && trimmedLine.slice(len).trim().length === 0;
}

/**
 * Détermine l'état du fence de code pour la ligne courante.
 * @param {string} trimmedLine
 * @param {{ char: string, length: number } | null} activeFence
 * @returns {{ nextFence: { char: string, length: number } | null, inFence: boolean }}
 */
function checkFenceTransition(trimmedLine, activeFence) {
  if (activeFence) {
    const closed = isClosingFence(trimmedLine, activeFence);
    return { nextFence: closed ? null : activeFence, inFence: true };
  }
  const openingFence = parseOpeningFence(trimmedLine);
  if (openingFence) {
    return { nextFence: openingFence, inFence: true };
  }
  return { nextFence: null, inFence: false };
}

/**
 * Enregistre la section courante dans la Map si un en-tête est actif.
 * @param {Map<string, string>} sections
 * @param {string | null} header
 * @param {string[]} contentLines
 */
function commitSection(sections, header, contentLines) {
  if (header) {
    sections.set(header, contentLines.join('\n').trim());
  }
}

/**
 * Extrait les sections markdown de niveau 2 (## ...) sous forme d'une Map normalisée,
 * en ignorant les en-têtes situés à l'intérieur de blocs de code (fences ``` ou ~~~).
 * @param {string} body
 * @returns {Map<string, string>}
 */
function extractSections(body) {
  if (!body || typeof body !== 'string') return new Map();
  const sections = new Map();
  let currentHeader = null;
  let currentContent = [];
  let activeFence = null;

  for (const line of body.split('\n')) {
    const trimmed = line.trimStart();
    const { nextFence, inFence } = checkFenceTransition(trimmed, activeFence);
    activeFence = nextFence;

    if (inFence) {
      if (currentHeader) currentContent.push(line);
      continue;
    }

    if (trimmed.startsWith('## ')) {
      commitSection(sections, currentHeader, currentContent);
      currentHeader = normalizeHeader(trimmed.slice(3));
      currentContent = [];
    } else if (currentHeader) {
      currentContent.push(line);
    }
  }

  commitSection(sections, currentHeader, currentContent);
  return sections;
}

/**
 * Élimine les prompts indicatifs d'une ligne de section normalisée.
 * @param {string} line
 * @param {string[]} guidePrompts
 * @returns {string}
 */
function stripGuidePromptsFromLine(line, guidePrompts) {
  let stripped = line;
  const orderedPrompts = [...guidePrompts].sort((a, b) => b.length - a.length);
  for (const prompt of orderedPrompts) {
    if (stripped === prompt) {
      return '';
    }
    if (stripped.startsWith(prompt)) {
      stripped = stripped.slice(prompt.length).trim();
    }
  }
  return stripped;
}

/**
 * Supprime les préfixes de liste, citations ou cases à cocher markdown de façon linéaire sans ReDoS.
 * @param {string} line
 * @returns {string}
 */
function stripListMarker(line) {
  let trimmed = line.trimStart();
  if (
    trimmed.startsWith('- ') ||
    trimmed.startsWith('* ') ||
    trimmed.startsWith('+ ') ||
    trimmed.startsWith('> ')
  ) {
    trimmed = trimmed.slice(2).trimStart();
  } else if (/^\d+[.)]\s*/.test(trimmed)) {
    trimmed = trimmed.replace(/^\d+[.)]\s*/, '');
  }
  if (/^\[[ xX]?\]\s*/.test(trimmed)) {
    trimmed = trimmed.replace(/^\[[ xX]?\]\s*/, '');
  }
  return trimmed.trim();
}

/**
 * Filtre les lignes de délimiteurs de fences (``` ou ~~~) et leurs identifiants de langage,
 * en conservant uniquement les lignes de contenu réel situées à l'intérieur ou à l'extérieur.
 * @param {string[]} lines
 * @returns {string[]}
 */
function filterNonFenceLines(lines) {
  const result = [];
  let activeFence = null;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (activeFence) {
      if (isClosingFence(trimmed, activeFence)) {
        activeFence = null;
      } else {
        result.push(line);
      }
    } else {
      const opening = parseOpeningFence(trimmed);
      if (opening) {
        activeFence = opening;
      } else {
        result.push(line);
      }
    }
  }

  return result;
}

/**
 * Vérifie si une section contient un contenu substantiel en dehors des invites du template.
 * @param {string|undefined} content
 * @param {string[]} strictPlaceholders
 * @param {string[]} guidePrompts
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateSectionContent(content, strictPlaceholders = [], guidePrompts = []) {
  if (!content || typeof content !== 'string') {
    return { valid: false, reason: 'section vide ou absente' };
  }

  const lowerContent = content.toLowerCase();
  const rawLines = lowerContent.split('\n');

  // Normalisation linéaire des lignes sans regex ReDoS
  const contentLines = rawLines.map((line) => stripListMarker(line));

  for (const placeholder of strictPlaceholders) {
    if (contentLines.some((entry) => entry === placeholder)) {
      return { valid: false, reason: `contient l'élément non rempli "${placeholder}"` };
    }
  }

  const filteredLines = contentLines
    .map((line) => stripGuidePromptsFromLine(line, guidePrompts))
    .filter((line) => line.length > 0);

  const nonFenceLines = filterNonFenceLines(filteredLines);

  const substantiveText = nonFenceLines
    .join('\n')
    .replace(/[`~#\-*[\]()]/g, '')
    .trim();

  if (substantiveText.length < 5) {
    return {
      valid: false,
      reason: "contient uniquement le texte d'instruction par défaut sans contenu utilisateur",
    };
  }

  return { valid: true };
}

/**
 * Valide un rapport de bug.
 * @param {Map<string, string>} sections
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateBugTemplate(sections) {
  const required = [
    { key: 'describe the bug', label: 'Describe the Bug' },
    { key: 'steps to reproduce', label: 'Steps to Reproduce' },
    { key: 'expected behavior', label: 'Expected Behavior' },
    { key: 'actual behavior', label: 'Actual Behavior' },
  ];

  for (const item of required) {
    const content = sections.get(item.key);
    const result = validateSectionContent(content, BUG_STRICT_PLACEHOLDERS, BUG_GUIDE_PROMPTS);
    if (!result.valid) {
      return { valid: false, reason: `Section "${item.label}" invalide (${result.reason})` };
    }
  }
  return { valid: true };
}

/**
 * Valide une demande de fonctionnalité.
 * @param {Map<string, string>} sections
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateFeatureTemplate(sections) {
  const required = [
    { key: 'feature description', label: 'Feature Description' },
    { key: 'use case', label: 'Use Case' },
    { key: 'acceptance criteria', label: 'Acceptance Criteria' },
  ];

  for (const item of required) {
    const content = sections.get(item.key);
    const result = validateSectionContent(
      content,
      FEATURE_STRICT_PLACEHOLDERS,
      FEATURE_GUIDE_PROMPTS,
    );
    if (!result.valid) {
      return { valid: false, reason: `Section "${item.label}" invalide (${result.reason})` };
    }
  }
  return { valid: true };
}

/**
 * Valide un signalement de documentation.
 * @param {Map<string, string>} sections
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateDocsTemplate(sections) {
  const required = [
    { key: 'documentation issue', label: 'Documentation Issue' },
    { key: 'affected section', label: 'Affected Section' },
    { key: 'whats missing or unclear', label: "What's Missing or Unclear?" },
    { key: 'suggested changes', label: 'Suggested Changes' },
  ];

  for (const item of required) {
    const content = sections.get(item.key);
    const result = validateSectionContent(content, DOCS_STRICT_PLACEHOLDERS, DOCS_GUIDE_PROMPTS);
    if (!result.valid) {
      return { valid: false, reason: `Section "${item.label}" invalide (${result.reason})` };
    }
  }
  return { valid: true };
}

/**
 * Détecte les étiquettes de priorité et de sécurité additionnelles.
 * @param {string} fullText
 * @returns {string[]}
 */
function detectExtraLabels(fullText) {
  const extras = [];
  if (/\b(critical|urgent|blocking)\b/.test(fullText)) {
    extras.push('priority-high');
  }
  if (/\b(security|vulnerability|cve|exploit)\b/.test(fullText)) {
    extras.push('security');
  }
  return extras;
}

/**
 * Évalue une issue préfixée par [BUG].
 * @param {string} title
 * @param {Map<string, string>} sections
 * @param {string[]} extraLabels
 */
function evaluateBugIssue(title, sections, extraLabels) {
  const titlePayload = title.replace(/^\[BUG\]\s*/i, '').trim();
  if (titlePayload.length < 3) {
    return {
      isValid: false,
      templateType: 'bug',
      labelsToAdd: ['needs-triage', 'bug', ...extraLabels].slice(0, 4),
      labelsToRemove: [],
      reason: 'Titre de bug non renseigné ou trop succinct après le préfixe [BUG]',
    };
  }
  const check = validateBugTemplate(sections);
  if (!check.valid) {
    return {
      isValid: false,
      templateType: 'bug',
      labelsToAdd: ['needs-triage', 'bug', ...extraLabels].slice(0, 4),
      labelsToRemove: [],
      reason: check.reason || 'Structure de bug incomplète',
    };
  }
  return {
    isValid: true,
    templateType: 'bug',
    labelsToAdd: ['bug', ...extraLabels].slice(0, 4),
    labelsToRemove: ['needs-triage'],
    reason: 'Template [BUG] complet et conforme',
  };
}

/**
 * Évalue une issue préfixée par [FEATURE].
 * @param {string} title
 * @param {Map<string, string>} sections
 * @param {string[]} extraLabels
 */
function evaluateFeatureIssue(title, sections, extraLabels) {
  const titlePayload = title.replace(/^\[FEATURE\]\s*/i, '').trim();
  if (titlePayload.length < 3) {
    return {
      isValid: false,
      templateType: 'feature',
      labelsToAdd: ['needs-triage', 'enhancement', ...extraLabels].slice(0, 4),
      labelsToRemove: [],
      reason: 'Titre de feature non renseigné ou trop succinct après le préfixe [FEATURE]',
    };
  }
  const check = validateFeatureTemplate(sections);
  if (!check.valid) {
    return {
      isValid: false,
      templateType: 'feature',
      labelsToAdd: ['needs-triage', 'enhancement', ...extraLabels].slice(0, 4),
      labelsToRemove: [],
      reason: check.reason || 'Structure de feature incomplète',
    };
  }
  return {
    isValid: true,
    templateType: 'feature',
    labelsToAdd: ['enhancement', ...extraLabels].slice(0, 4),
    labelsToRemove: ['needs-triage'],
    reason: 'Template [FEATURE] complet et conforme',
  };
}

/**
 * Évalue une issue préfixée par [DOCS].
 * @param {string} title
 * @param {Map<string, string>} sections
 * @param {string[]} extraLabels
 */
function evaluateDocsIssue(title, sections, extraLabels) {
  const titlePayload = title.replace(/^\[DOCS\]\s*/i, '').trim();
  if (titlePayload.length < 3) {
    return {
      isValid: false,
      templateType: 'documentation',
      labelsToAdd: ['needs-triage', 'documentation', ...extraLabels].slice(0, 4),
      labelsToRemove: [],
      reason: 'Titre de documentation non renseigné après le préfixe [DOCS]',
    };
  }
  const check = validateDocsTemplate(sections);
  if (!check.valid) {
    return {
      isValid: false,
      templateType: 'documentation',
      labelsToAdd: ['needs-triage', 'documentation', ...extraLabels].slice(0, 4),
      labelsToRemove: [],
      reason: check.reason || 'Structure de documentation incomplète',
    };
  }
  return {
    isValid: true,
    templateType: 'documentation',
    labelsToAdd: ['documentation', ...extraLabels].slice(0, 4),
    labelsToRemove: ['needs-triage'],
    reason: 'Template [DOCS] complet et conforme',
  };
}

/**
 * Évalue une issue sans gabarit reconnu.
 * @param {string} fullText
 * @param {string[]} extraLabels
 */
function evaluateFreeformIssue(fullText, extraLabels) {
  const fallbackLabels = ['needs-triage'];
  if (/\b(bug|error|crash|regression|broken)\b/.test(fullText)) fallbackLabels.push('bug');
  if (/\b(feature|enhancement|proposal|request)\b/.test(fullText))
    fallbackLabels.push('enhancement');
  if (/\b(doc|documentation|readme|guide)\b/.test(fullText)) fallbackLabels.push('documentation');
  if (/\b(question|how do i|help)\b/.test(fullText)) fallbackLabels.push('question');

  return {
    isValid: false,
    templateType: 'freeform',
    labelsToAdd: [
      ...new Set([...fallbackLabels.slice(0, 1), ...extraLabels, ...fallbackLabels.slice(1)]),
    ].slice(0, 4),
    labelsToRemove: [],
    reason: 'Issue non basée sur un template officiel ([BUG], [FEATURE], [DOCS])',
  };
}

/**
 * Évalue la conformité du format d'une issue et calcule les étiquettes à ajouter/retirer.
 * @param {{ title?: string, body?: string, labels?: Array<{ name: string } | string> }} issue
 */
function evaluateIssueFormat(issue) {
  const title = issue && typeof issue.title === 'string' ? issue.title.trim() : '';
  const body = issue && typeof issue.body === 'string' ? issue.body.trim() : '';
  const fullText = `${title}\n${body}`.toLowerCase();
  const extraLabels = detectExtraLabels(fullText);

  if (!title) {
    return {
      isValid: false,
      templateType: 'unknown',
      labelsToAdd: ['needs-triage', ...extraLabels].slice(0, 4),
      labelsToRemove: [],
      reason: "Le titre de l'issue est vide",
    };
  }

  const sections = extractSections(body);

  if (/^\[BUG\]/i.test(title)) {
    return evaluateBugIssue(title, sections, extraLabels);
  }
  if (/^\[FEATURE\]/i.test(title)) {
    return evaluateFeatureIssue(title, sections, extraLabels);
  }
  if (/^\[DOCS\]/i.test(title)) {
    return evaluateDocsIssue(title, sections, extraLabels);
  }

  return evaluateFreeformIssue(fullText, extraLabels);
}

/**
 * Retire les étiquettes obsolètes d'une issue (insensible à la casse).
 * Propage l'échec si une erreur non-404 survient.
 * @returns {Promise<{ success: boolean, error?: unknown, label?: string }>}
 */
async function removeObsoleteLabels({
  github,
  context,
  issueNumber,
  labelsToRemove,
  existingLabelNames,
  core,
}) {
  for (const labelName of labelsToRemove) {
    const matchingLabel = existingLabelNames.find(
      (l) => l.toLowerCase() === labelName.toLowerCase(),
    );
    if (!matchingLabel) {
      continue;
    }
    try {
      await github.rest.issues.removeLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        name: matchingLabel,
      });
    } catch (err) {
      if (err && err.status === 404) {
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      core.warning(`Impossible de retirer l'étiquette ${matchingLabel}: ${message}`);
      return { success: false, error: err, label: matchingLabel };
    }
  }
  return { success: true };
}

/**
 * Construit la ligne de statut pour le commentaire de triage.
 * @param {ReturnType<typeof evaluateIssueFormat>} evaluation
 * @returns {string}
 */
function buildStatusLine(evaluation) {
  if (evaluation.isValid) {
    return `✅ **Format conforme** : L'issue respecte la structure du gabarit [${evaluation.templateType.toUpperCase()}]. L'étiquette \`needs-triage\` n'est pas appliquée.`;
  }
  const triageNote = evaluation.labelsToAdd.includes('needs-triage')
    ? " L'étiquette `needs-triage` est maintenue."
    : '';
  return `⚠️ **Format à revoir** : ${evaluation.reason}.${triageNote}`;
}

/**
 * Construit le corps du commentaire de triage.
 * @param {ReturnType<typeof evaluateIssueFormat>} evaluation
 * @returns {string}
 */
function buildTriageCommentBody(evaluation) {
  const formattedLabels = evaluation.labelsToAdd.map((label) => '`' + label + '`').join(', ');
  const statusLine = buildStatusLine(evaluation);

  return [
    TRIAGE_MARKER,
    '## Triage initial',
    '',
    statusLine,
    '',
    `Labels appliqués : ${formattedLabels}`,
    '',
    'Ce premier passage automatique est limité aux étiquettes. Un mainteneur validera la priorité et le périmètre.',
  ].join('\n');
}

/**
 * Crée ou met à jour le commentaire de diagnostic d'issue.
 */
async function upsertTriageComment({ github, context, issueNumber, body }) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issueNumber,
    per_page: 100,
  });

  const existing = comments.find(
    (comment) =>
      typeof comment.body === 'string' &&
      comment.body.includes(TRIAGE_MARKER) &&
      (comment.user?.login === 'github-actions[bot]' || comment.user?.type === 'Bot'),
  );

  if (existing) {
    await github.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issueNumber,
      body,
    });
  }
}

/**
 * Résout le numéro d'issue à partir des paramètres ou de process.env.
 * @param {number|undefined} issueNumber
 * @returns {number}
 */
function resolveTargetNumber(issueNumber) {
  if (typeof issueNumber === 'number') {
    return issueNumber;
  }
  const rawNumber = process.env.ISSUE_NUMBER;
  if (typeof rawNumber === 'string' && /^[1-9]\d*$/.test(rawNumber.trim())) {
    return Number(rawNumber.trim());
  }
  return NaN;
}

/**
 * Exécute l'action de triage via le client GitHub Actions (actions/github-script).
 * @param {{
 *   github: any,
 *   context: any,
 *   core: any,
 *   issueNumber?: number
 * }} params
 */
async function runTriage({ github, context, core, issueNumber }) {
  const targetNumber = resolveTargetNumber(issueNumber);

  if (!Number.isInteger(targetNumber) || targetNumber <= 0) {
    core.setFailed('issue_number must be a positive integer.');
    return;
  }

  const payloadIssue = context.payload.issue;
  const isPayloadTarget = Boolean(
    payloadIssue && (payloadIssue.number === undefined || payloadIssue.number === targetNumber),
  );
  const issue = isPayloadTarget
    ? payloadIssue
    : (
        await github.rest.issues.get({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: targetNumber,
        })
      ).data;

  if (issue.pull_request) {
    core.setFailed('The target must be an issue, not a pull request.');
    return;
  }

  const evaluation = evaluateIssueFormat(issue);
  const existingLabelNames = (issue.labels || [])
    .map((l) => (typeof l === 'string' ? l : l?.name))
    .filter((name) => typeof name === 'string' && name.length > 0);

  if (evaluation.isValid && evaluation.labelsToRemove.length > 0) {
    const removalResult = await removeObsoleteLabels({
      github,
      context,
      issueNumber: targetNumber,
      labelsToRemove: evaluation.labelsToRemove,
      existingLabelNames,
      core,
    });
    if (!removalResult.success) {
      core.setFailed(
        `Échec critique lors du retrait de l'étiquette ${removalResult.label} sur l'issue #${targetNumber}.`,
      );
      return;
    }
  }

  const isEditAction = context.eventName === 'issues' && context.payload?.action === 'edited';
  const hasNeedsTriage = existingLabelNames.some((name) => name.toLowerCase() === 'needs-triage');

  let labelsToAdd = evaluation.labelsToAdd;
  if (isEditAction && !hasNeedsTriage) {
    labelsToAdd = labelsToAdd.filter((label) => label.toLowerCase() !== 'needs-triage');
  }

  if (labelsToAdd.length > 0) {
    await github.rest.issues.addLabels({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: targetNumber,
      labels: labelsToAdd,
    });
  }

  const commentEvaluation = { ...evaluation, labelsToAdd };
  const commentBody = buildTriageCommentBody(commentEvaluation);
  await upsertTriageComment({
    github,
    context,
    issueNumber: targetNumber,
    body: commentBody,
  });

  return commentEvaluation;
}

module.exports = {
  normalizeHeader,
  parseOpeningFence,
  isClosingFence,
  filterNonFenceLines,
  extractSections,
  validateSectionContent,
  validateBugTemplate,
  validateFeatureTemplate,
  validateDocsTemplate,
  evaluateIssueFormat,
  buildTriageCommentBody,
  runTriage,
};
