import type { H3Event } from 'h3'
import type { Compression, StreamCompression } from './helper'
import { compressResponse, compressResponseStream } from './helper'

type Next = () => unknown | Promise<unknown>

/**
 * A h3 v2 middleware compressing the response.
 */
export type CompressionMiddleware = (event: H3Event, next: Next) => Promise<Response>

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
 * @example
 * ```ts
 * import { H3 } from 'h3'
 * import { compressionStream } from 'h3-compression'
 *
 * const app = new H3()
 * app.use(compressionStream())
 * ```
 *
 * @param { StreamCompression } [method] - Force a specific compression method instead of detecting it.
 * @returns { CompressionMiddleware }
 */
export function compressionStream(method?: StreamCompression): CompressionMiddleware {
  return (event, next) => compressResponseStream(event, next(), method)
}
