import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Code under test commits with plain `git commit`; CI runners have no git identity.
    env: {
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
    // Spawning many git processes is several times slower on Windows runners.
    testTimeout: 30_000,
  },
});
