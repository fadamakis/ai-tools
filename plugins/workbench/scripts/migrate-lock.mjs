import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function migrateLock({ root, writersStopped = false }) {
  if (!writersStopped) throw new Error('Stop all old Workbench processes and pass --confirm-writers-stopped.');
  if (!root) throw new Error('Provide --root DATA_DIR.');
  const filename = path.join(path.resolve(root), '.write-lock');
  if (!fs.existsSync(filename)) return { status: 'not-needed' };
  const stat = fs.lstatSync(filename);
  if (stat.isDirectory()) return { status: 'current-format' };
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64) throw new Error('Unexpected lock format; no files changed.');
  const text = fs.readFileSync(filename, 'utf8').trim();
  const pid = /^\d+$/.test(text) ? Number(text) : 0;
  if (pid > 0) {
    try { process.kill(pid, 0); throw new Error('The recorded lock owner is alive; recovery refused.'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  const archived = `${filename}.legacy-${randomUUID()}`;
  fs.renameSync(filename, archived);
  return { status: 'recovered', archived };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--root' && args[i + 1]) options.root = args[++i];
      else if (args[i] === '--confirm-writers-stopped') options.writersStopped = true;
      else throw new Error('Use --root DATA_DIR --confirm-writers-stopped.');
    }
    console.log(JSON.stringify(migrateLock(options)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
