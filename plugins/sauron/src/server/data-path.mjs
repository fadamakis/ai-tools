import os from 'node:os';
import path from 'node:path';
export function dataPath(env = process.env, home = os.homedir(), platform = process.platform) {
  if (env.ATTENTION_DB) return path.resolve(env.ATTENTION_DB);
  return path.join(home, platform === 'darwin' ? 'Library/Application Support/Sauron' : '.local/share/sauron', 'attention.sqlite');
}
