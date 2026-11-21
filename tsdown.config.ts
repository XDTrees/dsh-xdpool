import { defineConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-xdpool'

/**
 * Externalized browser-only packages that the Host supplies at runtime through
 * `window.__ModuleLoader__`. The client bundle must never bundle these — the
 * loader `require`s them against the Host's own registry.
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-locale/client',
  '@deepseek-ai/dsh-client-ui-settings-plugins/client',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

export default defineConfig([
  {
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    // The host entry is the only half with published types (`package.json`
    // `types` points at lib/index.d.ts). The CLI is an executable and the
    // browser bundle is consumed by the host loader, so both stay untyped.
    dts: true,
    outExtensions: () => ({ js: '.js' }),
    clean: true,
    sourcemap: false,
  },
  {
    entry: ['src/bin.ts'],
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: false,
    outExtensions: () => ({ js: '.js' }),
    clean: false,
    sourcemap: false,
    // The CLI runs standalone before any argument is parsed. Bundling inlined
    // `createCore`'s whole dependency graph, whose adapter carries side-effect
    // imports of host-injected optional peers (`@earendil-works/pi-ai` etc.) —
    // those imports landed at the top of bin.js and every CLI command died with
    // ERR_MODULE_NOT_FOUND before `main()` ever ran. Keeping them external
    // means they resolve only if a command actually reaches the adapter path.
    deps: { neverBundle: [
      '@earendil-works/pi-ai',
      '@earendil-works/pi-ai/api/openai-completions.lazy',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-llm-pi-ai',
    ] },
  },
  {
    // Browser half: emits lib/client.js as a CJS bundle that registers itself
    // with the Host's module loader. `platform: 'neutral'` (no runtime
    // assumption) fits the `window.__ModuleLoader__` context.
    entry: ['src/client/index.tsx'],
    outDir: 'lib',
    format: 'cjs',
    platform: 'neutral',
    dts: false,
    clean: false,
    outExtensions: () => ({ js: '.js' }),
    sourcemap: false,
    deps: { neverBundle: [...CLIENT_EXTERNALS] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      /*
        剥掉注释。

        源码里 160KB 是注释 —— 它们对维护这个插件的人是必要的，对浏览器
        是纯粹的下载量。这个 bundle 只给浏览器跑，源码注释在 .tsx 里原样保留。
      */
      comments: false,
    },
  },
])
