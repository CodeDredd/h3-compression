import type { H3Event } from 'h3'
import type { RenderResponse, StreamCompressionOptions } from './helper'
import { compressStream, getStreamCompression } from './helper'

/**
 * Compresses the response with
 * [CompressionStream(gzip)]{@link https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream}
 * @param event - A H3 event object.
 * @param response - A response object with body parameter.
 */
export async function useGZipCompressionStream(
  event: H3Event,
  response: Partial<RenderResponse>,
) {
  await compressStream(event, response, 'gzip')
}

/**
 * Compresses the response with
 * [CompressionStream(deflate)]{@link https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream}
 * @param event - A H3 event object.
 * @param response - A response object with body parameter.
 */
export async function useDeflateCompressionStream(
  event: H3Event,
  response: Partial<RenderResponse>,
) {
  await compressStream(event, response, 'deflate')
}

/**
 * Compresses the response with [zlib.createBrotliCompress]{@link https://nodejs.org/api/zlib.html}
 * piped as a stream. The native `CompressionStream` has no brotli format, so
 * this one is backed by `node:zlib` and is not available on non-node runtimes.
 * @param event - A H3 event object.
 * @param response - A response object with body parameter.
 */
export async function useBrotliCompressionStream(
  event: H3Event,
  response: Partial<RenderResponse>,
) {
  await compressStream(event, response, 'br')
}

/**
 * Compresses the response with [zlib.createZstdCompress]{@link https://nodejs.org/api/zlib.html}
 * piped as a stream. The native `CompressionStream` has no zstd format, so this
 * one is backed by `node:zlib` and requires Node >= 22.15.0 — it throws a
 * `TypeError` on older runtimes.
 * @param event - A H3 event object.
 * @param response - A response object with body parameter.
 */
export async function useZstdCompressionStream(
  event: H3Event,
  response: Partial<RenderResponse>,
) {
  await compressStream(event, response, 'zstd')
}

/**
 * Compresses the response with
 * [CompressionStream]{@link https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream}
 * by 'Accept-Encoding' header. Best is used first.
 *
 * Zstd and brotli are only picked when enabled via `options`.
 * @param event - A H3 event object.
 * @param response - A response object with body parameter.
 * @param options - Opt into zstd / brotli detection, e.g. `{ brotli: true }`.
 */
export async function useCompressionStream(
  event: H3Event,
  response: Partial<RenderResponse>,
  options: StreamCompressionOptions = {},
) {
  const compression = getStreamCompression(event, options)

  if (compression)
    await compressStream(event, response, compression)
}
