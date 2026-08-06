# H3-compression

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![License][license-src]][license-href]

> Handles compression for H3

## Features

✔️ &nbsp;**Zlib Compression:** You can use zlib compression (brotli, gzip, deflate and opt-in zstd)

✔️ &nbsp;**Stream Compression:** You can use stream compressions (gzip, deflate and opt-in brotli / zstd)

✔️ &nbsp;**Compression Detection:** It uses the best compression which is accepted

✔️ &nbsp;**h3 v1 & v2:** Works with both [h3](https://h3.dev) v1 and v2

✔️ &nbsp;**Nuxt module:** Drop `h3-compression/nuxt` into `nuxt.config` and configure it there



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

## Brotli and stream compression

The native [`CompressionStream`](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream)
implements the WHATWG `CompressionFormat` enum, which only defines `gzip`, `deflate` and
`deflate-raw` — there is no brotli format. This package therefore streams brotli through
`node:zlib` instead, so it is available wherever `node:zlib` is (Node, and runtimes with node
compatibility), but not on pure edge runtimes.

Because brotli is noticeably more CPU-expensive per request than gzip, it is **never picked
automatically**. Turn it on with the `brotli` flag, or force it as the method:

```ts
app.use(compressionStream()) // gzip / deflate — unchanged default
app.use(compressionStream({ brotli: true })) // brotli, then gzip, then deflate
app.use(compressionStream('br')) // always brotli
```

The same flag works for the composable:

```ts
await useCompressionStream(event, response, { brotli: true })
// or explicitly
await useBrotliCompressionStream(event, response)
```

> [!NOTE]
> The brotli stream is flushed per chunk (`BROTLI_OPERATION_FLUSH`) so that streamed responses
> stay streamed. With zlib's defaults brotli buffers the whole body until the source closes.

## Zstd

Zstd is supported on both paths, and is opt-in for a different reason than brotli: `node:zlib`
only gained zstd in **Node 22.15.0** (and 23.8.0). Enabling it by default would make the
negotiated `Content-Encoding` depend on the Node version the app happens to run on, which is a
poor thing to discover in production. The package itself only requires Node >= 20.11.1, the same
floor as h3.

```ts
app.use(compression({ zstd: true })) // zstd, then brotli, then gzip, then deflate
app.use(compressionStream({ zstd: true, brotli: true })) // same order, streamed

await useCompression(event, response, { zstd: true })
```

Behaviour on a runtime without zstd:

- with the `zstd: true` **flag**, zstd is skipped during negotiation and the next accepted
  encoding is used — no error, no special-casing needed in your code
- when **forced** (`compression('zstd')`, `useZstdCompression`), a `TypeError` naming the
  required Node version is thrown, because silently sending something else would be worse

Branch on it yourself with the exported predicate:

```ts
import { isZstdSupported } from 'h3-compression'

app.use(compression({ zstd: isZstdSupported() }))
```

## Nuxt 3 & 4

Add the module and you're done — it wires the right Nitro hooks, skips Nuxt's internal
routes and filters by content type for you:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['h3-compression/nuxt'],
})
```

Everything is configurable under the `compression` key:

```ts
export default defineNuxtConfig({
  modules: ['h3-compression/nuxt'],
  compression: {
    enabled: true,
    encoding: 'zlib', // or 'stream'
    brotli: false, // stream path only — zlib always prefers brotli
    zstd: false, // needs Node >= 22.15
    method: undefined, // force one method instead of negotiating
    contentTypes: ['text/', 'application/json', 'application/javascript', 'application/xml', 'image/svg+xml'],
    exclude: ['/_nuxt', '/__nuxt'],
    routeRules: true, // also compress cached (swr/isr) routes and /server/api
    threshold: 0, // skip bodies smaller than this many bytes
  },
})
```

| Option | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Turn compression off without removing the module |
| `encoding` | `'zlib'` | `'zlib'` buffers the body; `'stream'` pipes it through a compression transform |
| `brotli` | `false` | Consider brotli when negotiating. Only meaningful for `'stream'` — the zlib path already prefers brotli |
| `zstd` | `false` | Consider zstd when negotiating. Ignored on Node < 22.15, see [Zstd](#zstd) |
| `method` | – | Force one method instead of negotiating from `Accept-Encoding` |
| `contentTypes` | text, JSON, JS, XML, SVG | Prefix match against `Content-Type`. Set to `[]` to compress everything |
| `exclude` | `['/_nuxt', '/__nuxt']` | Path prefixes to skip. Compressing these breaks Nuxt's error page |
| `routeRules` | `true` | Also attach to `beforeResponse`, which is what cached (`swr`/`isr`) routes and `/server/api` handlers go through |
| `threshold` | `0` | Skip bodies below this size — under roughly a kilobyte compression makes payloads *larger*. Ignored for `'stream'`, where the size is not known up front |

> [!NOTE]
> `contentTypes` and `exclude` **replace** the defaults rather than extending them.
> Spread the defaults in if you want to add to them.

### Doing it manually

The module is a convenience wrapper — the hooks are still yours to wire if you want
different behaviour per route:

`server/plugins/compression.ts`
````ts
import { useCompression } from 'h3-compression'

export default defineNitroPlugin((nitro) => {
  // Freshly rendered SSR pages.
  nitro.hooks.hook('render:response', async (response, { event }) => {
    // Skip internal nuxt routes (e.g. error page)
    if (['/_nuxt', '/__nuxt'].some(prefix => getRequestURL(event).pathname.startsWith(prefix)))
      return

    if (!response.headers?.['content-type']?.startsWith('text/html'))
      return

    await useCompression(event, response)
  })

  // The `render:response` hook only runs for freshly rendered SSR pages.
  // Responses served from the Nitro route cache (`routeRules` with `swr` / `isr`)
  // and `/server/api` handlers go through `beforeResponse` instead.
  nitro.hooks.hook('beforeResponse', async (event, response) => {
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
- `useZstdCompression(event, response)` &nbsp;– requires Node >= 22.15
- `useCompression(event, response, options?)` &nbsp;– pass `{ zstd: true }` to include zstd

#### Stream Compression

- `useGZipCompressionStream(event, response)`
- `useDeflateCompressionStream(event, response)`
- `useBrotliCompressionStream(event, response)`
- `useZstdCompressionStream(event, response)` &nbsp;– requires Node >= 22.15
- `useCompressionStream(event, response, options?)` &nbsp;– pass `{ brotli: true }` / `{ zstd: true }`

#### Middleware (h3 v2)

- `compression(method | options?)` &nbsp;– middleware using zlib (brotli, gzip, deflate, opt-in zstd)
- `compressionStream(method | options?)` &nbsp;– stream middleware (gzip, deflate, opt-in brotli / zstd)
- `compressResponse(event, value, method?, options?)` &nbsp;– low-level helper returning a compressed `Response`
- `compressResponseStream(event, value, method?, options?)` &nbsp;– low-level stream helper returning a compressed `Response`
- `isZstdSupported()` &nbsp;– whether the runtime can compress with zstd

#### Nuxt

- `h3-compression/nuxt` &nbsp;– the Nuxt module, configured under the `compression` key

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
