import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const executable = filename => {
  try { fs.accessSync(filename, fs.constants.X_OK); return fs.statSync(filename).isFile() ? fs.realpathSync(filename) : null; }
  catch { return null; }
};

// MCP servers do not necessarily inherit the host's CODEX_CLI_PATH. Prefer the
// desktop app's bundled CLI over an unrelated (and potentially older) npm CLI.
export function resolveCodexCli({ env = process.env, platform = process.platform, home = os.homedir(),
  applicationDirectories = ['/Applications', path.join(home, 'Applications')] } = {}) {
  const fromPath = name => (env.PATH || '').split(path.delimiter).filter(Boolean)
    .map(directory => executable(path.join(directory, name))).find(Boolean);
  if (env.CODEX_CLI_PATH) return executable(env.CODEX_CLI_PATH) ||
    (!/[/\\]/.test(env.CODEX_CLI_PATH) && fromPath(env.CODEX_CLI_PATH)) || env.CODEX_CLI_PATH;
  if (platform === 'darwin') {
    for (const directory of applicationDirectories) {
      for (const relative of ['ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', 'Codex.app/Contents/Resources/codex']) {
        const bundled = executable(path.join(directory, relative));
        if (bundled) return bundled;
      }
    }
  }
  return fromPath(platform === 'win32' ? 'codex.exe' : 'codex') || 'codex';
}
