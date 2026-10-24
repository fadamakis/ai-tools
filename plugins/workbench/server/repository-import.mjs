import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const folderPickerScript = 'activate\nset selectedFolder to choose folder with prompt "Choose a Git repository for Workbench Preview"\nreturn POSIX path of selectedFolder';

export async function pickRepositoryFolder({ platform = process.platform, run = execute } = {}) {
  if (platform !== 'darwin') throw new Error('The native folder picker is available on macOS. Select a detected repository or enter its path manually.');
  try {
    const result = await run('/usr/bin/osascript', ['-e', folderPickerScript], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 });
    const selected = result.stdout.trim();
    if (!path.isAbsolute(selected)) throw new Error('The folder picker did not return a local folder.');
    return { path: selected, cancelled: false };
  } catch (error) {
    if (/\(-128\)|user cancel(?:l)?ed/i.test(error.stderr || error.message || '')) return { cancelled: true };
    if (error.killed) throw new Error('The folder picker timed out. Choose the folder again.');
    throw error;
  }
}

export function configuredProjectRoots(source) {
  const roots = [];
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*\[\s*projects\s*\.\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*\]\s*(?:#.*)?$/);
    if (!match) continue;
    try {
      const value = match[1].startsWith("'") ? match[1].slice(1, -1) : JSON.parse(match[1].replace(/\\U([0-9a-fA-F]{8})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16))));
      if (path.isAbsolute(value)) roots.push(value);
    } catch { /* Ignore malformed section keys; discovery must not block import. */ }
  }
  return [...new Set(roots)];
}

export function taskNotes(commonDir) {
  const notes = new Map();
  for (const name of ['workbench-preview', 'workbench']) {
    const directory = path.join(commonDir, name);
    if (!fs.existsSync(directory)) continue;
    const directoryStat = fs.lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}\.md$/.test(entry.name)) continue;
      const filename = path.join(directory, entry.name), key = entry.name.slice(0, -3);
      if (fs.statSync(filename).size <= 512 * 1024 && !notes.has(key)) notes.set(key, { key, filename });
    }
  }
  return [...notes.values()];
}

async function inspectRepository(root) {
  if (!path.isAbsolute(root) || !fs.existsSync(path.join(root, '.git'))) return null;
  const options = { encoding: 'utf8', timeout: 2500, maxBuffer: 64 * 1024 };
  const checkout = fs.realpathSync((await execute('git', ['-C', root, 'rev-parse', '--show-toplevel'], options)).stdout.trim());
  const commonDir = fs.realpathSync(path.resolve(checkout, (await execute('git', ['-C', checkout, 'rev-parse', '--git-common-dir'], options)).stdout.trim()));
  const id = createHash('sha256').update(commonDir).digest('hex').slice(0, 24);
  return { id, name: path.basename(checkout), path: checkout, commonDir, keys: taskNotes(commonDir).map(note => note.key) };
}

export async function discoverRepositories({ roots, configPath = process.env.WORKBENCH_PREVIEW_DISCOVERY_CONFIG || path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml'), board = { repositories: [], tasks: [] } } = {}) {
  let configured = roots, configUnavailable = false;
  if (!configured) {
    try { configured = configuredProjectRoots(fs.readFileSync(configPath, 'utf8')); }
    catch { configured = []; configUnavailable = true; }
  }
  const candidates = [...new Set([...board.repositories.map(repository => repository.path), ...configured])];
  const pending = candidates.slice(0, 128), found = new Map();
  let unavailableRoots = 0;
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (pending.length) {
      const root = pending.shift();
      try {
        const repository = await inspectRepository(root);
        if (!repository || found.has(repository.id)) continue;
        const imported = new Set(board.tasks.filter(task => task.repositoryId === repository.id).map(task => task.key));
        const { keys, ...info } = repository;
        found.set(repository.id, { ...info, taskCount: keys.length, importableTaskCount: keys.filter(key => !imported.has(key)).length });
      } catch { unavailableRoots++; }
    }
  }));
  return { repositories: [...found.values()].sort((a, b) => b.importableTaskCount - a.importableTaskCount || a.name.localeCompare(b.name)), scannedRoots: Math.min(candidates.length, 128), unavailableRoots, configUnavailable, limited: candidates.length > 128, pickerAvailable: process.platform === 'darwin' };
}
