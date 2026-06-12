import fs from 'node:fs/promises';
import path from 'node:path';

const CONFIG_FILE = '.monogit.json';

export function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(parseList);
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Walk up from startDir until a .monogit.json is found (like git finds .git).
export async function findConfigPath(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, CONFIG_FILE);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep climbing
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function getWorkspaceRoot(startDir) {
  const configPath = await findConfigPath(startDir);
  return configPath ? path.dirname(configPath) : null;
}

export async function readConfig(startDir) {
  const configPath = await findConfigPath(startDir);
  if (!configPath) return { repos: [], groups: {}, protected: [], _path: null, _root: null };

  const data = await fs.readFile(configPath, 'utf-8');
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    throw new Error(`Invalid ${CONFIG_FILE} at ${configPath}: ${error.message}`);
  }

  if (!Array.isArray(parsed.repos)) parsed.repos = [];
  if (!parsed.groups || typeof parsed.groups !== 'object') parsed.groups = {};
  if (!Array.isArray(parsed.protected)) parsed.protected = [];
  parsed._path = configPath;
  parsed._root = path.dirname(configPath);
  return parsed;
}

// A repo entry on disk may be a bare string (path) or an object with metadata.
export function normalizeEntry(entry) {
  if (typeof entry === 'string') return { path: entry };
  return {
    path: entry.path,
    ...(entry.remote ? { remote: entry.remote } : {}),
    ...(entry.branch ? { branch: entry.branch } : {}),
  };
}

// Serialize back, keeping the minimal string form when there's no metadata.
function serializeEntry(entry) {
  const n = normalizeEntry(entry);
  if (!n.remote && !n.branch) return n.path;
  return n;
}

export async function writeConfig(config, targetPath) {
  const { _path, _root, ...clean } = config;
  if (Array.isArray(clean.repos)) clean.repos = clean.repos.map(serializeEntry);
  if (clean.groups && Object.keys(clean.groups).length === 0) delete clean.groups;
  if (Array.isArray(clean.protected) && clean.protected.length === 0) delete clean.protected;

  const dest = targetPath || _path || path.join(process.cwd(), CONFIG_FILE);
  await fs.writeFile(dest, JSON.stringify(clean, null, 2) + '\n', 'utf-8');
  return dest;
}

function matchName(entryPath, token) {
  return entryPath === token || path.basename(entryPath) === token;
}

// Resolve repo entries to absolute paths, applying --group / --only / --except filters.
export async function resolveRepos(options = {}, startDir) {
  const config = await readConfig(startDir);
  const root = config._root;
  let entries = (config.repos || []).map(normalizeEntry);

  if (options.group) {
    const groups = config.groups || {};
    const wanted = parseList(options.group);
    const members = new Set();
    for (const g of wanted) {
      for (const m of groups[g] || []) members.add(m);
    }
    entries = entries.filter((e) => [...members].some((t) => matchName(e.path, t)));
  }

  if (options.only) {
    const tokens = parseList(options.only);
    entries = entries.filter((e) => tokens.some((t) => matchName(e.path, t)));
  }

  if (options.except) {
    const tokens = parseList(options.except);
    entries = entries.filter((e) => !tokens.some((t) => matchName(e.path, t)));
  }

  return entries.map((e) => ({
    name: e.path,
    path: root ? path.resolve(root, e.path) : path.resolve(e.path),
    remote: e.remote || null,
    branch: e.branch || null,
    root,
  }));
}

export async function getProtectedPatterns(startDir) {
  const config = await readConfig(startDir);
  return config.protected || [];
}

export async function addRepoEntry(entry, startDir) {
  const config = await readConfig(startDir);
  const norm = normalizeEntry(entry);
  const exists = config.repos.some((e) => normalizeEntry(e).path === norm.path);
  if (exists) return { added: false, config };
  config.repos.push(norm.remote || norm.branch ? norm : norm.path);
  const dest = await writeConfig(config);
  return { added: true, config, dest };
}

export async function removeRepoEntry(token, startDir) {
  const config = await readConfig(startDir);
  const before = config.repos.length;
  config.repos = config.repos.filter((e) => !matchName(normalizeEntry(e).path, token));
  if (config.repos.length === before) return { removed: false, config };
  await writeConfig(config);
  return { removed: true, config };
}

// Backwards-compatible helper (returns relative path names).
export async function getRepos() {
  const repos = await resolveRepos();
  return repos.map((r) => r.name);
}

export function getConfigPath() {
  return path.join(process.cwd(), CONFIG_FILE);
}
