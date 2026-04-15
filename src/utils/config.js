import fs from 'node:fs/promises';
import path from 'node:path';

const CONFIG_FILE = '.monogit.json';

export async function readConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { repos: [] };
    }
    throw error;
  }
}

export async function writeConfig(config) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function addRepo(repoPath) {
  const config = await readConfig();
  if (!config.repos.includes(repoPath)) {
    config.repos.push(repoPath);
    await writeConfig(config);
    return true;
  }
  return false;
}

export async function getRepos() {
  const config = await readConfig();
  return config.repos;
}

export function getConfigPath() {
    return path.join(process.cwd(), CONFIG_FILE);
}
