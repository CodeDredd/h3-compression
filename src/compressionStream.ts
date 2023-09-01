import type { H3Event } from 'h3'
import type { RenderResponse } from './helper'
import { compressStream, getAnyCompression } from './helper'

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
 * Compresses the response with
 * [CompressionStream]{@link https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream}
 * by 'Accept-Encoding' header. Best is used first.
 * @param event - A H3 event object.
 * @param response - A response object with body parameter.
 */
export async function useCompressionStream(
  event: H3Event,
  response: Partial<RenderResponse>,
) {
  const compression = getAnyCompression(event)

  if (compression && compression !== 'br')
    await compressStream(event, response, compression)
}
