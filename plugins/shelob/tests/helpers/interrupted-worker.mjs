import path from 'node:path';
import { ReviewStore } from '../../server/store.mjs';

process.once('message', async ({ root, repo, phase }) => {
  // Model an adapter with a live I/O handle. No external command is launched.
  setInterval(() => {}, 1000);
  const never = () => new Promise(() => {});
  const store = new ReviewStore({ root, github: { preparePrOnly: never }, nativeReviewer: { review: never } });
  const initial = await store.start(phase === 'preparing'
    ? { kind: 'github_pr', url: 'https://github.com/example/repo/pull/1' }
    : { kind: 'local', repo, base: 'main' }, { wait: false });
  const result = phase === 'preparing' ? initial : await store.codeReview(initial.run.id, { wait: false });
  process.send({ id: result.run.id, root: path.resolve(root), nativeStatus: result.nativeReview?.status });
});
