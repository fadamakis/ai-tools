import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
for(const directory of ['plugins/shelob/tests','plugins/workbench/tests','tests/release']) {
 const tests=fs.readdirSync(directory).filter(name=>name.endsWith('.test.mjs')).map(name=>`${directory}/${name}`);
 execFileSync(process.execPath,['--test',...tests],{stdio:'inherit'});
}
const sauron=fs.readdirSync('plugins/sauron/tests').filter(name=>name.endsWith('.test.ts')).map(name=>`tests/${name}`);
execFileSync(process.execPath,['--import','tsx','--test',...sauron],{cwd:'plugins/sauron',stdio:'inherit'});
