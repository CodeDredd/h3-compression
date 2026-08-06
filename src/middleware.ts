import type { H3Event } from 'h3'
import type { Compression, CompressionOptions, StreamCompression, StreamCompressionOptions } from './helper'
import { compressResponse, compressResponseStream } from './helper'

type Next = () => unknown | Promise<unknown>

/**
 * A h3 v2 middleware compressing the response.
 */
export type CompressionMiddleware = (event: H3Event, next: Next) => Promise<Response>

/**
 * Configuration for the {@link compression} middleware.
 */
export interface CompressionMiddlewareOptions extends CompressionOptions {
  /**
   * Force a specific compression method instead of detecting it from the
   * `Accept-Encoding` header. A forced `'zstd'` does not need `zstd: true`,
   * but it does throw on runtimes without zstd support.
   */
  method?: Compression
}

/**
 * Configuration for the {@link compressionStream} middleware.
 */
export interface CompressionStreamOptions extends StreamCompressionOptions {
  /**
   * Force a specific compression method instead of detecting it from the
   * `Accept-Encoding` header. A forced `'br'` does not need `brotli: true`.
   */
  method?: StreamCompression
}

/**
 * Creates a [h3 v2 middleware]{@link https://h3.dev/guide/basics/middleware} that
 * compresses the response with [Zlib]{@link https://nodejs.org/api/zlib.html}
 * based on the `Accept-Encoding` header. Best is used first.
 *
 * Zstd is opt-in: `node:zlib` only gained it in Node 22.15, so enabling it by
 * default would make the negotiated encoding depend on the runtime version.
 * With `zstd: true` on an older runtime the next accepted encoding is used.
 *
 * @example
 * ```ts
 * import { H3 } from 'h3'
 * import { compression } from 'h3-compression'
 *
 * const app = new H3()
 *
 * app.use(compression()) // brotli / gzip / deflate
 * app.use(compression({ zstd: true })) // zstd, brotli, gzip, deflate
 * app.use(compression('zstd')) // always zstd
 * ```
 *
 * @param { Compression | CompressionMiddlewareOptions } [options] - A forced compression method or a config object.
 * @returns { CompressionMiddleware }
 */
export function compression(options?: Compression | CompressionMiddlewareOptions): CompressionMiddleware {
  const config: CompressionMiddlewareOptions = typeof options === 'string' ? { method: options } : { ...options }

  return (event, next) => compressResponse(event, next(), config.method, config)
}

/**
 * Creates a [h3 v2 middleware]{@link https://h3.dev/guide/basics/middleware} that
 * compresses the response with the native
 * [CompressionStream]{@link https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream}
 * based on the `Accept-Encoding` header. Best is used first.
 *
 * Brotli and zstd are streamed through `node:zlib` and are opt-in — they are
 * more CPU-expensive per request (brotli) or runtime-version dependent (zstd),
 * so they are never picked from `Accept-Encoding` unless enabled.
 *
 * @example
 * ```ts
 * import { H3 } from 'h3'
 * import { compressionStream } from 'h3-compression'
 *
 * const app = new H3()
 *
 * app.use(compressionStream()) // gzip / deflate
 * app.use(compressionStream({ brotli: true })) // brotli, gzip, deflate
 * app.use(compressionStream({ zstd: true, brotli: true })) // zstd, brotli, gzip, deflate
 * app.use(compressionStream('br')) // always brotli
 * ```
 *
 * @param { StreamCompression | CompressionStreamOptions } [options] - A forced compression method or a config object.
 * @returns { CompressionMiddleware }
 */
export function compressionStream(options?: StreamCompression | CompressionStreamOptions): CompressionMiddleware {
  const config: CompressionStreamOptions = typeof options === 'string' ? { method: options } : { ...options }

  return (event, next) => compressResponseStream(event, next(), config.method, config)
}
