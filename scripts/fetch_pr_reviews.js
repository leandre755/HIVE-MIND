#!/usr/bin/env node

/**
 * Script de récupération complète des commentaires et suggestions de review d'une PR.
 *
 * Utilise GitHub CLI (`gh api`) pour extraire :
 * - Les métadonnées et le statut général de la PR
 * - Les revues soumises (APPROVED, CHANGES_REQUESTED, COMMENTED)
 * - Les commentaires généraux d'issues (CodeRabbit, Greptile, etc.)
 * - Les commentaires de review inline (fichiers, lignes, diff hunks et blocs ```suggestion)
 *
 * Usage :
 *   node scripts/fetch_pr_reviews.js [numero_pr] [--json]
 */

import { execSync } from 'node:child_process';
import process from 'node:process';

export function execGh(command) {
  try {
    return execSync(command, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch (err) {
    const stderr = err instanceof Error && 'stderr' in err ? String(err.stderr) : String(err);
    throw new Error(`Échec de la commande gh : ${stderr}`, { cause: err });
  }
}

export function resolvePrNumber(argPr) {
  if (argPr && /^\d+$/.test(argPr)) {
    return argPr;
  }
  try {
    const detected = execGh('gh pr view --json number --jq .number');
    if (detected && /^\d+$/.test(detected)) {
      return detected;
    }
  } catch {
    // Ignorer et basculer sur l'erreur
  }
  throw new Error(
    'Aucun numéro de PR spécifié et impossible de détecter la PR de la branche active.',
  );
}

export function resolveRepoInfo() {
  const repoJson = execGh(
    'gh repo view --json nameWithOwner,defaultBranchRef --jq "{nameWithOwner: .nameWithOwner}"',
  );
  return JSON.parse(repoJson);
}

export function fetchPrData(prNumber, ownerRepo) {
  const prMeta = JSON.parse(execGh(`gh api repos/${ownerRepo}/pulls/${prNumber}`));
  const reviews = JSON.parse(
    execGh(`gh api repos/${ownerRepo}/pulls/${prNumber}/reviews --paginate`),
  );
  const reviewComments = JSON.parse(
    execGh(`gh api repos/${ownerRepo}/pulls/${prNumber}/comments --paginate`),
  );
  const issueComments = JSON.parse(
    execGh(`gh api repos/${ownerRepo}/issues/${prNumber}/comments --paginate`),
  );

  return { prMeta, reviews, reviewComments, issueComments };
}

function getReviewStateEmoji(state) {
  if (state === 'APPROVED') return '✅';
  if (state === 'CHANGES_REQUESTED') return '❌';
  return '💬';
}

function formatReviews(reviews) {
  if (reviews.length === 0) {
    return ['_Aucune revue formelle soumise pour le moment._', ''];
  }
  const lines = [];
  for (const r of reviews) {
    const emoji = getReviewStateEmoji(r.state);
    lines.push(`### ${emoji} @${r.user?.login} (${r.state})`);
    if (r.body && r.body.trim().length > 0) {
      lines.push(r.body.trim());
    }
    lines.push('');
  }
  return lines;
}

function groupCommentsByFile(reviewComments) {
  const map = new Map();
  for (const comment of reviewComments) {
    const filePath = comment.path || 'inconnu';
    if (!map.has(filePath)) {
      map.set(filePath, []);
    }
    map.get(filePath).push(comment);
  }
  return map;
}

function formatSingleInlineComment(comment) {
  const lines = [];
  const line = comment.line || comment.original_line || 'global';
  lines.push(`#### Ligne ${line} — par @${comment.user?.login} (ID: ${comment.id})`);
  if (comment.diff_hunk) {
    lines.push('```diff');
    lines.push(comment.diff_hunk.trim());
    lines.push('```');
  }
  lines.push(comment.body.trim());
  lines.push('');
  return lines;
}

function formatReviewComments(reviewComments) {
  if (reviewComments.length === 0) {
    return ['_Aucun commentaire inline sur le diff._', ''];
  }
  const lines = [];
  const commentsByFile = groupCommentsByFile(reviewComments);

  for (const [file, comments] of commentsByFile.entries()) {
    lines.push(`### 📄 \`${file}\``);
    for (const c of comments) {
      lines.push(...formatSingleInlineComment(c));
    }
  }
  return lines;
}

function formatIssueComments(issueComments) {
  const botComments = issueComments.filter((c) => c.body && c.body.trim().length > 0);
  if (botComments.length === 0) {
    return ['_Aucun commentaire général._', ''];
  }
  const lines = [];
  for (const c of botComments) {
    lines.push(`### @${c.user?.login} (ID: ${c.id})`);
    lines.push(c.body.trim());
    lines.push('');
  }
  return lines;
}

export function formatMarkdownReport(prNumber, data) {
  const { prMeta, reviews, reviewComments, issueComments } = data;
  const lines = [
    `# 📋 Rapport de Review PR #${prNumber} : ${prMeta.title}`,
    `- **URL** : ${prMeta.html_url}`,
    `- **Auteur** : @${prMeta.user?.login}`,
    `- **Branche** : \`${prMeta.head?.ref}\` -> \`${prMeta.base?.ref}\``,
    `- **État** : ${prMeta.state} (Mergeable: ${prMeta.mergeable_state || 'unknown'})`,
    '',
    '## 🔍 Revues soumises',
    ...formatReviews(reviews),
    '## 💬 Commentaires Inline & Suggestions par Fichier',
    ...formatReviewComments(reviewComments),
    '## 📢 Commentaires Généraux (Issue Comments)',
    ...formatIssueComments(issueComments),
  ];

  return lines.join('\n');
}

export function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const prArg = args.find((a) => !a.startsWith('--'));

  const prNumber = resolvePrNumber(prArg);
  const { nameWithOwner } = resolveRepoInfo();

  const data = fetchPrData(prNumber, nameWithOwner);

  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(formatMarkdownReport(prNumber, data));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
