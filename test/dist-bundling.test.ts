import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distEntry = resolve(root, 'dist/index.mjs')

/**
 * A stub for `h3` that mimics how a single h3 major looks to a bundler: it
 * exports the symbols that exist in *both* versions, but never both `send`
 * (v1 only) and `toResponse` (v2 only). If the package forces a static named
 * import of a version-specific symbol, Rollup re-bundling `dist/index.mjs`
 * (as Nuxt / Nitro does) emits a `MISSING_EXPORT` warning — exactly the
 * `"toResponse" is not exported by h3` build error reported downstream.
 */
const h3Stub = `
export const getRequestHeader = () => undefined
export const setResponseHeader = () => undefined
`

function stubPlugin() {
  return {
    name: 'h3-stub',
    resolveId(id: string) {
      if (id === 'h3')
        return '\0h3-stub'
      if (id.startsWith('node:'))
        return { id, external: true }
      return null
    },
    load(id: string) {
      if (id === '\0h3-stub')
        return h3Stub
      return null
    },
  }
}

describe('downstream bundling (regression for #14 follow-up)', () => {
  beforeAll(() => {
    if (!existsSync(distEntry))
      execSync('pnpm build', { cwd: root, stdio: 'inherit' })
  }, 120_000)

  it('bundles dist/index.mjs without missing h3 exports (v1 + v2 safe)', async () => {
    const { rollup } = await import('rollup')

    const warnings: string[] = []
    const bundle = await rollup({
      input: distEntry,
      plugins: [stubPlugin() as any],
      onwarn(warning) {
        warnings.push(typeof warning === 'string' ? warning : warning.message)
      },
    })
    await bundle.generate({ format: 'es' })
    await bundle.close()

    const missingExport = warnings.filter(
      w => /is not exported by/.test(w) || /toResponse|"send"/.test(w),
    )

    expect(missingExport).toEqual([])
  })
})
