import { addServerPlugin, addTemplate, defineNuxtModule } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import type { NuxtCompressionOptions } from './runtime/types'
import { DEFAULT_CONTENT_TYPES, DEFAULT_EXCLUDE } from './runtime/nitro-plugin'

export type { NuxtCompressionOptions } from './runtime/types'

const DEFAULTS: Required<Pick<
  NuxtCompressionOptions,
  'enabled' | 'encoding' | 'brotli' | 'zstd' | 'contentTypes' | 'exclude' | 'routeRules' | 'threshold'
>> = {
  enabled: true,
  encoding: 'zlib',
  brotli: false,
  zstd: false,
  contentTypes: DEFAULT_CONTENT_TYPES,
  exclude: DEFAULT_EXCLUDE,
  routeRules: true,
  threshold: 0,
}

/**
 * Nuxt module wiring the compression into Nitro's response hooks.
 *
 * @example
 * ```ts
 * // nuxt.config.ts
 * export default defineNuxtConfig({
 *   modules: ['h3-compression/nuxt'],
 *   compression: {
 *     zstd: true,
 *     threshold: 1024,
 *   },
 * })
 * ```
 */
export default defineNuxtModule<NuxtCompressionOptions>({
  meta: {
    name: 'h3-compression',
    configKey: 'compression',
    compatibility: {
      nuxt: '>=3.0.0',
    },
  },
  defaults: DEFAULTS,
  // Annotated explicitly: `defineNuxtModule`'s conditional signature does not
  // contextually type these under the TypeScript version this repo builds with.
  setup(options: NuxtCompressionOptions, _nuxt: Nuxt) {
    if (options.enabled === false)
      return

    // The plugin is generated rather than shipped ready-made so the resolved
    // options are baked in at build time. That keeps the runtime free of
    // `useRuntimeConfig` / virtual-module lookups, which each depend on Nitro
    // auto-import behaviour that has moved between majors.
    //
    // The import uses the published subpath rather than an absolute path so
    // Nitro resolves and bundles it like any other dependency — an absolute
    // path would survive into the build output and break on deploy.
    const template = addTemplate({
      filename: 'h3-compression-plugin.mjs',
      write: true,
      getContents: () => [
        'import { createCompressionPlugin } from \'h3-compression/nuxt-runtime\'',
        '',
        `export default createCompressionPlugin(${JSON.stringify(options, null, 2)})`,
        '',
      ].join('\n'),
    })

    addServerPlugin(template.dst)
  },
})
