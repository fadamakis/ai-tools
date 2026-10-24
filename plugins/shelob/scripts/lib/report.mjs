import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { renderReportView } from '../../assets/dist/report-server.mjs';
import { escapeHtml as e } from '../../assets/report-model.mjs';
const asset = name => readFileSync(new URL(`../../assets/dist/${name}`, import.meta.url), 'utf8');
const logo = `data:image/png;base64,${readFileSync(new URL('../../assets/logo.png', import.meta.url)).toString('base64')}`;
// Keep exports usable for active reviews after an upgrade removes this cache.
const script = asset('export-client.js').replaceAll('</script', '<\\/script');
const css = asset('report.css').replaceAll('</style', '<\\/style');
export function renderReport(report) {
 const nonce = randomBytes(18).toString('base64');
 const data = JSON.stringify(report).replaceAll('<', '\\u003c');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:; base-uri 'none'; form-action 'none'"><title>Shelob · ${e(report.repository.name)}</title><style>${css}</style></head><body><a class="sr-only" href="#main">Skip to report</a><header class="product-bar"><div class="product-bar-inner"><span class="product-brand"><img src="${logo}" alt=""><span>Shelob</span></span><div id="export-theme"></div></div></header><div id="report-root">${renderReportView(report)}</div><script id="report-data" type="application/json" nonce="${nonce}">${data}</script><script nonce="${nonce}">${script}</script></body></html>`;
}
