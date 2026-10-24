import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validatePack } from '../scripts/lib/rules.mjs';
import { digest } from '../scripts/lib/git.mjs';

const baseline = fileURLToPath(new URL('../rules/baseline.json', import.meta.url));
// Upgrades may remove this process's installation while a review is active.
// Retain the shipped default; user-selected files are still read when requested.
const baselineSource = fs.readFileSync(baseline, 'utf8');
const text = pack => JSON.stringify(pack, null, 2) + '\n';
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

// User settings live outside the installation. Every saved revision and review
// gets its own immutable pack; editing settings never changes a running review.
export class RuleLibrary {
  constructor(root) { this.directory = path.join(root, 'rules'); this.current = path.join(this.directory, 'current.json'); }
  get() {
    const customized = fs.existsSync(this.current);
    const source = customized ? fs.readFileSync(this.current, 'utf8') : baselineSource;
    const pack = validatePack(JSON.parse(source));
    return { pack, revision: digest(source), customized };
  }
  snapshot(destination, selectedFile) {
    const source = selectedFile ? fs.readFileSync(selectedFile, 'utf8') : fs.existsSync(this.current) ? fs.readFileSync(this.current, 'utf8') : baselineSource;
    validatePack(JSON.parse(source));
    fs.writeFileSync(destination, source, { flag: 'wx', mode: 0o600 });
  }
  save({ revision, rule, originalId }) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const lock = path.join(this.directory, '.saving');
    // Saves are synchronous and bounded. Atomic creation also excludes a second
    // server process; a revision check prevents overwriting another app window.
    let descriptor;
    try { descriptor = fs.openSync(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      if (Number.isInteger(pid) && pid > 0 && !alive(pid)) { fs.unlinkSync(lock); return this.save({ revision, rule, originalId }); }
      throw new Error('Rules are being saved in another window. Try again.');
    }
    let temporary;
    try {
      fs.writeSync(descriptor, String(process.pid));
      const current = this.get();
      if (revision !== current.revision) throw new Error('Rules changed in another window. Reload the rules before saving.');
      const pack = structuredClone(current.pack);
      const index = pack.rules.findIndex(item => item.id === (originalId || rule.id));
      if (originalId) {
        if (index < 0 || rule.id !== originalId) throw new Error('The rule ID cannot change. Reload the rules.');
        const existing = pack.rules[index];
        if (rule.mode !== existing.mode || rule.check !== existing.check) throw new Error('The review method cannot change for an existing rule.');
        pack.rules[index] = rule;
      } else {
        if (index >= 0) throw new Error('This rule ID already exists. Choose another ID.');
        if (rule.mode !== 'contextual') throw new Error('New rules must use agent review. Custom code cannot run from a rule.');
        if (pack.rules.length >= 200) throw new Error('A rule library can contain at most 200 rules.');
        pack.rules.push(rule);
      }
      validatePack(pack);
      const [major, minor, patch] = pack.version.split('.').map(Number);
      pack.version = `${major}.${minor}.${patch + 1}`;
      if (!current.customized) { pack.id = 'shelob-personal'; pack.name = 'My Shelob rules'; pack.description = 'Rules saved in Shelob. Used for new managed reviews unless an external pack is selected.'; }
      const source = text(pack), hash = digest(source);
      const versions = path.join(this.directory, 'versions'); fs.mkdirSync(versions, { recursive: true, mode: 0o700 });
      const version = path.join(versions, `${hash}.json`);
      if (!fs.existsSync(version)) fs.writeFileSync(version, source, { flag: 'wx', mode: 0o600 });
      temporary = path.join(this.directory, `.current-${randomUUID()}.json`);
      fs.writeFileSync(temporary, source, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, this.current);
      return this.get();
    } finally { fs.closeSync(descriptor); fs.rmSync(lock, { force: true }); if (temporary) fs.rmSync(temporary, { force: true }); }
  }
}
