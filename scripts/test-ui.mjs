import { execFileSync } from 'node:child_process';
execFileSync(process.execPath,['scripts/preview.mjs'],{stdio:'inherit'});
for(const config of ['playwright.config.mjs','workbench.playwright.config.mjs']) execFileSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config',config],{stdio:'inherit'});
execFileSync(process.execPath,['../../node_modules/@playwright/test/cli.js','test'],{cwd:'plugins/sauron',stdio:'inherit'});
