import fs from 'node:fs';
import path from 'node:path';
import { digest, parsePatch } from './git.mjs';

// PR-only reviews cache changed-file snapshots, never a Git repository. Their
// immutable commit IDs and source bytes participate in the assessment digest.
export function loadPrSnapshot(filename) {
  const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (saved.format !== 1 || !Array.isArray(saved.files) || saved.files.length > 200 || saved.context?.scope !== 'branch') throw new Error('Invalid PR-only source snapshot.');
  const context = { ...saved.context, root: path.dirname(filename) };
  const files = saved.files.map(file => ({ ...file, lines: parsePatch(file.patch) }));
  const contentDigest = digest(JSON.stringify({ head: context.head, baseCommit: context.baseCommit, mergeBase: context.mergeBase,
    files: files.map(({ lines, ...file }) => file) }));
  return { context, files, contentDigest, prOnly: true };
}
