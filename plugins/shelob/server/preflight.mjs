import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '../scripts/lib/git.mjs';
import { atomicJson } from './settings.mjs';

export const connectionLifetimeMs = 45_000;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
const processAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

// Identify the existing directory without exposing its path or creating an ID
// file. Copies and replaced directories differ; a symlink to this store agrees.
export function storeFingerprint(root) {
  const canonical = fs.realpathSync(root), stat = fs.statSync(canonical, { bigint: true });
  return digest(JSON.stringify([canonical, String(stat.dev), String(stat.ino)]));
}

export class ReviewPreflight {
  constructor({ store, policy, version, runtimeFingerprint, clock = Date.now, alive = processAlive }) {
    Object.assign(this, { store, policy, version, runtimeFingerprint, clock, alive });
    this.serverInstanceId = randomUUID();
    this.fingerprint = storeFingerprint(store.root);
    this.directory = path.join(store.root, 'ui-connections');
    this.resources = new Map();
  }
  identity() {
    if (storeFingerprint(this.store.root) !== this.fingerprint) throw Error('The store directory changed. Restart this Shelob server.');
    return { protocolVersion: 1, serverInstanceId: this.serverInstanceId, storeFingerprint: this.fingerprint,
      pluginVersion: this.version, runtimeFingerprint: this.runtimeFingerprint };
  }
  resource() {
    const resourceNonce = randomUUID();
    this.resources.set(resourceNonce, null);
    if (this.resources.size > 128) this.resources.delete(this.resources.keys().next().value);
    return { ...this.identity(), resourceNonce };
  }
  hasDirectory() {
    if (!fs.existsSync(this.directory)) return false;
    const stat = fs.lstatSync(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Shelob UI connection records are unavailable.');
    return true;
  }
  // App-only: the rendered resource acknowledges its own nonce. Reading the
  // resource, starting a process, and calling preflight never register a UI.
  heartbeat({ resourceNonce, connectionId, appVersion, visible }) {
    if (!uuid.test(connectionId) || !this.resources.has(resourceNonce)) throw Error('Reopen Shelob to connect this window to its server.');
    if (appVersion !== this.version) throw Error('This Shelob window uses an older app. Reopen it after restarting Codex.');
    const bound = this.resources.get(resourceNonce);
    if (bound && bound !== connectionId) throw Error('This resource belongs to another Shelob window.');
    const identity = this.identity(), policy = this.policy.get(), checkedAt = this.clock();
    this.resources.set(resourceNonce, connectionId);
    const receipt = { ...identity, connectionId, visible, ownerPid: process.pid, checkedAt,
      expiresAt: checkedAt + connectionLifetimeMs, policy };
    if (!this.hasDirectory()) fs.mkdirSync(this.directory, { mode: 0o700 });
    atomicJson(path.join(this.directory, `${connectionId}.json`), receipt);
    return { connection: this.publicReceipt(receipt), policy };
  }
  publicReceipt({ ownerPid, ...receipt }) { return receipt; }
  receipts() {
    if (!this.hasDirectory()) return [];
    return fs.readdirSync(this.directory).filter(name => uuid.test(name.replace(/\.json$/, '')) && name.endsWith('.json')).flatMap(name => {
      try {
        const file = path.join(this.directory, name), stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) return [];
        const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (receipt.protocolVersion !== 1 || `${receipt.connectionId}.json` !== name || !uuid.test(receipt.serverInstanceId)
          || !hash.test(receipt.storeFingerprint) || !hash.test(receipt.runtimeFingerprint) || !Number.isSafeInteger(receipt.ownerPid)
          || receipt.ownerPid <= 0 || typeof receipt.visible !== 'boolean' || !Number.isFinite(receipt.checkedAt)
          || receipt.expiresAt !== receipt.checkedAt + connectionLifetimeMs || typeof receipt.policy?.enabled !== 'boolean'
          || !hash.test(receipt.policy?.revision)) return [];
        return [receipt];
      } catch { return []; }
    });
  }
  read({ connectionId, expectedStoreFingerprint, target } = {}) {
    const server = this.identity(), policy = this.policy.get(), now = this.clock();
    const receipts = this.receipts();
    const live = receipts.filter(receipt => receipt.visible && receipt.checkedAt <= now && receipt.expiresAt > now && this.alive(receipt.ownerPid));
    const chosen = connectionId ? receipts.find(receipt => receipt.connectionId === connectionId) : live.length === 1 ? live[0] : null;
    let status = 'matched';
    if (expectedStoreFingerprint && expectedStoreFingerprint !== server.storeFingerprint) status = 'store_mismatch';
    else if (!chosen) status = !connectionId && live.length > 1 ? 'choose_ui_connection' : 'ui_unverified';
    else if (chosen.storeFingerprint !== server.storeFingerprint) status = 'store_mismatch';
    else if (!this.alive(chosen.ownerPid)) status = 'ui_server_stopped';
    else if (!chosen.visible || chosen.checkedAt > now || chosen.expiresAt <= now) status = 'stale_ui_connection';
    else if (chosen.pluginVersion !== server.pluginVersion || chosen.runtimeFingerprint !== server.runtimeFingerprint) status = 'stale_ui_server';
    else if (chosen.policy.revision !== policy.revision) status = 'stale_ui_policy';
    const history = target ? this.store.history(target) : null;
    const blockers = [...(status !== 'matched' ? [status] : []), ...(policy.enabled ? ['automatic_approval_enabled'] : []),
      ...(history && !history.complete ? ['history_incomplete'] : []), ...(history?.reviews.some(review => !review.headSha) ? ['review_head_unknown'] : [])];
    const completed = history?.reviews.filter(review => review.headMatches && review.execution?.state === 'completed') || [];
    const active = history?.reviews.filter(review => (review.headMatches || !review.headSha) && review.active) || [];
    const decision = blockers.length ? 'blocked' : completed.length ? 'skip_completed' : active.length ? 'join_active' : target ? 'ready' : 'identity_verified';
    return { schemaVersion: 1, checkedAt: new Date(now).toISOString(), server, status,
      ui: chosen ? { ...this.publicReceipt(chosen), sameServerProcess: chosen.serverInstanceId === server.serverInstanceId } : null,
      availableConnections: live.map(receipt => ({ connectionId: receipt.connectionId, pluginVersion: receipt.pluginVersion })),
      policy, automaticPublicActions: policy.enabled ? ['approve_clean_review'] : [], manualPublicationRequiresConfirmation: true,
      history, decision, blockers, safeToReview: decision === 'ready' };
  }
}
