import type { H3Event } from 'h3'
import type { RenderResponse } from './helper'
import { compress, getAnyCompression } from './helper'

/**
 * Compresses the response with [zlib.gzip]{@link https://www.w3schools.com/nodejs/ref_zlib.asp}
 * @param { H3Event } event - A H3 event object.
 * @param { RenderResponse } response - A response object with body parameter.
 * @returns { Promise<void> }
 */
export async function useGZipCompression(
  event: H3Event,
  response: Partial<RenderResponse>,
): Promise<void> {
  await compress(event, response, 'gzip')
}

/**
 * Compresses the response with [zlib.deflate]{@link https://www.w3schools.com/nodejs/ref_zlib.asp}
 * @param { H3Event } event - A H3 event object.
 * @param { RenderResponse } response - A response object with body parameter.
 * @returns { Promise<void> }
 */
export async function useDeflateCompression(
  event: H3Event,
  response: Partial<RenderResponse>,
): Promise<void> {
  await compress(event, response, 'deflate')
}

/**
 * Compresses the response with [zlib.brotliCompress]{@link https://www.w3schools.com/nodejs/ref_zlib.asp}
 * @param { H3Event } event - A H3 event object.
 * @param { RenderResponse } response - A response object with body parameter.
 * @returns { Promise<void> }
 */
export async function useBrotliCompression(
  event: H3Event,
  response: Partial<RenderResponse>,
): Promise<void> {
  await compress(event, response, 'br')
}

/**
 * Compresses the response with [Zlib]{@link https://www.w3schools.com/nodejs/ref_zlib.asp}
 * by 'Accept-Encoding' header. Best is used first.
 * @param { H3Event } event - A H3 event object.
 * @param { RenderResponse } response - A response object with body parameter.
 * @returns { Promise<void> }
 */
export async function useCompression(
  event: H3Event,
  response: Partial<RenderResponse>,
): Promise<void> {
  const compression = getAnyCompression(event)
  if (compression)
    await compress(event, response, compression)
}
