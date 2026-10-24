import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Generate a local adapter without changing host settings or installing it.
// Point at the tested workspace runtime so cache refreshes cannot remove state.
export async function prepareLocalPlugin({
  projectRoot = fileURLToPath(new URL('..', import.meta.url)),
  outputDir = resolve(projectRoot, 'local-plugin'),
  databasePath = resolve(projectRoot, '.data/sidebar-verification.sqlite'),
} = {}) {
  const adapterRoot = resolve(outputDir);
  if (adapterRoot === resolve(projectRoot)) throw new Error('Adapter must be separate from the portable project.');
  const manifest = JSON.parse(await readFile(resolve(projectRoot, 'plugin.json'), 'utf8'));
  const { name, version, description, author } = manifest;
  await mkdir(resolve(adapterRoot, '.codex-plugin'), { recursive: true });
  await mkdir(resolve(adapterRoot, 'assets'), { recursive: true });
  await writeFile(resolve(adapterRoot, 'assets/sauron.png'), await readFile(resolve(projectRoot, 'assets/sauron.png')));
  await writeFile(resolve(adapterRoot, 'assets/sidebar-icon.svg'), await readFile(resolve(projectRoot, 'assets/sidebar-icon.svg')));
  await writeFile(resolve(adapterRoot, '.codex-plugin/plugin.json'), JSON.stringify({
    name, version, description, author,
    skills: './skills/', mcpServers: './.mcp.json',
    interface: manifest.extensions['com.openai'].interface,
  }, null, 2) + '\n');
  await writeFile(resolve(adapterRoot, '.mcp.json'), JSON.stringify({
    mcpServers: {
      sauron: {
        type: 'stdio', command: process.execPath,
        args: [resolve(projectRoot, 'dist/server/index.js')],
        cwd: projectRoot,
        env: { ATTENTION_DB: resolve(databasePath) },
      },
    },
  }, null, 2) + '\n');
  // Remove only prior generated manifests; the portable source remains canonical.
  await rm(resolve(adapterRoot, 'plugin.json'), { force: true });
  await rm(resolve(adapterRoot, 'mcp.json'), { force: true });
  await mkdir(resolve(adapterRoot, 'skills/update-sauron'), { recursive: true });
  await writeFile(resolve(adapterRoot, 'skills/update-sauron/SKILL.md'),
    await readFile(resolve(projectRoot, 'skills/update-sauron/SKILL.md'), 'utf8'));
  return adapterRoot;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(await prepareLocalPlugin());
}
