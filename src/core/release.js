// Deterministic version math for `monogit release` — no I/O, fully testable.

const LEVELS = ['major', 'minor', 'patch'];

// Bump a semver string by level, or return an explicit version string as-is.
export function bumpVersion(version, level) {
  if (level && !LEVELS.includes(level)) return level; // explicit target version
  const m = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null; // not plain semver — skip
  let [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (level === 'major') {
    maj += 1;
    min = 0;
    pat = 0;
  } else if (level === 'minor') {
    min += 1;
    pat = 0;
  } else {
    pat += 1; // patch (default)
  }
  return `${maj}.${min}.${pat}`;
}

// Update a consumer's dependency spec to a new version, preserving its range
// operator. Leaves local/protocol specs (file:, link:, workspace:) untouched.
export function updateDependentSpec(oldSpec, newVersion) {
  if (/^(file:|link:|workspace:|npm:|git\+|https?:)/.test(oldSpec)) return oldSpec;
  const prefix = /^[\^~]/.test(oldSpec) ? oldSpec[0] : '^';
  return `${prefix}${newVersion}`;
}

// Pure: from a package graph + bump level, produce the exact set of edits.
export function planRelease(graph, level) {
  // Only release packages that something in the workspace actually depends on —
  // i.e. the shared libraries. Leaf apps get their specs updated, not bumped.
  const consumed = new Set(graph.edges.map((e) => e.package));

  const bumps = [];
  const byName = new Map();
  for (const [name, p] of graph.providers) {
    if (!consumed.has(name)) continue;
    const newVersion = bumpVersion(p.version, level);
    if (!newVersion) continue;
    const bump = { package: name, repo: p.repo, dir: p.dir, pm: p.pm, oldVersion: p.version, newVersion };
    bumps.push(bump);
    byName.set(name, bump);
  }

  const consumerUpdates = [];
  for (const e of graph.edges) {
    const bump = byName.get(e.package);
    if (!bump) continue;
    const newSpec = updateDependentSpec(e.spec, bump.newVersion);
    if (newSpec === e.spec) continue;
    consumerUpdates.push({
      repo: e.consumer,
      dir: e.consumerDir,
      field: e.depType,
      package: e.package,
      oldSpec: e.spec,
      newSpec,
    });
  }

  return { bumps, consumerUpdates };
}
