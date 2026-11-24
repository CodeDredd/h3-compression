import type { H3Event } from 'h3'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { Duplex, Readable } from 'node:stream'
import { promisify } from 'node:util'
import zlib from 'node:zlib'
import * as h3 from 'h3'

const { getRequestHeader, getResponseHeader, setResponseHeader } = h3

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
// Only added in h3 1.8 — older v1 releases inside the peer range lack it.
const removeResponseHeader = h3Export<(event: H3Event, name: string) => void>('removeResponseHeader')

/**
 * RFC 9110 asks recipients to treat these legacy names as their modern
 * equivalent (section 8.4.1.3).
 */
const CODING_ALIASES: Record<string, string> = { 'x-gzip': 'gzip' }

/**
 * Parses a quality value. A malformed one makes the coding unacceptable rather
 * than silently promoting it to `q=1`.
 */
function parseQuality(value: string): number {
  const quality = Number(value.trim())
  return Number.isFinite(quality)
    ? Math.min(Math.max(quality, 0), 1)
    : 0
}

/**
 * Parses an `Accept-Encoding` header into its content-codings and quality
 * values ([RFC 9110, section 12.5.3](https://www.rfc-editor.org/rfc/rfc9110#section-12.5.3)).
 * Codings are lowercased; a coding without `q` has quality 1.
 * @param { string } header - The raw header value.
 * @returns { Map<string, number> }
 */
function parseAcceptEncoding(header: string): Map<string, number> {
  const accepted = new Map<string, number>()

  for (const entry of header.split(',')) {
    const [name, ...params] = entry.split(';')
    const coding = name.trim().toLowerCase()
    if (!coding)
      continue

    let quality = 1
    for (const param of params) {
      const [key, value = ''] = param.split('=')
      if (key.trim().toLowerCase() === 'q') {
        quality = parseQuality(value)
        break
      }
    }

    const normalized = CODING_ALIASES[coding] ?? coding
    accepted.set(normalized, Math.max(quality, accepted.get(normalized) ?? 0))
  }

  return accepted
}

/**
 * Reads and parses the request's `Accept-Encoding` header. A missing header
 * yields `undefined`: the client did not ask for any coding, so nothing is
 * compressed.
 */
function getAcceptedEncodings(event: H3Event): Map<string, number> | undefined {
  const header = getRequestHeader(event, 'accept-encoding') as string | string[] | undefined
  if (!header)
    return undefined

  return parseAcceptEncoding(Array.isArray(header)
    ? header.join(',')
    : header)
}

/**
 * The quality the client assigned to a coding: its own entry if listed,
 * otherwise the `*` wildcard (which covers every coding not listed), otherwise
 * 0 — not acceptable.
 */
function qualityOf(accepted: Map<string, number>, coding: string): number {
  return accepted.get(coding) ?? accepted.get('*') ?? 0
}

/**
 * Whether the client accepts `method` with a quality above 0.
 * @param { H3Event } event - A H3 event object.
 * @param { string } method - The content-coding to check.
 * @returns { boolean }
 */
function acceptsEncoding(event: H3Event, method: string): boolean {
  const accepted = getAcceptedEncodings(event)
  return !!accepted && qualityOf(accepted, method) > 0
}

/**
 * Picks the coding with the highest client quality from `candidates`, which
 * are listed in server preference order — that order breaks ties. Codings
 * with quality 0 are never picked.
 */
function negotiate<T extends string>(event: H3Event, candidates: T[]): T | undefined {
  const accepted = getAcceptedEncodings(event)
  if (!accepted)
    return undefined

  let best: T | undefined
  let bestQuality = 0
  for (const candidate of candidates) {
    const quality = qualityOf(accepted, candidate)
    if (quality > bestQuality) {
      best = candidate
      bestQuality = quality
    }
  }

  return best
}

/**
 * Returns the best compression accepted by the client via the
 * `Accept-Encoding` header. The client's quality values decide first
 * (`q=0` rejects a coding); among equally weighted codings zstd is preferred
 * when enabled via `options.zstd` and supported by the runtime, then brotli,
 * then gzip, then deflate.
 * @param { H3Event } event - A H3 event object.
 * @param { CompressionOptions } [options] - Opt into zstd detection.
 * @returns { Compression | undefined }
 */
export function getAnyCompression(
  event: H3Event,
  options: CompressionOptions = {},
): Compression | undefined {
  const candidates: Compression[] = ['br', 'gzip', 'deflate']
  if (options.zstd && isZstdSupported())
    candidates.unshift('zstd')

  return negotiate(event, candidates)
}

/**
 * Returns the best stream compression accepted by the client. The client's
 * quality values decide first (`q=0` rejects a coding). Zstd and brotli are
 * only considered when enabled via `options`; among equally weighted codings
 * zstd is preferred, then brotli, then gzip, then deflate.
 * @param { H3Event } event - A H3 event object.
 * @param { StreamCompressionOptions } [options] - Opt into zstd / brotli detection.
 * @returns { StreamCompression | undefined }
 */
export function getStreamCompression(
  event: H3Event,
  options: StreamCompressionOptions = {},
): StreamCompression | undefined {
  const candidates: StreamCompression[] = ['gzip', 'deflate']
  if (options.brotli)
    candidates.unshift('br')
  if (options.zstd && isZstdSupported())
    candidates.unshift('zstd')

  return negotiate(event, candidates)
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

function isReadableStream(value: unknown): value is ReadableStream {
  return typeof value === 'object' && value !== null
    && typeof (value as ReadableStream).getReader === 'function'
}

function isNodeStream(value: unknown): value is Readable {
  return typeof value === 'object' && value !== null
    && typeof (value as Readable).pipe === 'function'
    && typeof (value as Readable).on === 'function'
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob
}

/**
 * Whether a hook response body carries no bytes at all. Empty bodies are never
 * compressed — the encoding framing would only add bytes, and a
 * `Content-Encoding` on a 204 / 304 is wrong.
 */
function isEmptyBody(body: unknown): boolean {
  if (body === null || body === undefined || body === '')
    return true

  if (body instanceof Uint8Array || body instanceof ArrayBuffer)
    return body.byteLength === 0

  return false
}

/**
 * Whether h3 would send a body as JSON: objects and arrays (e.g. returned from
 * a `/server/api` route), numbers and booleans. Streams, `Blob`s, `Response`s
 * and errors are not — serializing those would replace the payload with
 * their internal state (`{"_events":…}`) or `{}`.
 */
function isJsonBody(body: unknown): boolean {
  if (typeof body === 'number' || typeof body === 'boolean')
    return true

  if (typeof body !== 'object' || body === null || body instanceof Error)
    return false

  const value = body as Record<string, unknown>
  return typeof value.getReader !== 'function'
    && typeof value.pipe !== 'function'
    && typeof value.arrayBuffer !== 'function'
}

/**
 * Serializes a JSON body. `undefined` when it can't be (circular, or a value
 * `JSON.stringify` drops).
 */
function serializeJson(body: unknown): string | undefined {
  try {
    return JSON.stringify(body)
  }
  catch {
    return undefined
  }
}

/**
 * Turns a response body into a buffer that can be compressed. Strings, buffers
 * and typed arrays are used as-is; JSON bodies (see {@link isJsonBody}) are
 * serialized and flagged so the caller can set the content type. Returns
 * `undefined` for bodies that can't / shouldn't be buffered (streams, blobs,
 * responses, empty).
 */
function toCompressibleBuffer(body: unknown): { payload: Buffer, json: boolean } | undefined {
  if (isEmptyBody(body))
    return undefined

  if (typeof body === 'string') {
    return {
      payload: Buffer.from(body),
      json: false,
    }
  }

  if (body instanceof Uint8Array) {
    return {
      payload: Buffer.from(body),
      json: false,
    }
  }

  if (body instanceof ArrayBuffer) {
    return {
      payload: Buffer.from(body),
      json: false,
    }
  }

  if (!isJsonBody(body))
    return undefined

  const json = serializeJson(body)
  return json === undefined
    ? undefined
    : {
        payload: Buffer.from(json),
        json: true,
      }
}

/**
 * Prepares a response body for the stream path. Web and node streams, blobs,
 * strings and bytes are streamed as they are; JSON bodies are serialized
 * first (a plain `new Response(object)` would send `[object Object]`).
 * Anything else — e.g. a `Response` returned on h3 v1 — is left alone.
 *
 * Streams are only opened once the body is actually compressed: `Readable.toWeb`
 * starts consuming the node stream, so the "not compressed" path must not
 * touch it.
 */
function toStreamSource(body: unknown): { open: () => ReadableStream, json: boolean } | undefined {
  if (isEmptyBody(body))
    return undefined

  if (isReadableStream(body)) {
    return {
      open: () => body,
      json: false,
    }
  }

  if (isNodeStream(body)) {
    return {
      open: () => Readable.toWeb(body) as unknown as ReadableStream,
      json: false,
    }
  }

  if (typeof body === 'string' || body instanceof Uint8Array || body instanceof ArrayBuffer || isBlob(body)) {
    return {
      open: () => new Response(body as BodyInit).body as ReadableStream,
      json: false,
    }
  }

  if (!isJsonBody(body))
    return undefined

  const json = serializeJson(body)
  return json === undefined
    ? undefined
    : {
        open: () => new Response(json).body as ReadableStream,
        json: true,
      }
}

/**
 * Finds the key of a header in a plain header record, ignoring case.
 */
function findHeaderKey(headers: Record<string, unknown>, name: string): string | undefined {
  return Object.keys(headers).find(key => key.toLowerCase() === name)
}

/**
 * Reads a response header from the header record a Nitro `render:response`
 * hook hands over (Nitro only applies it to the event after the hook ran),
 * falling back to the headers already set on the event.
 * @param { H3Event } event - A H3 event object.
 * @param { Partial<RenderResponse> } response - The response object handed over by the hook.
 * @param { string } name - The lowercase header name.
 * @returns { string | undefined }
 */
function getHeader(event: H3Event, response: Partial<RenderResponse>, name: string): string | undefined {
  const headers = response.headers
  if (headers && typeof headers === 'object') {
    const key = findHeaderKey(headers, name)
    if (key !== undefined && headers[key] != null)
      return String(headers[key])
  }

  const value = getResponseHeader(event, name)
  return value == null
    ? undefined
    : String(value)
}

/**
 * Removes a response header from both the hook's header record and the event.
 * @param { H3Event } event - A H3 event object.
 * @param { Partial<RenderResponse> } response - The response object handed over by the hook.
 * @param { string } name - The lowercase header name.
 */
function removeHeader(event: H3Event, response: Partial<RenderResponse>, name: string): void {
  const headers = response.headers
  if (headers && typeof headers === 'object') {
    const key = findHeaderKey(headers, name)
    if (key !== undefined)
      delete headers[key]
  }

  if (typeof removeResponseHeader === 'function')
    removeResponseHeader(event, name)
  else
    (event as unknown as { node?: { res?: { removeHeader?: (name: string) => void } } }).node?.res?.removeHeader?.(name)
}

/**
 * Whether a `Content-Encoding` value means the body is already encoded.
 * `identity` (or nothing) means it is not.
 */
function isEncodedValue(encoding: string | null | undefined): boolean {
  const value = encoding?.trim().toLowerCase()
  return !!value && value !== 'identity'
}

/**
 * Whether the response body is already content-encoded, e.g. a pre-compressed
 * `.br` / `.gz` asset served by Nitro's static handler with
 * `compressPublicAssets`. Compressing it again would produce a body the client
 * can only decode once — leaving it with compressed bytes instead of the asset.
 * @param { H3Event } event - A H3 event object.
 * @param { Partial<RenderResponse> } response - The response object handed over by the hook.
 * @returns { boolean }
 */
function isEncoded(event: H3Event, response: Partial<RenderResponse>): boolean {
  return isEncodedValue(getHeader(event, response, 'content-encoding'))
}

/**
 * Adds `Accept-Encoding` to a `Vary` header value, keeping the values already
 * there. Returned unchanged if it is already listed or the value is `*`.
 * @param { string | null | undefined } vary - The current `Vary` value.
 * @returns { string }
 */
function mergeVary(vary: string | null | undefined): string {
  const values = (vary ?? '').split(',').map(value => value.trim()).filter(Boolean)
  if (values.some(value => value === '*' || value.toLowerCase() === 'accept-encoding'))
    return vary as string

  return [...values, 'Accept-Encoding'].join(', ')
}

/**
 * Marks the response as depending on `Accept-Encoding`, so shared caches and
 * CDNs don't serve a body compressed for one client to a client that never
 * asked for that encoding (RFC 9110, section 12.5.5). Applied whether or not
 * this particular response ends up compressed — another `Accept-Encoding`
 * would have changed the outcome either way.
 *
 * A `Vary` in the `render:response` header record is updated in place, because
 * Nitro applies that record after the hook and would overwrite the event's.
 * @param { H3Event } event - A H3 event object.
 * @param { Partial<RenderResponse> } response - The response object handed over by the hook.
 */
function varyOnAcceptEncoding(event: H3Event, response: Partial<RenderResponse>): void {
  const headers = response.headers
  const key = headers && typeof headers === 'object'
    ? findHeaderKey(headers, 'vary')
    : undefined
  if (headers && key !== undefined) {
    headers[key] = mergeVary(headers[key] == null
      ? undefined
      : String(headers[key]))
    return
  }

  const current = getResponseHeader(event, 'vary')
  setResponseHeader(event, 'Vary', mergeVary(current == null
    ? undefined
    : String(current)))
}

/**
 * Marks the response as encoded with `method`. The `Content-Length` of the
 * uncompressed body no longer matches the bytes on the wire, which breaks
 * the HTTP framing (clients read into the next response on keep-alive), so
 * it is dropped and left for the runtime to recompute.
 * @param { H3Event } event - A H3 event object.
 * @param { Partial<RenderResponse> } response - The response object handed over by the hook.
 * @param { string } method - The applied content-encoding.
 */
function setEncoding(event: H3Event, response: Partial<RenderResponse>, method: string): void {
  removeHeader(event, response, 'content-length')
  setResponseHeader(event, 'Content-Encoding', method)
}

/**
 * Compresses a buffered response body in place — the building block of
 * {@link useCompression} and the Nuxt module, for hooks that hand over a
 * mutable response (h3 v1 `onBeforeResponse`, Nitro `render:response` /
 * `beforeResponse`).
 *
 * Nothing happens for empty, streamed or already-encoded bodies, nor below
 * `options.minSize`. Otherwise `Vary: Accept-Encoding` is set, and the body is
 * compressed if the client accepts the coding.
 * @param { H3Event } event - A H3 event object.
 * @param { Partial<RenderResponse> } response - A response object with body parameter.
 * @param { Compression } [method] - The coding to apply, if the client accepts it. Negotiated from `Accept-Encoding` when omitted.
 * @param { CompressionOptions } [options] - Opt into zstd detection, set a minimum size.
 * @returns { Promise<void> }
 */
export async function compress(
  event: H3Event,
  response: Partial<RenderResponse>,
  method?: Compression,
  options: CompressionOptions = {},
): Promise<void> {
  if (isEncoded(event, response))
    return

  const serialized = toCompressibleBuffer(response.body)
  if (!serialized || serialized.payload.byteLength < (options.minSize ?? 0))
    return

  varyOnAcceptEncoding(event, response)

  const encoding = method
    ? (acceptsEncoding(event, method)
        ? method
        : undefined)
    : getAnyCompression(event, options)
  if (!encoding)
    return

  // Mirror h3, which serializes objects as JSON.
  if (serialized.json)
    setResponseHeader(event, 'Content-Type', 'application/json')

  const compression = createCompressor(encoding)
  setEncoding(event, response, encoding)
  const compressed = await compression(serialized.payload)
  // h3 v1 streams the body via `send`, h3 v2 expects the (mutated) body.
  if (typeof send === 'function')
    send(event, compressed)
  else
    response.body = compressed
}

/**
 * Compresses a response body in place by piping it through a compression
 * stream — the building block of {@link useCompressionStream}.
 *
 * Nothing happens for empty or already-encoded bodies. Otherwise
 * `Vary: Accept-Encoding` is set, and the body is compressed if the client
 * accepts the coding. JSON bodies are serialized first, and web / node
 * streams, blobs, strings and bytes are streamed as they are.
 * @param { H3Event } event - A H3 event object.
 * @param { Partial<RenderResponse> } response - A response object with body parameter.
 * @param { StreamCompression } [method] - The coding to apply, if the client accepts it. Negotiated from `Accept-Encoding` when omitted.
 * @param { StreamCompressionOptions } [options] - Opt into zstd / brotli detection.
 * @returns { Promise<void> }
 */
export async function compressStream(
  event: H3Event,
  response: Partial<RenderResponse>,
  method?: StreamCompression,
  options: StreamCompressionOptions = {},
): Promise<void> {
  if (isEncoded(event, response))
    return

  const source = toStreamSource(response.body)
  if (!source)
    return

  varyOnAcceptEncoding(event, response)

  const encoding = method
    ? (acceptsEncoding(event, method)
        ? method
        : undefined)
    : getStreamCompression(event, options)
  if (!encoding)
    return

  // Mirror h3, which serializes objects as JSON.
  if (source.json)
    setResponseHeader(event, 'Content-Type', 'application/json')

  setEncoding(event, response, encoding)
  response.body = source.open().pipeThrough(createCompressionTransform(encoding))
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
 * go through here rather than returning the drained original. Headers of a
 * `fetch()` response are immutable, so they are never changed in place.
 * @param { Response } response - The response to copy status and headers from.
 * @param { BodyInit | null } body - The replacement body.
 * @param { object } [options] - What to change on the copy.
 * @param { string } [options.encoding] - Content-Encoding to set; omitted for a plain passthrough.
 * @param { boolean } [options.vary] - Add `Accept-Encoding` to `Vary`.
 * @returns { Response }
 */
function cloneResponse(
  response: Response,
  body: BodyInit | null,
  options: { encoding?: string, vary?: boolean } = {},
): Response {
  const headers = new Headers(response.headers)

  if (options.encoding) {
    headers.set('Content-Encoding', options.encoding)
    // The length changes after compression, let the runtime recompute it.
    headers.delete('Content-Length')
  }

  if (options.vary)
    headers.set('Vary', mergeVary(headers.get('Vary')))

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Whether a `Response` has nothing to compress: no body at all (204, 304,
 * HEAD) or one announced as empty — h3 v2 turns a `null` / `undefined` handler
 * result into a 200 with an empty body and `Content-Length: 0`.
 */
function isBodyless(response: Response): boolean {
  return !response.body || response.headers.get('Content-Length') === '0'
}

/**
 * Compresses an h3 v2 response value with [Zlib]{@link https://nodejs.org/api/zlib.html}.
 * Used by the {@link compression} middleware.
 *
 * A negotiated response gets `Vary: Accept-Encoding`, compressed or not. A
 * forced `method` is applied regardless of `Accept-Encoding`, so it does not.
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
  if (isBodyless(response) || isEncodedValue(response.headers.get('Content-Encoding')))
    return response

  const negotiated = method === undefined
  const compressionMethod = method ?? getAnyCompression(event, options)
  if (!compressionMethod)
    return cloneResponse(response, response.body, { vary: true })

  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength === 0 || body.byteLength < (options?.minSize ?? 0))
    return cloneResponse(response, body)

  const compression = createCompressor(compressionMethod)

  return cloneResponse(response, await compression(body), { encoding: compressionMethod, vary: negotiated })
}

/**
 * Compresses an h3 v2 response value with
 * [CompressionStream]{@link https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream}.
 * Used by the {@link compressionStream} middleware.
 *
 * A negotiated response gets `Vary: Accept-Encoding`, compressed or not. A
 * forced `method` is applied regardless of `Accept-Encoding`, so it does not.
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
  if (isBodyless(response) || isEncodedValue(response.headers.get('Content-Encoding')))
    return response

  const negotiated = method === undefined
  const compressionMethod = method ?? getStreamCompression(event, options)
  if (!compressionMethod)
    return cloneResponse(response, response.body, { vary: true })

  return cloneResponse(
    response,
    response.body!.pipeThrough(createCompressionTransform(compressionMethod)),
    { encoding: compressionMethod, vary: negotiated },
  )
}
