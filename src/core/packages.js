import fs from 'node:fs/promises';
import path from 'node:path';

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

export async function readPackageJson(dir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

// Which package manager a repo uses, sniffed from its lockfile.
export async function detectPackageManager(dir) {
  const has = async (f) => {
    try {
      await fs.access(path.join(dir, f));
      return true;
    } catch {
      return false;
    }
  };
  if (await has('pnpm-lock.yaml')) return 'pnpm';
  if (await has('yarn.lock')) return 'yarn';
  if (await has('bun.lockb')) return 'bun';
  if (await has('package-lock.json')) return 'npm';
  return 'npm';
}

// Pure: given each repo's parsed package.json, compute which repos PROVIDE a
// package and which CONSUME one that also lives in the workspace.
// entries: [{ name (repo name), dir, pkg (parsed package.json | null), pm }]
export function computePackageGraph(entries) {
  const providers = new Map(); // packageName -> { repo, dir, version }
  for (const e of entries) {
    if (e.pkg?.name) providers.set(e.pkg.name, { repo: e.name, dir: e.dir, version: e.pkg.version || null, pm: e.pm });
  }

  const edges = [];
  for (const e of entries) {
    if (!e.pkg) continue;
    for (const field of DEP_FIELDS) {
      for (const [depName, spec] of Object.entries(e.pkg[field] || {})) {
        const provider = providers.get(depName);
        if (!provider || provider.repo === e.name) continue; // skip self
        edges.push({
          consumer: e.name,
          consumerDir: e.dir,
          consumerPm: e.pm,
          package: depName,
          providerRepo: provider.repo,
          providerDir: provider.dir,
          providerVersion: provider.version,
          depType: field,
          spec,
        });
      }
    }
  }

  return { providers, edges };
}

// Load the workspace graph from resolved repos ([{ name, path }]).
export async function loadPackageGraph(repos) {
  const entries = [];
  for (const r of repos) {
    const pkg = await readPackageJson(r.path);
    entries.push({ name: r.name, dir: r.path, pkg, pm: pkg ? await detectPackageManager(r.path) : null });
  }
  return { ...computePackageGraph(entries), entries };
}
