import fs from 'node:fs';
import { promises as io } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from './dist/locking.mjs';

export class BoardPersistence {
  constructor(root) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.filename = path.join(this.root, 'board.json');
    this.lockfile = path.join(this.root, '.write-lock');
  }

  read() {
    if (!fs.existsSync(this.filename)) return { schemaVersion: 1, repositories: [], tasks: [], launches: [] };
    const data = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
    if (data.schemaVersion !== 1 || !['repositories', 'tasks', 'launches'].every(key => Array.isArray(data[key]))) throw new Error('This board needs a compatible Workbench version. Saved data was not changed.');
    return data;
  }

  async mutate(callback) {
    if (fs.existsSync(this.lockfile) && !fs.lstatSync(this.lockfile).isDirectory()) throw new Error('A legacy Workbench lock needs offline recovery. Stop old Workbench processes and run scripts/migrate-lock.mjs --root DATA_DIR --confirm-writers-stopped.');
    let compromised, ownership;
    const guardedFs = { ...fs, rmdir: (filename, callback) => {
      if (!ownership) return fs.rmdir(filename, callback);
      fs.lstat(filename, (error, current) => {
        if (error) return callback(error.code === 'ENOENT' ? null : error);
        if (current.ino !== ownership.ino || current.dev !== ownership.dev) {
          compromised = new Error('Workbench no longer owns this write lock.');
          return callback(compromised);
        }
        fs.rmdir(filename, callback);
      });
    } };
    const release = await lockfile.lock(this.root, {
      lockfilePath: this.lockfile, stale: 60000, update: 10000,
      fs: guardedFs,
      retries: { retries: 20, factor: 1, minTimeout: 100, maxTimeout: 100, randomize: false },
      onCompromised: error => { compromised = error; }
    });
    const temporary = path.join(this.root, `.board-${randomUUID()}.json`);
    let handle;
    try {
      ownership = await io.stat(this.lockfile);
      const data = this.read(), result = callback(data);
      if (result && typeof result.then === 'function') throw new Error('Board transactions must not perform asynchronous work.');
      handle = await io.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(data, null, 2) + '\n');
      await handle.sync(); await handle.close(); handle = null;
      const currentOwner = await io.stat(this.lockfile);
      if (compromised || currentOwner.ino !== ownership.ino || currentOwner.dev !== ownership.dev) throw compromised || new Error('Workbench lost its write lock; saved data was not replaced.');
      await io.rename(temporary, this.filename);
      const directory = await io.open(this.root, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      return result;
    } finally {
      try {
        try { await handle?.close(); } finally { await io.rm(temporary, { force: true }); }
      } finally {
        try { await release(); } catch (error) { if (!compromised) throw error; }
      }
    }
  }
}
