import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['app/**/*.test.{ts,mjs}'],
    exclude: ['node_modules/**'],
  },
})
