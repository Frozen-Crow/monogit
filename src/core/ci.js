import fs from 'node:fs/promises';
import path from 'node:path';

// Committed in each consumer repo so a lone CI/deploy checkout knows where its
// locally-linked shared packages come from (git remote + ref).
export const DEPS_MANIFEST = '.monogit-deps.json';

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

export async function readDepsManifest(dir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, DEPS_MANIFEST), 'utf8'));
  } catch {
    return { packages: {} };
  }
}

export async function writeDepsManifest(dir, manifest) {
  await fs.writeFile(path.join(dir, DEPS_MANIFEST), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

export async function recordDep(dir, name, source) {
  const manifest = await readDepsManifest(dir);
  manifest.packages = manifest.packages || {};
  manifest.packages[name] = source; // { path, remote?, ref? }
  await writeDepsManifest(dir, manifest);
}

// Pure: find file:/link: (local path) dependencies in a package.json.
export function collectPathDeps(pkg) {
  const out = [];
  for (const field of DEP_FIELDS) {
    for (const [name, spec] of Object.entries(pkg?.[field] || {})) {
      const m = String(spec).match(/^(?:file:|link:)(.+)$/);
      if (m) out.push({ name, field, spec: String(spec), relPath: m[1] });
    }
  }
  return out;
}

// Pure: turn a git remote (+ ref) into an npm-installable git dependency spec.
export function toGitDependency(remote, ref) {
  let url = String(remote || '').trim();
  // scp-style: git@github.com:owner/repo.git → ssh://git@github.com/owner/repo.git
  const scp = url.match(/^([^@\s]+)@([^:\s]+):(.+)$/);
  if (scp) url = `ssh://${scp[1]}@${scp[2]}/${scp[3]}`;
  if (!url.startsWith('git+')) url = `git+${url}`;
  return ref ? `${url}#${ref}` : url;
}
