import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '../scripts/lib/git.mjs';
import { resolveCodexCli } from './codex-cli.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}`;
  try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
}

export class ReviewSettings {
  constructor(root) { this.root = root; this.file = path.join(root, 'settings.json'); this.failure = path.join(root, 'review-setup-failure.json'); }
  get() {
    const data = fs.existsSync(this.file) ? read(this.file) : { model: null };
    return { model: data.model, revision: digest(JSON.stringify(data)) };
  }
  save({ model, revision, retryRejectedSetup = false }) {
    if (model !== null && (typeof model !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(model))) throw new Error('Enter a valid Codex review model, or leave it blank for the CLI default.');
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const lock = path.join(this.root, '.settings-save');
    let fd;
    try { fd = fs.openSync(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      if (Number.isInteger(pid) && pid > 0 && !alive(pid)) { fs.unlinkSync(lock); return this.save({ model, revision, retryRejectedSetup }); }
      throw new Error('Settings are being saved in another window. Try again.');
    }
    try {
      fs.writeSync(fd, String(process.pid));
      if (this.get().revision !== revision) throw new Error('Settings changed in another window. Reopen Settings before saving.');
      atomicJson(this.file, { model });
      if (retryRejectedSetup && this.rejected(this.signature(model))) fs.rmSync(this.failure, { force: true });
      return this.get();
    } finally { fs.closeSync(fd); fs.rmSync(lock, { force: true }); }
  }
  signature(model) {
    const cli = resolveCodexCli();
    const config = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
    let configuration = '', executable = '';
    try { configuration = digest(fs.readFileSync(config)); } catch {}
    try { const stat = fs.statSync(cli); executable = `${stat.mtimeMs}:${stat.size}`; } catch {}
    return digest(JSON.stringify([model || null, cli, executable, configuration]));
  }
  rejected(signature) {
    if (!fs.existsSync(this.failure)) return null;
    const failure = read(this.failure);
    return failure.signature === signature ? failure : null;
  }
  recordFailure(signature, message) {
    if (/model .*not support|not support.*model/i.test(message)) atomicJson(this.failure, { signature, message, checkedAt: new Date().toISOString() });
  }
}
