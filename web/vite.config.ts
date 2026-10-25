import tailwindcss from '@tailwindcss/vite'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.BETTERZERIYA_SERVER_ORIGIN ?? 'http://127.0.0.1:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  resolve:
    mode === 'production'
      ? {
          alias: {
            '$server-mock/menu.json': resolve('./src/lib/server-mock-stub.json'),
          },
        }
      : {},
}))
