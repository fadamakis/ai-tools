import fs from 'node:fs';
import path from 'node:path';
import { digest, git, readVersion } from './git.mjs';
import { commentDraft } from '../../assets/finding-policy.mjs';

export const CATEGORIES = ['Size & Focus', 'Independence', 'Tests', 'Description', 'Visual Evidence'];
const CHECKS = new Set(['change-size', 'area-spread', 'test-markers', 'assertion-delta', 'relaxed-gates']);
const isTest = name => /\.(?:[cm]?[jt]sx?|py)$/.test(name) && /(?:^|\/)(?:__tests__\/.*|tests?\/.*|test_[^/]*\.py$|[^/]*_test\.py$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name);
const isSource = name => /\.(?:[cm]?[jt]sx?|py|vue|svelte)$/.test(name);
const isGate = name => /(?:^|\/)(?:\.github\/workflows\/.*\.ya?ml|(?:jest|vitest|coverage|nyc|stryker)[^/]*\.(?:json|[cm]?[jt]s|ya?ml)|(?:package\.json|pyproject\.toml|pytest\.ini|tox\.ini|setup\.cfg|Jenkinsfile))$/.test(name);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export const isTestFile = isTest;

export function globMatches(file, pattern) {
  let regex = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { i++; regex += '(?:.*/)?'; } else regex += '.*';
    } else if (c === '*') regex += '[^/]*';
    else if (c === '?') regex += '[^/]';
    else regex += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${regex}$`).test(file);
}

export function loadPack(filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const pack = JSON.parse(source);
  validatePack(pack);
  return { ...pack, source: path.resolve(filename), digest: digest(source) };
}

export function validatePack(pack) {
  if (pack.schemaVersion !== '1.0.0' || !nonempty(pack.id) || !/^\d+\.\d+\.\d+$/.test(pack.version) || !Array.isArray(pack.rules) || !pack.rules.length) throw new Error('Invalid rule pack: expected schemaVersion 1.0.0, ID, semantic version, and a nonempty rules array.');
  const ids = new Set();
  const patterns = value => Array.isArray(value) && value.every(v => nonempty(v) && !v.startsWith('/') && !v.split('/').includes('..'));
  if (pack.exclude !== undefined && !patterns(pack.exclude)) throw new Error('Invalid rule-pack exclusions. Use relative glob patterns.');
  for (const rule of pack.rules) {
    if (!/^[A-Z][A-Z0-9-]{1,63}$/.test(rule.id) || ids.has(rule.id) || rule.id === 'CODEX-REVIEW') throw new Error('Rule IDs must be unique uppercase identifiers; CODEX-REVIEW is reserved.');
    ids.add(rule.id);
    if (!nonempty(rule.title) || !nonempty(rule.rationale) || !nonempty(rule.category) || !['info', 'warning', 'error'].includes(rule.severity) || !patterns(rule.scope) || !rule.scope.length) throw new Error(`Invalid metadata or scope for rule ${rule.id}.`);
    if (rule.mode === 'deterministic') {
      if (!CHECKS.has(rule.check)) throw new Error(`Unknown deterministic check for ${rule.id}. A rule pack cannot execute custom code.`);
      const keys = rule.check === 'change-size' ? ['maxLines', 'maxFiles'] : rule.check === 'area-spread' ? ['maxAreas'] : [];
      for (const key of keys) if (!Number.isInteger(rule.options?.[key]) || rule.options[key] < 1) throw new Error(`Rule ${rule.id} needs a positive integer ${key}.`);
    } else if (rule.mode !== 'contextual' || !nonempty(rule.instructions)) throw new Error(`Rule ${rule.id} needs a supported mode and contextual instructions when applicable.`);
  }
  return pack;
}

// A lexical mask, not a language parser. Preserve newlines and columns for evidence.
// Template expressions are deliberately masked; unsupported syntax is a coverage limit.
export function codeOnly(source, python = false) {
  let out = '', state = 'code', quote = '', escaped = false, inClass = false, previous = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } else out += ' '; continue; }
    if (state === 'block') { if (c === '*' && next === '/') { out += '  '; i++; state = 'code'; } else out += c === '\n' ? c : ' '; continue; }
    if (state === 'string' || state === 'triple' || state === 'regex') {
      if (escaped) { escaped = false; out += c === '\n' ? c : ' '; continue; }
      if (c === '\\') { escaped = true; out += ' '; continue; }
      if (state === 'triple' && source.slice(i, i + 3) === quote.repeat(3)) { out += '   '; i += 2; state = 'code'; continue; }
      if (state === 'regex') {
        if (c === '[') inClass = true;
        if (c === ']') inClass = false;
        if (c === '/' && !inClass) state = 'code';
      } else if (state === 'string' && c === quote) state = 'code';
      out += c === '\n' ? c : ' '; continue;
    }
    if ((!python && c === '/' && next === '/') || (python && c === '#')) { state = 'line'; out += ' '; continue; }
    if (!python && c === '/' && next === '*') { state = 'block'; out += '  '; i++; continue; }
    if (c === '"' || c === "'" || (!python && c === '`')) {
      quote = c;
      if (python && source.slice(i, i + 3) === c.repeat(3)) { state = 'triple'; out += '   '; i += 2; }
      else { state = 'string'; out += ' '; }
      continue;
    }
    if (!python && c === '/' && (!previous || /[=(:,\[!&|?;{}]/.test(previous))) { state = 'regex'; inClass = false; out += ' '; continue; }
    out += c;
    if (!/\s/.test(c)) previous = c;
  }
  return out;
}

const codeLines = (file, side) => codeOnly(file[side] || '', file.path.endsWith('.py')).split('\n');
const firstEvidence = file => {
  const change = file.lines.find(line => line.side === 'after') || file.lines[0];
  return change ? { path: file.path, line: change.line, side: change.side, snippet: change.text } : { path: file.path, line: null, side: 'after', snippet: '' };
};
const evidenceAt = (file, side, line) => ({ path: file.path, side, line, snippet: (file[side] || '').split('\n')[line - 1] || '' });
const assertions = code => [...code.matchAll(/\bexpect\s*\(|\bassert\s*(?:\(|\.|\b(?=\s+\S))|\b(?:self|cls)\.assert\w+\s*\(/g)].length;
const markerRegex = /\b(?:it|test|describe)\s*\.\s*(?:only|skip)\s*(?:\(|\.)|@(?:pytest\.mark\.(?:skipif|skip)|unittest\.(?:skipIf|skipUnless|skip))\b/g;

export function finding(rule, title, message, nextAction, evidence, origin = 'deterministic', options = {}) {
  const item = { id: `${rule.id}:${digest(JSON.stringify([title, evidence.map(e => [e.path, e.side, e.line])])).slice(0, 12)}`, ruleId: rule.id, severity: options.severity || rule.severity, category: rule.category, title, message, nextAction, evidence, origin };
  const firstSentence = message.split(/(?<=\.)\s+/)[0];
  const drafts = {
    'change-size': `${firstSentence} Could we split any independent parts, or explain why they belong together?`,
    'area-spread': 'Could you briefly explain what connects the changed areas? A split would help if any parts can stand alone.',
    'test-markers': `${firstSentence} Is excluding these tests intentional? If not, could we remove the marker?`,
    'assertion-delta': `${firstSentence} Are the removed checks covered by helpers or replacement assertions?`,
    'relaxed-gates': `${firstSentence} Is this relaxation intentional, and which failures can it hide?`,
  };
  item.comment = options.comment || (origin === 'deterministic' && drafts[rule.check]) || commentDraft(item);
  return item;
}

function checkRule(rule, files) {
  const findings = [];
  let reason = 'This check found no issue.';
  let applicable = files;
  if (['test-markers', 'assertion-delta'].includes(rule.check)) applicable = files.filter(f => isTest(f.path));
  if (rule.check === 'relaxed-gates') applicable = files.filter(f => isGate(f.path));
  if (!applicable.length) return { status: 'not_applicable', reason: 'This check does not apply to the changed files.', findings };
  const limited = applicable.filter(f => f.limitation || f.binary);
  const inspectable = applicable.filter(f => !f.limitation && !f.binary);
  if (rule.check === 'change-size') {
    const churn = files.reduce((sum, file) => sum + file.added + file.deleted, 0);
    if (churn > rule.options.maxLines || files.length > rule.options.maxFiles) findings.push(finding(rule, 'Large change', `${churn} changed lines in ${files.length} files. The advisory limits are ${rule.options.maxLines} lines and ${rule.options.maxFiles} files.`, 'Check whether the changes belong together. Explain the size, or suggest parts that can stand alone.', files.slice(0, 6).map(firstEvidence)));
    reason = `${churn} changed lines in ${files.length} files. Advisory limits are ${rule.options.maxLines} lines and ${rule.options.maxFiles} files.`;
  } else if (rule.check === 'area-spread') {
    const areas = [...new Set(files.map(f => f.path.includes('/') ? f.path.split('/')[0] : '(root)'))].sort();
    if (areas.length > rule.options.maxAreas) findings.push(finding(rule, 'Changes span several areas', `${areas.length} areas changed. The advisory limit is ${rule.options.maxAreas}. Areas: ${areas.join(', ')}. This count does not tell us whether the changes belong together.`, 'Check what connects these changes before suggesting a split.', files.slice(0, 6).map(firstEvidence)));
    reason = `${areas.length} top-level areas changed. The advisory limit is ${rule.options.maxAreas}. An agent still needs to review whether the changes belong together.`;
  } else if (rule.check === 'test-markers') {
    const previousCounts = new Map(), occurrences = [];
    for (const file of inspectable) {
      for (const match of codeOnly(file.before || '', file.path.endsWith('.py')).matchAll(markerRegex)) {
        const marker = match[0].replace(/\s+/g, '');
        previousCounts.set(marker, (previousCounts.get(marker) || 0) + 1);
      }
      const afterCode = codeLines(file, 'after');
      const addedLines = new Set(file.lines.filter(l => l.side === 'after').map(l => l.line));
      occurrences.push(...afterCode.flatMap((line, i) => [...line.matchAll(markerRegex)].map(match => ({ file, marker: match[0].replace(/\s+/g, ''), line: i + 1, added: addedLines.has(i + 1) }))));
    }
    const afterCounts = new Map();
    for (const item of occurrences) afterCounts.set(item.marker, (afterCounts.get(item.marker) || 0) + 1);
    for (const [marker, count] of afterCounts) {
      if (count <= (previousCounts.get(marker) || 0)) continue;
      const introduced = occurrences.find(item => item.marker === marker && item.added);
      if (introduced) findings.push(finding(rule, 'New skip or focus marker', `The change adds ${marker.replace(/[.(]+$/, '')}. This can keep tests out of a normal run.`, 'Remove the marker if it was accidental. Otherwise, explain why these tests should stay out of a normal run.', [evidenceAt(introduced.file, 'after', introduced.line)]));
    }
    reason = 'Shelob compared JS, TS, and Python test markers before and after the change. It ignored strings and comments.';
  } else if (rule.check === 'assertion-delta') {
    const before = inspectable.reduce((n, file) => n + assertions(codeOnly(file.before || '', file.path.endsWith('.py'))), 0);
    const after = inspectable.reduce((n, file) => n + assertions(codeOnly(file.after || '', file.path.endsWith('.py'))), 0);
    if (before > after) {
      const evidence = inspectable.flatMap(file => {
        const code = codeLines(file, 'before');
        return file.lines.filter(l => l.side === 'before' && assertions(code[l.line - 1] || '') > 0).map(l => evidenceAt(file, 'before', l.line));
      }).slice(0, 6);
      findings.push(finding(rule, 'Fewer assertions', `Shelob counted ${before} assertion calls before this change and ${after} after. The count covers all changed test files, so moving assertions between them does not trigger this check.`, 'Check what the removed assertions covered and whether helpers replace them. Fewer assertions can still provide the same coverage.', evidence));
    }
    reason = `Shelob counted ${before} assertion calls before the change and ${after} after. It did not run the tests.`;
  } else if (rule.check === 'relaxed-gates') {
    for (const file of inspectable) {
      const before = (file.before || '').split('\n'), after = (file.after || '').split('\n');
      const relaxed = line => {
        if (/^\s*continue-on-error\s*:\s*true\s*(?:#.*)?$/.test(line)) return true;
        let command = line.replace(/^\s*-?\s*(?:run|script)\s*:\s*/, '');
        if (command !== line && /^(["'])[\s\S]*\1$/.test(command.trim())) command = command.trim().slice(1, -1);
        return /\|\|\s*true\b/.test(codeOnly(command, true));
      };
      const oldCount = before.filter(relaxed).length;
      const newMatches = after.map((line, index) => ({ line, number: index + 1 })).filter(x => relaxed(x.line));
      if (newMatches.length > oldCount) {
        const added = new Set(file.lines.filter(l => l.side === 'after').map(l => l.line));
        const match = newMatches.find(x => added.has(x.number));
        if (match) findings.push(finding(rule, 'A failed check can leave CI green', 'The change adds continue-on-error or || true. Either setting can let a command fail without failing the run.', 'Check which failure this setting ignores and whether that is intentional.', [evidenceAt(file, 'after', match.number)]));
      }
      const threshold = /["']?\b(lines|branches|functions|statements)\b["']?\s*[:=]\s*(\d+(?:\.\d+)?)/g;
      const thresholds = lines => new Map(lines.flatMap((text, index) => /^\s*(?:#|\/\/)/.test(text) ? [] : [...text.matchAll(threshold)].map(m => [m[1], { value: Number(m[2]), line: index + 1 }])));
      const oldThresholds = thresholds(before), newThresholds = thresholds(after);
      for (const [key, value] of newThresholds) {
        if (oldThresholds.has(key) && value.value < oldThresholds.get(key).value) findings.push(finding(rule, 'Lower coverage requirement', `${key} fell from ${oldThresholds.get(key).value} to ${value.value} in ${file.path}.`, 'Explain why the coverage limit fell and check that it does not hide a regression.', [evidenceAt(file, 'after', value.line)]));
      }
    }
    reason = 'Shelob checked known CI and test settings for ignored failures and lower coverage limits.';
  }
  const sourceCheck = ['test-markers', 'assertion-delta', 'relaxed-gates'].includes(rule.check);
  return { status: sourceCheck && limited.length ? 'not_assessed' : findings.length ? 'findings' : 'assessed', reason: sourceCheck && limited.length ? `${reason} Shelob could not read ${limited.map(f => f.path).join(', ')}.` : reason, findings };
}

export function assessRules(repository, pack, description) {
  return pack.rules.map(rule => {
    const files = repository.files.filter(file => rule.scope.some(p => globMatches(file.path, p)) && !(pack.exclude || []).some(p => globMatches(file.path, p)));
    let outcome;
    if (!files.length) outcome = { status: 'not_applicable', reason: 'No changed files match this rule after exclusions.', findings: [] };
    else if (rule.mode === 'deterministic') outcome = checkRule(rule, files);
    else if (rule.id === 'DESCRIPTION-001' && !description) outcome = { status: 'not_assessed', reason: 'Add a draft PR description to check this rule.', findings: [] };
    else if (rule.id === 'TEST-003' && !files.some(f => isSource(f.path))) outcome = { status: 'not_applicable', reason: 'No changed source or test files match this rule.', findings: [] };
    else outcome = { status: 'not_assessed', reason: 'This check needs an agent review.', findings: [] };
    return { ruleId: rule.id, title: rule.title, category: rule.category, severity: rule.severity, mode: rule.mode, rationale: rule.rationale, instructions: rule.instructions || null, matchedFiles: files.map(f => f.path), ...outcome };
  });
}

function validateEvidence(item, repository, description) {
  if (!item || !nonempty(item.path) || !Number.isInteger(item.line) || item.line < 1 || !['before', 'after', undefined].includes(item.side)) throw new Error('Each contextual finding needs a relative source path, side, and positive line number.');
  const side = item.side || 'after';
  let source;
  if (item.path === '@description') {
    if (!description) throw new Error('Description evidence was supplied without a description.');
    source = description;
  } else {
    if (path.isAbsolute(item.path) || item.path.split(/[\\/]/).includes('..') || item.path.includes('\0')) throw new Error('Evidence must stay inside the reviewed repository.');
    const changed = repository.files.find(file => file.path === item.path);
    if (changed) source = changed[side];
    else {
      if (repository.prOnly) throw new Error('PR-only review includes changed files only. Use a local copy to review related files.');
      if (side !== 'after') throw new Error('Before-side evidence must refer to a changed file.');
      if (git(repository.context.root, ['ls-files', '--error-unmatch', '--', item.path], { optional: true }) === null) throw new Error('Related contextual evidence must refer to a tracked file.');
      const revision = repository.context.scope === 'branch' ? repository.context.head : repository.context.scope === 'staged' ? 'index' : 'working';
      source = readVersion(repository.context.root, item.path, revision).content;
    }
  }
  if (source === null || source === undefined || source.includes('\0')) throw new Error('Evidence refers to uninspected or binary source.');
  const lines = source.split('\n');
  if (item.line > lines.length) throw new Error('Evidence line does not exist in the selected snapshot.');
  const snippet = lines[item.line - 1];
  if (item.snippet !== undefined && item.snippet !== snippet) throw new Error('Evidence snippet does not match the selected snapshot. Reread the source.');
  return { path: item.path, side, line: item.line, snippet };
}

export function mergeAssessments(results, supplied, snapshotId, repository, pack, description) {
  if (supplied.schemaVersion !== '1.0.0' || supplied.snapshotId !== snapshotId || !Array.isArray(supplied.assessments)) throw new Error('Assessment snapshot mismatch or invalid schema. Rerun the scanner and review the current snapshot.');
  if (supplied.execution && (!['completed', 'incomplete'].includes(supplied.execution.status) || !nonempty(supplied.execution.reason))) throw new Error('Execution needs a completion status and an explanation.');
  const seen = new Set();
  for (const assessment of supplied.assessments) {
    const rule = pack.rules.find(r => r.id === assessment.ruleId);
    const result = results.find(r => r.ruleId === assessment.ruleId);
    if (!rule || rule.mode !== 'contextual' || seen.has(rule.id)) throw new Error('Assessments must uniquely reference contextual rules; deterministic results cannot be overridden.');
    seen.add(rule.id);
    if (!result.matchedFiles.length || (rule.id === 'DESCRIPTION-001' && !description)) throw new Error('Cannot assess a rule without its required input.');
    if (!['assessed', 'findings', 'not_assessed', 'not_applicable'].includes(assessment.status) || !nonempty(assessment.reason)) throw new Error('Each assessment needs an outcome and an explanation.');
    const items = assessment.findings || [];
    if (!Array.isArray(items) || (assessment.status === 'findings') !== (items.length > 0)) throw new Error('A findings outcome needs findings; other outcomes must not contain them.');
    result.findings = items.map(item => {
      if (!nonempty(item.title) || !nonempty(item.message) || !nonempty(item.nextAction) || !Array.isArray(item.evidence) || !item.evidence.length) throw new Error('A contextual finding needs a title, triggering behavior, next action, and source evidence.');
      const evidence = item.evidence.map(e => validateEvidence(e, repository, description));
      if (!evidence.some(e => e.path === '@description' || repository.files.some(f => f.path === e.path))) throw new Error('A contextual finding must connect its evidence to the selected change.');
      if (item.severity !== undefined && !['error', 'warning', 'info'].includes(item.severity)) throw new Error('Finding severity must be error, warning, or info.');
      if (rule.severity === 'error' && item.severity && item.severity !== 'error') throw new Error('A finding cannot weaken a rule configured as blocking.');
      if (item.comment !== undefined && (!nonempty(item.comment) || item.comment.length > 600)) throw new Error('A PR comment must contain 1 to 600 characters.');
      if (item.duplicateOf !== undefined && !nonempty(item.duplicateOf)) throw new Error('A duplicate needs a finding reference.');
      return { ...finding(rule, item.title, item.message, item.nextAction, evidence, 'contextual', item), ...(item.duplicateOf ? { duplicateOf: item.duplicateOf } : {}) };
    });
    result.status = assessment.status;
    result.reason = assessment.reason;
    result.reviewMethod = 'Agent review. Shelob checked the source references and snapshot.';
  }
  return results;
}
