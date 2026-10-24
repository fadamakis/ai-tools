import { execFileSync } from 'node:child_process';
for(const script of ['scripts/build.mjs','scripts/workbench-build.mjs']) execFileSync(process.execPath,[script],{stdio:'inherit'});
execFileSync(process.execPath,['../../node_modules/typescript/bin/tsc','--noEmit'],{cwd:'plugins/sauron',stdio:'inherit'});
execFileSync(process.execPath,['scripts/build.mjs'],{cwd:'plugins/sauron',stdio:'inherit'});
