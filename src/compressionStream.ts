import type { H3Event } from 'h3'
import type { RenderResponse } from './helper'
import { compressStream, getAnyCompression } from './helper'

/**
 * Parse and validate params from event handler. Doesn't throw if validation fails.
 * @param event - A H3 event object.
 */
export async function useGZipCompressionStream(
  event: H3Event,
  response: Partial<RenderResponse>,
) {
  await compressStream(event, response, 'gzip')
}

export async function useDeflateCompressionStream(
  event: H3Event,
  response: Partial<RenderResponse>,
) {
  await compressStream(event, response, 'deflate')
}

export async function useCompressionStream(
  event: H3Event,
  response: Partial<RenderResponse>,
) {
  const compression = getAnyCompression(event)

  if (compression && compression !== 'br')
    await compressStream(event, response, compression)
}
