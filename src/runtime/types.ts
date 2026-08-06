import type { Compression, StreamCompression } from 'h3-compression'

/**
 * Options for the Nuxt module, available under the `compression` key in
 * `nuxt.config`.
 *
 * Declared as a type alias rather than an interface on purpose: `@nuxt/kit`
 * constrains module options to `Record<string, any>`, which interfaces do not
 * satisfy (they have no implicit index signature).
 */
export interface NuxtCompressionOptions {
  /**
   * Turn compression on or off without removing the module.
   * @default true
   */
  enabled?: boolean

  /**
   * `'zlib'` buffers the body and compresses it in one go — this is the only
   * mode that reliably works across Nitro's hooks.
   *
   * `'stream'` pipes the body through a compression transform. It keeps
   * streamed responses streamed, but Nitro's `render:response` hands over an
   * already-materialised body, so it only pays off for handlers that actually
   * stream.
   * @default 'zlib'
   */
  encoding?: 'zlib' | 'stream'

  /**
   * Consider brotli when negotiating `Accept-Encoding`.
   *
   * Only meaningful for `encoding: 'stream'` — the zlib path always prefers
   * brotli when the client accepts it.
   * @default false
   */
  brotli?: boolean

  /**
   * Consider zstd when negotiating `Accept-Encoding`. Requires Node >= 22.15;
   * on older runtimes the flag is ignored and the next accepted encoding is
   * used.
   * @default false
   */
  zstd?: boolean

  /**
   * Force a single compression method instead of negotiating from
   * `Accept-Encoding`. Rarely what you want — a client that does not accept it
   * gets an uncompressed response.
   */
  method?: Compression | StreamCompression

  /**
   * Compress only responses whose `Content-Type` starts with one of these.
   * Keeps images, fonts and other already-compressed assets untouched.
   *
   * Set to `[]` to compress every content type.
   * @default ['text/', 'application/json', 'application/javascript', 'application/xml', 'image/svg+xml']
   */
  contentTypes?: string[]

  /**
   * Skip requests whose path starts with one of these prefixes. The defaults
   * cover Nuxt's own asset and payload routes — compressing them breaks the
   * error page.
   * @default ['/_nuxt', '/__nuxt']
   */
  exclude?: string[]

  /**
   * Also attach to Nitro's `beforeResponse` hook, which is what cached
   * (`swr` / `isr`) routes and `/server/api` handlers go through.
   * `render:response` alone only covers freshly rendered SSR pages.
   * @default true
   */
  routeRules?: boolean

  /**
   * Skip bodies smaller than this many bytes — below roughly a kilobyte
   * compression tends to make the payload larger.
   *
   * Ignored for `encoding: 'stream'`, where the size is not known up front.
   * @default 0
   */
  threshold?: number
}
