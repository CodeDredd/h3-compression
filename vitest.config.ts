import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // `src/runtime/` self-references the package so the shipped
      // `dist/runtime/` files resolve; point that back at the source in tests.
      'h3-compression': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  test: {
    setupFiles: ['./test/_setup'],
    coverage: {
      reporter: ['text', 'clover', 'json'],
    },
  },
})
