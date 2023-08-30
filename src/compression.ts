import type { H3Event } from 'h3'
import type { RenderResponse } from './helper'
import { compress, getAnyCompression } from './helper'

export async function useGZipCompression(
  event: H3Event,
  response: Partial<RenderResponse>,
) {
  await compress(event, response, 'deflate')
}

export async function useDeflateCompression(
  event: H3Event,
  response: Partial<RenderResponse>,
) {
  await compress(event, response, 'deflate')
}

export async function useBrotliCompression(
  event: H3Event,
  response: Partial<RenderResponse>,
) {
  await compress(event, response, 'br')
}

export async function useCompression(
  event: H3Event,
  response: Partial<RenderResponse>,
) {
  const compression = getAnyCompression(event)
  if (compression)
    await compress(event, response, compression)
}
