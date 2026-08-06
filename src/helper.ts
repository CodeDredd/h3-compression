import { promisify } from 'node:util'
import zlib from 'node:zlib'
import { Buffer } from 'node:buffer'
import { Duplex } from 'node:stream'
import process from 'node:process'
import type { H3Event } from 'h3'
import * as h3 from 'h3'

const { getRequestHeader, setResponseHeader } = h3

export interface RenderResponse {
  body: string | unknown
  statusCode: number
  statusMessage: string
  headers: Record<string, string>
}

export type Compression = 'gzip' | 'deflate' | 'br' | 'zstd'
export type StreamCompression = 'gzip' | 'deflate' | 'br' | 'zstd'

export interface CompressionOptions {
  /**
   * Consider zstd when picking a compression from the `Accept-Encoding`
   * header. Off by default: `node:zlib` only gained zstd in Node 22.15, so
   * enabling it by default would make the negotiated encoding depend on the
   * runtime version. The flag is ignored when the runtime has no zstd — the
   * next accepted encoding is used instead. See {@link isZstdSupported}.
   * @default false
   */
  zstd?: boolean

  /**
   * Skip compression for bodies smaller than this many bytes. Small payloads
   * usually get *larger* once framing overhead is added, so compressing a
   * 40-byte JSON response is a pure loss. Measured on the serialized body, so
   * it applies to object bodies too.
   *
   * Only applies to the buffered (zlib) path — a stream's size is not known
   * up front.
   * @default 0
   */
  minSize?: number
}

export interface StreamCompressionOptions extends CompressionOptions {
  /**
   * Consider brotli when picking a compression from the `Accept-Encoding`
   * header. Off by default because brotli is noticeably more CPU-expensive
   * per request than gzip. Forcing `'br'` explicitly works without this flag.
   * @default false
   */
  brotli?: boolean
}

/**
 * Whether the current runtime can compress with zstd. `node:zlib` gained the
 * zstd bindings in Node 22.15.0 / 23.8.0; on anything older this is `false`
 * and zstd is skipped during `Accept-Encoding` negotiation.
 * @returns { boolean }
 */
export function isZstdSupported(): boolean {
  return typeof zlib.createZstdCompress === 'function'
}

function ensureZstdSupported(): void {
  if (!isZstdSupported()) {
    throw new TypeError(
      'zstd compression requires Node >= 22.15.0 (or >= 23.8.0), which is when `node:zlib` gained zstd support. '
      + `This runtime is ${process.version}. Use \`isZstdSupported()\` to branch, or the \`zstd\` option to fall back automatically.`,
    )
  }
}

/**
 * `send` (h3 v1) and `toResponse` (h3 v2) each only exist in a single major
 * version. They are read through a runtime key so that bundlers (Nuxt / Nitro /
 * Rollup re-bundling `dist/index.mjs`) don't turn the namespace member access
 * into a static `import { toResponse } from 'h3'`, which would fail on the other
 * version (see issue: Nuxt build error `"toResponse" is not exported by h3`).
 */
function h3Export<T>(name: string): T | undefined {
  return (h3 as Record<string, unknown>)[name] as T | undefined
}

const send = h3Export<(event: H3Event, data?: unknown) => unknown>('send')
const toResponse = h3Export<(val: unknown, event: H3Event) => Response | Promise<Response>>('toResponse')

/**
 * Returns the best compression accepted by the client via the
 * `Accept-Encoding` header. Zstd is preferred when enabled via
 * `options.zstd` and supported by the runtime, then brotli, then gzip,
 * then deflate.
 * @param { H3Event } event - A H3 event object.
 * @param { CompressionOptions } [options] - Opt into zstd detection.
 * @returns { Compression | undefined }
 */
export function getAnyCompression(
  event: H3Event,
  options: CompressionOptions = {},
): Compression | undefined {
  const encoding = getRequestHeader(event, 'accept-encoding')
  if (options.zstd && isZstdSupported() && encoding?.includes('zstd'))
    return 'zstd'

  if (encoding?.includes('br'))
    return 'br'

  if (encoding?.includes('gzip'))
    return 'gzip'

  if (encoding?.includes('deflate'))
    return 'deflate'

  return undefined
}

/**
 * Returns the best stream compression accepted by the client. Zstd and brotli
 * are only considered when enabled via `options`, otherwise gzip is preferred,
 * then deflate.
 * @param { H3Event } event - A H3 event object.
 * @param { StreamCompressionOptions } [options] - Opt into zstd / brotli detection.
 * @returns { StreamCompression | undefined }
 */
export function getStreamCompression(
  event: H3Event,
  options: StreamCompressionOptions = {},
): StreamCompression | undefined {
  const encoding = getRequestHeader(event, 'accept-encoding')
  if (options.zstd && isZstdSupported() && encoding?.includes('zstd'))
    return 'zstd'

  if (options.brotli && encoding?.includes('br'))
    return 'br'

  if (encoding?.includes('gzip'))
    return 'gzip'

  if (encoding?.includes('deflate'))
    return 'deflate'

  return undefined
}

/**
 * Creates the transform used to compress a response body stream.
 *
 * The native `CompressionStream` implements the WHATWG `CompressionFormat`
 * enum, which only defines gzip, deflate and deflate-raw — brotli and zstd are
 * therefore streamed through `node:zlib` instead. The explicit flush mode is
 * required to keep the output chunked; with zlib's defaults both buffer the
 * whole body until the source closes, which defeats the point of a stream.
 * @param { StreamCompression } method - The compression to apply.
 * @returns { ReadableWritablePair<Uint8Array, Uint8Array> }
 */
function createCompressionTransform(method: StreamCompression): ReadableWritablePair<Uint8Array, Uint8Array> {
  if (method === 'br') {
    return Duplex.toWeb(zlib.createBrotliCompress({
      flush: zlib.constants.BROTLI_OPERATION_FLUSH,
    })) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
  }

  if (method === 'zstd') {
    ensureZstdSupported()
    return Duplex.toWeb(zlib.createZstdCompress({
      flush: zlib.constants.ZSTD_e_flush,
    })) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
  }

  return new CompressionStream(method)
}

/**
 * Returns the buffered (one-shot) compressor for a method.
 * @param { Compression } method - The compression to apply.
 * @returns { (payload: Uint8Array) => Promise<Buffer> }
 */
function createCompressor(method: Compression): (payload: Uint8Array) => Promise<Buffer> {
  if (method === 'zstd')
    ensureZstdSupported()

  const compressors = {
    br: 'brotliCompress',
    zstd: 'zstdCompress',
    gzip: 'gzip',
    deflate: 'deflate',
  } as const

  return promisify(zlib[compressors[method]]) as (payload: Uint8Array) => Promise<Buffer>
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

export async function compress(
  event: H3Event,
  response: Partial<RenderResponse>,
  method: Compression,
  options: CompressionOptions = {},
) {
  const acceptsEncoding = getRequestHeader(event, 'accept-encoding')?.includes(
    method,
  )
  if (!acceptsEncoding)
    return

  const payload = toCompressibleBuffer(event, response.body)
  if (!payload || payload.byteLength < (options.minSize ?? 0))
    return

  const compression = createCompressor(method)
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
    response.body = stream.pipeThrough(createCompressionTransform(method))
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

/**
 * Rebuilds a `Response` around a new body. Reading `response.arrayBuffer()`
 * consumes the original, so even the "not compressed after all" paths have to
 * go through here rather than returning the drained original.
 * @param { Response } response - The response to copy status and headers from.
 * @param { BodyInit } body - The replacement body.
 * @param { string } [method] - Content-Encoding to set; omitted for a plain passthrough.
 * @returns { Response }
 */
function cloneResponse(response: Response, body: BodyInit, method?: string): Response {
  const headers = new Headers(response.headers)

  if (method) {
    headers.set('Content-Encoding', method)
    // The length changes after compression, let the runtime recompute it.
    headers.delete('Content-Length')
  }

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
 * @param { CompressionOptions } [options] - Opt into zstd detection.
 * @returns { Promise<Response> }
 */
export async function compressResponse(
  event: H3Event,
  value: unknown,
  method?: Compression,
  options?: CompressionOptions,
): Promise<Response> {
  const response = await ensureToResponse()(value, event)
  const compressionMethod = method ?? getAnyCompression(event, options)

  if (!compressionMethod || response.headers.has('Content-Encoding'))
    return response

  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength === 0 || body.byteLength < (options?.minSize ?? 0))
    return cloneResponse(response, body)

  const compression = createCompressor(compressionMethod)

  return cloneResponse(response, await compression(body), compressionMethod)
}

/**
 * Compresses an h3 v2 response value with
 * [CompressionStream]{@link https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream}.
 * Used by the {@link compressionStream} middleware.
 * @param { H3Event } event - A H3 event object.
 * @param { unknown } value - The value returned by the next handler.
 * @param { StreamCompression } [method] - Force a specific compression method.
 * @param { StreamCompressionOptions } [options] - Opt into brotli detection.
 * @returns { Promise<Response> }
 */
export async function compressResponseStream(
  event: H3Event,
  value: unknown,
  method?: StreamCompression,
  options?: StreamCompressionOptions,
): Promise<Response> {
  const response = await ensureToResponse()(value, event)
  const compressionMethod = method ?? getStreamCompression(event, options)

  if (!compressionMethod || !response.body || response.headers.has('Content-Encoding'))
    return response

  return cloneResponse(response, response.body.pipeThrough(createCompressionTransform(compressionMethod)), compressionMethod)
}
