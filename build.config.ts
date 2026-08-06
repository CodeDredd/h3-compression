import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    'src/index',
    'src/nuxt',
    // The nitro plugin is consumed by the generated file the module writes into
    // the Nuxt build dir, so it has to stay a resolvable file on disk rather
    // than being rolled into the `nuxt` bundle.
    {
      input: 'src/runtime/',
      outDir: 'dist/runtime',
      builder: 'mkdist',
      format: 'esm',
      ext: 'mjs',
      declaration: true,
    },
  ],
  externals: ['@nuxt/kit', '@nuxt/schema', 'h3', 'h3-compression'],
  declaration: true,
  clean: true,
  rollup: {
    emitCJS: true,
  },
})
