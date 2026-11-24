import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import zlib from 'node:zlib'
import * as h3 from 'h3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  compress,
  compression,
  compressionStream,
  compressStream,
  useBrotliCompression,
  useCompression,
  useCompressionStream,
} from '../src'
import { applyCompression } from '../src/runtime/nitro-plugin'
import { isV1, isV2 } from './_version'

// Regression tests for #24: an already-encoded response (e.g. a pre-built
// `.br` asset served by Nitro's static handler with `compressPublicAssets`)
// was compressed a second time and kept its now-stale `Content-Length`.

const { createApp, eventHandler, mockEvent, setResponseHeader, toNodeListener, H3 } = h3 as typeof import('h3')

const original = `/* hello */ ${'a'.repeat(5000)}`
const precompressed = zlib.brotliCompressSync(Buffer.from(original))

async function readStream(stream: ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

describe.runIf(isV2)('already-encoded responses on the hook path (#24)', () => {
  function encodedEvent(accept = 'br, gzip') {
    const event = mockEvent('/asset.css', {
      headers: { 'accept-encoding': accept },
    })
    event.res.headers.set('content-type', 'text/css')
    event.res.headers.set('content-encoding', 'br')
    event.res.headers.set('content-length', String(precompressed.byteLength))
    return event
  }

  it('compress() leaves an already-encoded body untouched', async () => {
    const event = encodedEvent()
    const response = { body: precompressed }

    await compress(event, response, 'br')

    expect(response.body).toBe(precompressed)
    expect(event.res.headers.get('content-encoding')).toEqual('br')
    expect(event.res.headers.get('content-length')).toEqual(String(precompressed.byteLength))
  })

  it('useCompression() leaves an already-encoded body untouched', async () => {
    const event = encodedEvent()
    const response = { body: precompressed }

    await useCompression(event, response)

    expect(response.body).toBe(precompressed)
    expect(event.res.headers.get('content-encoding')).toEqual('br')
  })

  it('compressStream() leaves an already-encoded body untouched', async () => {
    const event = encodedEvent()
    const response = { body: precompressed }

    await compressStream(event, response, 'gzip')

    expect(response.body).toBe(precompressed)
    expect(event.res.headers.get('content-encoding')).toEqual('br')
    expect(event.res.headers.get('content-length')).toEqual(String(precompressed.byteLength))
  })

  it('useCompressionStream() leaves an already-encoded body untouched', async () => {
    const event = encodedEvent()
    const response = { body: precompressed }

    await useCompressionStream(event, response, { brotli: true })

    expect(response.body).toBe(precompressed)
    expect(event.res.headers.get('content-encoding')).toEqual('br')
  })

  it('respects a content-encoding in the render:response header record', async () => {
    const event = mockEvent('/', {
      headers: { 'accept-encoding': 'gzip' },
    })
    const response = {
      body: precompressed,
      headers: { 'Content-Encoding': 'br' },
    }

    await compress(event, response, 'gzip')
    await compressStream(event, response, 'gzip')

    expect(response.body).toBe(precompressed)
    expect(event.res.headers.get('content-encoding')).toBeNull()
  })

  it('still compresses a body explicitly marked as identity', async () => {
    const event = mockEvent('/', {
      headers: { 'accept-encoding': 'gzip' },
    })
    event.res.headers.set('content-encoding', 'identity')
    const response = { body: original }

    await compress(event, response, 'gzip')

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(zlib.gunzipSync(response.body as unknown as Buffer).toString()).toEqual(original)
  })

  it('the nuxt plugin leaves a pre-compressed public asset untouched', async () => {
    const event = encodedEvent()
    const response = { body: precompressed }

    await applyCompression(event, response, { brotli: true })
    await applyCompression(event, response, { encoding: 'stream', brotli: true })

    expect(response.body).toBe(precompressed)
    expect(event.res.headers.get('content-encoding')).toEqual('br')
    expect(event.res.headers.get('content-length')).toEqual(String(precompressed.byteLength))
  })
})

describe.runIf(isV2)('stale content-length on the hook path (#24)', () => {
  function eventWithLength(body: string) {
    const event = mockEvent('/', {
      headers: { 'accept-encoding': 'gzip' },
    })
    event.res.headers.set('content-length', String(Buffer.byteLength(body)))
    return event
  }

  it('compress() drops the content-length of the uncompressed body', async () => {
    const event = eventWithLength(original)
    const response = { body: original }

    await compress(event, response, 'gzip')

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(event.res.headers.get('content-length')).toBeNull()
    expect(zlib.gunzipSync(response.body as unknown as Buffer).toString()).toEqual(original)
  })

  it('compressStream() drops the content-length of the uncompressed body', async () => {
    const event = eventWithLength(original)
    const response = { body: original }

    await compressStream(event, response, 'gzip')

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(event.res.headers.get('content-length')).toBeNull()
    expect(zlib.gunzipSync(await readStream(response.body as unknown as ReadableStream)).toString()).toEqual(original)
  })

  it('drops a content-length from the render:response header record', async () => {
    const event = mockEvent('/', {
      headers: { 'accept-encoding': 'gzip' },
    })
    const response = {
      body: original,
      headers: {
        'Content-Length': String(original.length),
        'Content-Type': 'text/html',
      },
    }

    await compress(event, response, 'gzip')

    expect(response.headers).toEqual({ 'Content-Type': 'text/html' })
  })

  it('keeps the content-length when nothing is compressed', async () => {
    const event = mockEvent('/', {
      headers: { 'accept-encoding': 'identity' },
    })
    event.res.headers.set('content-length', String(original.length))
    const response = { body: original }

    await compress(event, response, 'gzip')

    expect(event.res.headers.get('content-length')).toEqual(String(original.length))
    expect(response.body).toBe(original)
  })
})

describe.runIf(isV2)('already-encoded responses on the h3 v2 middleware (#24)', () => {
  function appWith(middleware: ReturnType<typeof compression>) {
    const app = new H3()
    app.use(middleware)
    app.get('/asset.css', () => new Response(precompressed, {
      headers: {
        'content-type': 'text/css',
        'content-encoding': 'br',
        'content-length': String(precompressed.byteLength),
      },
    }))
    return app
  }

  for (const [name, middleware] of [
    [
      'compression()',
      compression(),
    ],
    [
      'compressionStream()',
      compressionStream({ brotli: true }),
    ],
  ] as const) {
    it(`${name} passes the encoded body through`, async () => {
      const res = await appWith(middleware).fetch(new Request('http://localhost/asset.css', {
        headers: { 'accept-encoding': 'br, gzip' },
      }))

      expect(res.headers.get('content-encoding')).toEqual('br')
      const body = Buffer.from(await res.arrayBuffer())
      expect(body.equals(precompressed)).toBe(true)
    })
  }
})

/**
 * Removes the `Transfer-Encoding: chunked` framing from a raw response body.
 */
function dechunk(raw: Buffer): Buffer {
  const parts: Buffer[] = []
  let offset = 0
  while (offset < raw.length) {
    const lineEnd = raw.indexOf('\r\n', offset)
    const size = Number.parseInt(raw.subarray(offset, lineEnd).toString(), 16)
    if (!size)
      break
    parts.push(raw.subarray(lineEnd + 2, lineEnd + 2 + size))
    offset = lineEnd + 2 + size + 2
  }
  return Buffer.concat(parts)
}

/**
 * Sends a request over a raw socket and returns the unparsed response. `fetch`,
 * `curl` and superagent all transparently decode one encoding layer and would
 * hide a doubly-compressed body or a mismatching `Content-Length`. Only the
 * chunked transfer framing is removed; the body bytes are otherwise untouched.
 */
function rawGet(server: Server, path: string, acceptEncoding: string): Promise<{ head: string, body: Buffer }> {
  const { port } = server.address() as AddressInfo
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nAccept-Encoding: ${acceptEncoding}\r\nConnection: close\r\n\r\n`)
    })
    const chunks: Buffer[] = []
    socket.on('data', chunk => chunks.push(chunk))
    socket.on('end', () => {
      const raw = Buffer.concat(chunks)
      const separator = raw.indexOf('\r\n\r\n')
      const head = raw.subarray(0, separator).toString()
      const body = raw.subarray(separator + 4)
      resolve({
        head,
        body: /^transfer-encoding: chunked/im.test(head)
          ? dechunk(body)
          : body,
      })
    })
    socket.on('error', reject)
  })
}

function headerOf(head: string, name: string): string | undefined {
  return new RegExp(`^${name}: (.*)$`, 'im').exec(head)?.[1]?.trim()
}

describe.runIf(isV1)('already-encoded responses on the h3 v1 app hook (#24)', () => {
  let server: Server | undefined

  afterEach(async () => {
    await new Promise(resolve => server?.close(resolve))
    server = undefined
  })

  async function listen(hook: (event: any, response: any) => unknown, encoded: boolean) {
    const app = createApp({ onBeforeResponse: hook })
    app.use('/asset.css', eventHandler((event) => {
      setResponseHeader(event, 'Content-Type', 'text/css')
      if (encoded) {
        // Exactly what Nitro's static handler does with `compressPublicAssets`.
        setResponseHeader(event, 'Content-Encoding', 'br')
        setResponseHeader(event, 'Content-Length', String(precompressed.byteLength))
        return precompressed
      }
      setResponseHeader(event, 'Content-Length', String(Buffer.byteLength(original)))
      return original
    }))
    server = createServer(toNodeListener(app))
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    return server
  }

  for (const [name, hook] of [
    ['useBrotliCompression', useBrotliCompression],
    ['useCompression', useCompression],
    [
      'useCompressionStream',
      (event: any, response: any) => useCompressionStream(event, response, { brotli: true }),
    ],
    [
      'nuxt plugin',
      (event: any, response: any) => applyCompression(event, response, {}),
    ],
  ] as const) {
    it(`${name} does not compress a pre-compressed asset again`, async () => {
      const { head, body } = await rawGet(await listen(hook, true), '/asset.css', 'br')

      expect(headerOf(head, 'content-encoding')).toEqual('br')
      expect(headerOf(head, 'content-length')).toEqual(String(body.byteLength))
      expect(zlib.brotliDecompressSync(body).toString()).toEqual(original)
    })
  }

  for (const [name, hook] of [
    ['useCompression', useCompression],
    [
      'useCompressionStream',
      (event: any, response: any) => useCompressionStream(event, response),
    ],
  ] as const) {
    it(`${name} drops the stale content-length when compressing`, async () => {
      const { head, body } = await rawGet(await listen(hook, false), '/asset.css', 'gzip')

      expect(headerOf(head, 'content-encoding')).toEqual('gzip')
      // Either recomputed by the runtime or replaced by chunked framing — but
      // never the length of the uncompressed body.
      const length = headerOf(head, 'content-length')
      if (length !== undefined)
        expect(length).toEqual(String(body.byteLength))
      else
        expect(head).toMatch(/^transfer-encoding: chunked/im)
      expect(zlib.gunzipSync(body).toString()).toEqual(original)
    })
  }
})
