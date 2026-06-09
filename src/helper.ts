import { promisify } from 'node:util'
import zlib from 'node:zlib'
import { Buffer } from 'node:buffer'
import type { H3Event } from 'h3'
import * as h3 from 'h3'

const { getRequestHeader, setResponseHeader } = h3

export interface RenderResponse {
  body: string | unknown
  statusCode: number
  statusMessage: string
  headers: Record<string, string>
}

export type Compression = 'gzip' | 'deflate' | 'br'
export type StreamCompression = 'gzip' | 'deflate'

/**
 * `send` was removed and `toResponse` was added in h3 v2. They are accessed
 * dynamically so this package keeps working with both h3 v1 and v2.
 */
const send = (h3 as { send?: (event: H3Event, data?: unknown) => unknown }).send
const toResponse = (h3 as {
  toResponse?: (val: unknown, event: H3Event) => Response | Promise<Response>
}).toResponse

/**
 * Returns the best compression accepted by the client via the
 * `Accept-Encoding` header. Brotli is preferred, then gzip, then deflate.
 * @param { H3Event } event - A H3 event object.
 * @returns { Compression | undefined }
 */
export function getAnyCompression(event: H3Event): Compression | undefined {
  const encoding = getRequestHeader(event, 'accept-encoding')
  if (encoding?.includes('br'))
    return 'br'

  if (encoding?.includes('gzip'))
    return 'gzip'

  if (encoding?.includes('deflate'))
    return 'deflate'

  return undefined
}

/**
 * Returns the best stream compression accepted by the client. The native
 * `CompressionStream` only supports gzip and deflate, so brotli is ignored.
 * @param { H3Event } event - A H3 event object.
 * @returns { StreamCompression | undefined }
 */
export function getStreamCompression(event: H3Event): StreamCompression | undefined {
  const encoding = getRequestHeader(event, 'accept-encoding')
  if (encoding?.includes('gzip'))
    return 'gzip'

  if (encoding?.includes('deflate'))
    return 'deflate'

  return undefined
}

function isReadableStream(value: unknown): boolean {
  return typeof value === 'object' && value !== null
    && typeof (value as ReadableStream).getReader === 'function'
}

/**
 * Turns a response body into a buffer that can be compressed. Strings, buffers
 * and typed arrays are used as-is; plain JSON-serializable values (e.g. objects
 * returned from a `/server/api` route) are serialized to JSON. Returns
 * `undefined` for bodies that can't / shouldn't be buffered (streams, empty).
 */
function toCompressibleBuffer(event: H3Event, body: unknown): Buffer | undefined {
  if (typeof body === 'string')
    return Buffer.from(body)

  if (body instanceof Uint8Array)
    return Buffer.from(body)

  if (body instanceof ArrayBuffer)
    return Buffer.from(body)

  if (body === null || body === undefined || isReadableStream(body))
    return undefined

  try {
    const json = JSON.stringify(body)
    if (json === undefined)
      return undefined
    // Mirror h3, which serializes objects as JSON.
    setResponseHeader(event, 'Content-Type', 'application/json')
    return Buffer.from(json)
  }
  catch {
    return undefined
  }
}

export async function compress(event: H3Event, response: Partial<RenderResponse>, method: Compression) {
  const acceptsEncoding = getRequestHeader(event, 'accept-encoding')?.includes(
    method,
  )
  if (!acceptsEncoding)
    return

  const payload = toCompressibleBuffer(event, response.body)
  if (!payload)
    return

  const compression = promisify(zlib[method === 'br' ? 'brotliCompress' : method])
  setResponseHeader(event, 'Content-Encoding', method)
  const compressed = await compression(payload)
  // h3 v1 streams the body via `send`, h3 v2 expects the (mutated) body.
  if (typeof send === 'function')
    send(event, compressed)
  else
    response.body = compressed
}

export async function compressStream(event: H3Event, response: Partial<RenderResponse>, method: StreamCompression) {
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

function ensureToResponse(): NonNullable<typeof toResponse> {
  if (typeof toResponse !== 'function') {
    throw new TypeError(
      'The compression middleware requires h3 v2. With h3 v1 use `useCompression` inside an `onBeforeResponse` / `render:response` hook.',
    )
  }

  return toResponse
}

function cloneResponse(response: Response, body: BodyInit, method: string): Response {
  const headers = new Headers(response.headers)
  headers.set('Content-Encoding', method)
  // The length changes after compression, let the runtime recompute it.
  headers.delete('Content-Length')

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Compresses an h3 v2 response value with [Zlib]{@link https://nodejs.org/api/zlib.html}.
 * Used by the {@link compression} middleware.
 * @param { H3Event } event - A H3 event object.
 * @param { unknown } value - The value returned by the next handler.
 * @param { Compression } [method] - Force a specific compression method.
 * @returns { Promise<Response> }
 */
export async function compressResponse(event: H3Event, value: unknown, method?: Compression): Promise<Response> {
  const response = await ensureToResponse()(value, event)
  const compressionMethod = method ?? getAnyCompression(event)

  if (!compressionMethod || response.headers.has('Content-Encoding'))
    return response

  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength === 0)
    return response

  const compression = promisify(zlib[compressionMethod === 'br' ? 'brotliCompress' : compressionMethod])

  return cloneResponse(response, await compression(body), compressionMethod)
}

/**
 * Compresses an h3 v2 response value with
 * [CompressionStream]{@link https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream}.
 * Used by the {@link compressionStream} middleware.
 * @param { H3Event } event - A H3 event object.
 * @param { unknown } value - The value returned by the next handler.
 * @param { StreamCompression } [method] - Force a specific compression method.
 * @returns { Promise<Response> }
 */
export async function compressResponseStream(event: H3Event, value: unknown, method?: StreamCompression): Promise<Response> {
  const response = await ensureToResponse()(value, event)
  const compressionMethod = method ?? getStreamCompression(event)

  if (!compressionMethod || !response.body || response.headers.has('Content-Encoding'))
    return response

  return cloneResponse(response, response.body.pipeThrough(new CompressionStream(compressionMethod)), compressionMethod)
}
