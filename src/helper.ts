import { promisify } from 'node:util'
import zlib from 'node:zlib'
import { Buffer } from 'node:buffer'
import type { H3Event } from 'h3'
import {
  getRequestHeader,
  send,
  setResponseHeader,
} from 'h3'

export interface RenderResponse {
  body?: string | unknown
  statusCode: number
  statusMessage: string
  headers: Record<string, string>
}

export function getAnyCompression(event: H3Event) {
  const encoding = getRequestHeader(event, 'accept-encoding')
  if (encoding?.includes('br'))
    return 'br'

  if (encoding?.includes('gzip'))
    return 'gzip'

  if (encoding?.includes('deflate'))
    return 'deflate'

  return undefined
}

export async function compress(event: H3Event, response: Partial<RenderResponse>, method: 'gzip' | 'deflate' | 'br') {
  const compression = promisify(zlib[method === 'br' ? 'brotliCompress' : method])
  const acceptsEncoding = getRequestHeader(event, 'accept-encoding')?.includes(
    method,
  )

  if (acceptsEncoding && typeof response.body === 'string') {
    setResponseHeader(event, 'Content-Encoding', method)
    send(event, await compression(Buffer.from(response.body)))
  }
}

export async function compressStream(event: H3Event, response: Partial<RenderResponse>, method: 'gzip' | 'deflate') {
  const stream = new Response(response.body as string).body as ReadableStream
  const acceptsEncoding = getRequestHeader(event, 'accept-encoding')?.includes(
    method,
  )

  if (acceptsEncoding) {
    setResponseHeader(event, 'Content-Encoding', method)
    response.body = stream.pipeThrough(new CompressionStream(method))
  }
  else {
    response.body = stream
  }
}
