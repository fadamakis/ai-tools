import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture, beforeDemo, weakenDemo } from '../plugins/shelob/tests/fixtures.mjs';
import { createReport, writeReport } from '../plugins/shelob/scripts/shelob.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelob-demo-'));
const item = fixture(beforeDemo, root);
weakenDemo(item);
const descriptionFile = path.join(root, 'description.md');
fs.writeFileSync(descriptionFile, 'Update the discount calculation and the confirmation card.\n\nWhy: simplify the calculation for the demo.\n\nVerification: source inspection only; no runtime checks performed.\n');
const report = createReport({ repo: item.repo, base: 'main', scope: 'all', descriptionFile });
const outputs = writeReport(report, path.join(root, 'report'));
console.log(JSON.stringify({ demoRoot: root, repository: item.repo, descriptionFile, snapshotId: report.snapshot.id, findings: report.results.flatMap(r => r.findings).map(f => ({ rule: f.ruleId, title: f.title })), outputs }, null, 2));
