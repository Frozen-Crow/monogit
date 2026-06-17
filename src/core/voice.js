// Turn a spoken branch phrase into a git-friendly branch name.
// "feature slash login page" -> "feature/login-page"
export function normalizeBranch(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/\b(?:forward )?slash\b/g, '/')
    .replace(/[^a-z0-9/]+/g, '-') // spaces/punctuation -> hyphen
    .replace(/-*\/-*/g, '/') // tidy hyphens around slashes
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '');
}

// Strip filler so matching is forgiving of how people actually talk.
function normalize(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[.,!?]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:hey |ok |okay )?(?:mono ?git[, ]+)?/, '')
    .replace(/^please /, '')
    .trim();
}

// Map a transcript to a structured intent (no execution — pure & testable).
// Returns { kind, write, label, ...payload }.
export function interpret(raw) {
  const original = String(raw || '').trim();
  const t = normalize(raw);
  if (!t) return { kind: 'unknown', transcript: original };

  // commit (requires an explicit "message"/"saying" keyword so we don't
  // accidentally treat "commit my changes" as the message)
  const om = original.match(/\bcommit (?:message|saying|with message|as|titled) (.+)$/i);
  if (om) {
    const message = om[1].trim();
    return { kind: 'commit', message, write: true, label: `commit -am "${message}"` };
  }
  if (/^commit\b/.test(t)) return { kind: 'need-message', write: false, label: 'commit (no message heard)' };

  // create a branch
  let m =
    t.match(/^(?:create|make|new)(?: a)? branch (.+)$/) ||
    t.match(/^check ?out new (?:branch )?(.+)$/);
  if (m) {
    const branch = normalizeBranch(m[1]);
    return { kind: 'branch-create', branch, write: true, label: `checkout -b ${branch}` };
  }

  // switch to an existing branch
  m = t.match(/^(?:check ?out|switch to|switch|go to) (.+)$/);
  if (m) {
    const branch = normalizeBranch(m[1]);
    return { kind: 'checkout', branch, write: true, label: `checkout ${branch}` };
  }

  // merge a branch into the current one
  m = t.match(/^merge(?: branch| in| from)? (.+)$/);
  if (m) {
    const branch = normalizeBranch(m[1]);
    return { kind: 'merge', branch, write: true, label: `merge ${branch}` };
  }

  if (/^push\b/.test(t)) return { kind: 'push', write: true, label: 'push' };
  if (/^pull\b/.test(t)) return { kind: 'pull', write: true, label: 'pull' };
  if (/^fetch\b/.test(t)) return { kind: 'fetch', write: true, label: 'fetch' };

  if (/\bstatus\b/.test(t)) return { kind: 'status', write: false, label: 'status' };
  if (/\b(?:list repos|repositories|repos)\b/.test(t)) return { kind: 'list', write: false, label: 'repos list' };
  if (/\b(?:tidy|clean ?up)\b/.test(t)) return { kind: 'tidy', write: false, label: 'tidy --dry-run' };
  if (/\b(?:log|history)\b/.test(t)) return { kind: 'log', write: false, label: 'log' };
  // "show changes" (plural) means a diff; "show change"/"change id" means a linked change
  if (/\b(?:diff|what changed|show changes|unstaged)\b/.test(t)) return { kind: 'diff', write: false, label: 'diff' };
  if (/\b(?:change id|show change|latest change|linked change)\b/.test(t)) return { kind: 'show', write: false, label: 'show' };

  return { kind: 'unknown', transcript: t };
}

// End the continuous listening session.
export function isStopWord(raw) {
  return /\b(?:stop(?: listening)?|exit|quit|never ?mind|that.?s all|good ?bye|cancel listening)\b/.test(normalize(raw));
}

// Spoken "yes" for hands-free confirmation of write commands.
export function isAffirmative(raw) {
  return /\b(?:yes|yeah|yep|yup|sure|ok|okay|confirm|do it|go ahead|affirmative|please do)\b/.test(normalize(raw));
}

export const PHRASE_HELP = [
  '"status"                    → status dashboard',
  '"commit message <text>"     → commit -am "<text>"',
  '"new branch <name>"         → checkout -b <name>',
  '"checkout <name>"           → switch branch',
  '"merge <name>"              → merge <name> into current',
  '"push" / "pull" / "fetch"   → sync',
  '"tidy"                      → orphan-branch scan (dry run)',
  '"log" / "diff" / "show"     → history / changes / linked change',
];
