import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/lib/**'],
    environment: 'node',
    /**
     * Every test gets a DSH_HOME of its own.
     *
     * WHY THIS IS NOT OPTIONAL
     *
     * `doubao-store.ts` resolves its file through `dshHome()`, which reads `DSH_HOME` and falls
     * back to `~/.dsh`. A store test that forgot to inject a path therefore wrote the REAL
     * `~/.dsh/.xdpool/doubao-session.json` — during this work it replaced a live Doubao account
     * with a fixture account, and the next restart loaded the fixture. Path injection was added
     * to `writeStoredAccounts`/`removeStoredAccounts` for exactly this reason, but a single test
     * that got it wrong was enough.
     *
     * The setup file below points DSH_HOME at a per-run temp directory, so a future test that
     * forgets cannot reach the user's data at all.
     */
    setupFiles: ['tests/setup-home.ts'],
  },
})
