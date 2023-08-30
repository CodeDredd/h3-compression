# h3-compress

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![License][license-src]][license-href]

## Features

✔️ &nbsp;**Zlib Compressions:** You can use zlib compression (brotli, gzip and deflate)

✔️ &nbsp;**Stream Compression:** You can use native stream compressions (gzip, deflate)

✔️ &nbsp;**Compression Detection:** It uses the best compression which is accepted



## Install

```bash
# Using npm
npm install h3-compress

# Using yarn
yarn add h3-compress

# Using pnpm
pnpm add h3-compress
```

## Usage

```ts
import { createServer } from 'node:http'
import { createApp, eventHandler, toNodeListener } from 'h3'
import { useCompressionStream } from 'h3-compress'

const app = createApp({ onBeforeResponse: useCompressionStream }) // or { onBeforeResponse: useCompression }
app.use(
  '/',
  eventHandler(() => 'Hello world!'),
)

createServer(toNodeListener(app)).listen(process.env.PORT || 3000)
```

Example using <a href="https://github.com/unjs/listhen">listhen</a> for an elegant listener:

```ts
import { createApp, eventHandler, toNodeListener } from 'h3'
import { listen } from 'listhen'
import { useCompressionStream } from 'h3-compress'

const app = createApp({ onBeforeResponse: useCompressionStream }) // or { onBeforeResponse: useCompression }
app.use(
  '/',
  eventHandler(() => 'Hello world!'),
)

listen(toNodeListener(app))
```

## Nuxt 3 Usage

If you want to use it in nuxt 3 you can define a nitro plugin. But there only the Zlib compression works
Create a new file in `server/plugins/compression.ts`

````ts
import { useCompression } from 'h3-compress'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', async (response, { event }) => {
    if (!response.headers?.['content-type'].startsWith('text/html'))
      return

    await useCompression(event, response)
  })
})
````

## Utilities

H3 has a concept of composable utilities that accept `event` (from `eventHandler((event) => {})`) as their first argument and `response` as their second.

#### Zlib Compression

- `useGZipCompression(event, response)`
- `useDeflateCompression(event, response)`
- `useBrotliCompression(event, response)`
- `useCompression(event, response)`

#### Stream Compression

- `useGZipCompressionStream(event, response)`
- `useDeflateCompressionStream(event, response)`
- `useCompressionStream(event, response)`

## Sponsors

<p align="center">
  <a href="https://pinia-orm.codedredd.de/sponsorkit/sponsors.png">
    <img src='https://pinia-orm.codedredd.de/sponsorkit/sponsors.svg'/>
  </a>
</p>

## License

[MIT](./LICENSE) License © 2023-PRESENT [Gregor Becker](https://github.com/CodeDredd)


<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/h3-compress?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/h3-compress
[npm-downloads-src]: https://img.shields.io/npm/dm/h3-compress?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/h3-compress
[bundle-src]: https://img.shields.io/bundlephobia/minzip/h3-compress?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=h3-compress
[license-src]: https://img.shields.io/github/license/CodeDredd/h3-compress.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/CodeDredd/h3-compress/blob/main/LICENSE
[jsdocs-src]: https://img.shields.io/badge/jsdocs-reference-080f12?style=flat&colorA=080f12&colorB=1fa669
[jsdocs-href]: https://www.jsdocs.io/package/h3-compress
