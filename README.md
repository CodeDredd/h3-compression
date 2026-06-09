# H3-compression

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![License][license-src]][license-href]

> Handles compression for H3

## Features

✔️ &nbsp;**Zlib Compression:** You can use zlib compression (brotli, gzip and deflate)

✔️ &nbsp;**Stream Compression:** You can use native stream compressions (gzip, deflate)

✔️ &nbsp;**Compression Detection:** It uses the best compression which is accepted

✔️ &nbsp;**h3 v1 & v2:** Works with both [h3](https://h3.dev) v1 and v2



## Install

```bash
# Using npm
npm install h3-compression

# Using yarn
yarn add h3-compression

# Using pnpm
pnpm add h3-compression
```

## Usage (h3 v1)

```ts
import { createServer } from 'node:http'
import { createApp, eventHandler, toNodeListener } from 'h3'
import { useCompressionStream } from 'h3-compression'

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
import { useCompressionStream } from 'h3-compression'

const app = createApp({ onBeforeResponse: useCompressionStream }) // or { onBeforeResponse: useCompression }
app.use(
  '/',
  eventHandler(() => 'Hello world!'),
)

listen(toNodeListener(app))
```

## Usage (h3 v2)

In [h3 v2](https://h3.dev) the response is an immutable web `Response` and the `onBeforeResponse`
hook was removed. Use the `compression` / `compressionStream` middleware instead — they read the
response returned by the next handler and replace it with a compressed one.

```ts
import { createServer } from 'node:http'
import { H3, toNodeHandler } from 'h3'
import { compression } from 'h3-compression'

const app = new H3()

app.use(compression()) // or app.use(compressionStream())
app.get('/', () => 'Hello world!')

createServer(toNodeHandler(app)).listen(process.env.PORT || 3000)
```

You can also force a specific method (e.g. `compression('gzip')`) instead of detecting it from the
`Accept-Encoding` header.

> [!NOTE]
> `compressionStream` uses the native [`CompressionStream`](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream),
> which only supports `gzip` and `deflate` (no brotli).

## Nuxt 3 & 4

If you want to use it in Nuxt you can define a nitro plugin.

`server/plugins/compression.ts`
````ts
import { useCompression } from 'h3-compression'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', async (response, { event }) => {
    // Skip internal nuxt routes (e.g. error page)
    if (['/_nuxt', '/__nuxt'].some(prefix => getRequestURL(event).pathname.startsWith(prefix)))
      return

    if (!response.headers?.['content-type']?.startsWith('text/html'))
      return

    await useCompression(event, response)
  })
})
````
> [!NOTE]  
> `useCompressionStream` doesn't work right now in nitro. So you just can use `useCompression`

### Cached routes (SWR / ISR) and `/server/api`

The `render:response` hook only runs for freshly rendered SSR pages. Responses served
from the Nitro route cache (`routeRules` with `swr` / `isr`) and `/server/api` handlers
go through the `beforeResponse` hook instead. Use it to compress those too:

`server/plugins/compression.ts`
````ts
import { useCompression } from 'h3-compression'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('beforeResponse', async (event, response) => {
    // Skip internal nuxt routes (e.g. error page)
    if (['/_nuxt', '/__nuxt'].some(prefix => event.path.startsWith(prefix)))
      return

    await useCompression(event, response)
  })
})
````

`useCompression` compresses string, `Buffer`/`Uint8Array` and JSON (object) bodies and
skips everything else (e.g. streams), so binary assets are left untouched. If you only
want to compress specific content types, guard on `response.headers?.['content-type']`
before calling it.

## Utilities

H3-compression has a concept of composable utilities that accept `event` (from `eventHandler((event) => {})`) as their first argument and `response` as their second.

#### Zlib Compression

- `useGZipCompression(event, response)`
- `useDeflateCompression(event, response)`
- `useBrotliCompression(event, response)`
- `useCompression(event, response)`

#### Stream Compression

- `useGZipCompressionStream(event, response)`
- `useDeflateCompressionStream(event, response)`
- `useCompressionStream(event, response)`

#### Middleware (h3 v2)

- `compression(method?)` &nbsp;– middleware using zlib (brotli, gzip, deflate)
- `compressionStream(method?)` &nbsp;– middleware using the native `CompressionStream` (gzip, deflate)
- `compressResponse(event, value, method?)` &nbsp;– low-level helper returning a compressed `Response`
- `compressResponseStream(event, value, method?)` &nbsp;– low-level stream helper returning a compressed `Response`

## Sponsors

<p align="center">
  <a href="https://pinia-orm.codedredd.de/sponsorkit/sponsors.png">
    <img src='https://pinia-orm.codedredd.de/sponsorkit/sponsors.svg'/>
  </a>
</p>

## Releated Projects

- [H3](https://github.com/unjs/h3)

## License

[MIT](./LICENSE) License © 2023-PRESENT [Gregor Becker](https://github.com/CodeDredd)


<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/h3-compression?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/h3-compression
[npm-downloads-src]: https://img.shields.io/npm/dm/h3-compression?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/h3-compression
[bundle-src]: https://img.shields.io/bundlephobia/minzip/h3-compression?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=h3-compression
[license-src]: https://img.shields.io/github/license/CodeDredd/h3-compression.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/CodeDredd/h3-compression/blob/main/LICENSE
[jsdocs-src]: https://img.shields.io/badge/jsdocs-reference-080f12?style=flat&colorA=080f12&colorB=1fa669
[jsdocs-href]: https://www.jsdocs.io/package/h3-compression
