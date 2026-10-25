import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
    runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
  },
  kit: {
    // SPA build: the Worker serves build/ as static assets with an
    // index.html fallback, and answers /api/* itself.
    adapter: adapter({ fallback: 'index.html' }),
    alias: {
      '$server-mock': './src/lib/assets/data',
    },
  },
}

export default config
