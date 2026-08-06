import type { H3Event } from 'h3'
import type { Compression, StreamCompression, StreamCompressionOptions } from './helper'
import { compressResponse, compressResponseStream } from './helper'

type Next = () => unknown | Promise<unknown>

/**
 * A h3 v2 middleware compressing the response.
 */
export type CompressionMiddleware = (event: H3Event, next: Next) => Promise<Response>

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
 * @example
 * ```ts
 * import { H3 } from 'h3'
 * import { compression } from 'h3-compression'
 *
 * const app = new H3()
 * app.use(compression())
 * ```
 *
 * @param { Compression } [method] - Force a specific compression method instead of detecting it.
 * @returns { CompressionMiddleware }
 */
export function compression(method?: Compression): CompressionMiddleware {
  return (event, next) => compressResponse(event, next(), method)
}

/**
 * Creates a [h3 v2 middleware]{@link https://h3.dev/guide/basics/middleware} that
 * compresses the response with the native
 * [CompressionStream]{@link https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream}
 * based on the `Accept-Encoding` header. Best is used first.
 *
 * Brotli is streamed through `node:zlib` and is opt-in — it is more
 * CPU-expensive per request, so it is never picked from `Accept-Encoding`
 * unless `brotli: true` is set.
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
