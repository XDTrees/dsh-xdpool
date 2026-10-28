/**
 * The plugin's own version, hand-maintained for the browser bundle.
 *
 * The card ships as `lib/client.js`, served to the host dialog as a browser
 * script: `package.json` is neither reachable nor guaranteed to be the file
 * the running build came from. A manifest lying next to the code is worse than
 * a number a test keeps honest.
 *
 * `tests/version-sync.test.ts` fails when this drifts from `package.json`, so
 * the release checklist cannot ship a card that calls itself the wrong version.
 *
 * @module dsh-xdpool/version
 */
export const POOL_VERSION = '2.5.0'