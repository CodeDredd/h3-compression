import { Buffer } from 'node:buffer'
import zlib from 'node:zlib'
import type { SuperTest, Test } from 'supertest'
import supertest from 'supertest'
import { describe, expect, it } from 'vitest'
import * as h3 from 'h3'
import {
  compression,
  compressionStream,
  getAnyCompression,
  getStreamCompression,
  isZstdSupported,
  useCompression,
  useZstdCompression,
  useZstdCompressionStream,
} from '../src'
import { isV2 } from './_version'

// `mockEvent` / `H3` / `toNodeHandler` only exist in h3 v2 — access them lazily
// so this file still loads (but is skipped) under h3 v1.
const { H3, mockEvent, toNodeHandler } = h3 as typeof import('h3')

const html = '<h1>Hello World</h1>'

// `node:zlib` gained zstd in Node 22.15.0 / 23.8.0. Everything that actually
// compresses is gated on the runtime; the negotiation fallbacks are not.
const hasZstd = isZstdSupported()

function eventFor(encoding: string) {
  return mockEvent('/', { headers: { 'accept-encoding': encoding } })
}

// superagent does not auto-decode zstd, so read the raw bytes ourselves.
function rawParser(res: any, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

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

describe.runIf(isV2)('zstd negotiation (#7)', () => {
  it('never picks zstd without the flag, even when accepted', () => {
    const event = eventFor('zstd, gzip')

    expect(getAnyCompression(event)).toEqual('gzip')
    expect(getStreamCompression(event)).toEqual('gzip')
  })

  it('does not let zstd outrank an unflagged brotli in the zlib path', () => {
    const event = eventFor('zstd, br, gzip')

    expect(getAnyCompression(event)).toEqual('br')
  })

  it('falls back when zstd is enabled but not accepted', () => {
    const event = eventFor('gzip, deflate')

    expect(getAnyCompression(event, { zstd: true })).toEqual('gzip')
    expect(getStreamCompression(event, { zstd: true })).toEqual('gzip')
  })

  it.runIf(hasZstd)('prefers zstd over brotli when enabled', () => {
    const event = eventFor('zstd, br, gzip')

    expect(getAnyCompression(event, { zstd: true })).toEqual('zstd')
    expect(getStreamCompression(event, { zstd: true, brotli: true })).toEqual('zstd')
  })

  it.runIf(!hasZstd)('ignores the flag and falls back on runtimes without zstd', () => {
    const event = eventFor('zstd, gzip')

    expect(getAnyCompression(event, { zstd: true })).toEqual('gzip')
    expect(getStreamCompression(event, { zstd: true })).toEqual('gzip')
  })

  it.runIf(!hasZstd)('throws a helpful error when zstd is forced without support', async () => {
    const event = eventFor('zstd')

    await expect(useZstdCompression(event, { body: html }))
      .rejects
      .toThrow(/requires Node >= 22\.15\.0/)
  })
})

describe.runIf(isV2 && hasZstd)('zstd compression (#7)', () => {
  it('compresses the body with zstd', async () => {
    const event = eventFor('zstd')
    const response: { body: unknown } = { body: html }

    await useZstdCompression(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('zstd')
    expect(zlib.zstdDecompressSync(response.body as Buffer).toString()).toEqual(html)
  })

  it('compresses the body stream with zstd', async () => {
    const event = eventFor('zstd')
    const response: { body: unknown } = { body: html }

    await useZstdCompressionStream(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('zstd')
    expect(zlib.zstdDecompressSync(await readStream(response.body as ReadableStream)).toString()).toEqual(html)
  })

  it('picks zstd through useCompression when enabled', async () => {
    const event = eventFor('zstd, br, gzip')
    const response: { body: unknown } = { body: html }

    await useCompression(event, response, { zstd: true })

    expect(event.res.headers.get('content-encoding')).toEqual('zstd')
    expect(zlib.zstdDecompressSync(response.body as Buffer).toString()).toEqual(html)
  })

  it('keeps the zstd stream chunked instead of buffering the whole body', async () => {
    const event = eventFor('zstd')
    const source = new ReadableStream({
      async pull(controller) {
        for (let i = 0; i < 3; i++) {
          controller.enqueue(new TextEncoder().encode(`chunk-${i}-${'x'.repeat(64)}`))
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        controller.close()
      },
    })
    const response: { body: unknown } = { body: source }

    await useZstdCompressionStream(event, response)

    const chunks: Buffer[] = []
    const reader = (response.body as ReadableStream).getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      chunks.push(Buffer.from(value))
    }

    expect(chunks.length).toBeGreaterThan(1)
    expect(zlib.zstdDecompressSync(Buffer.concat(chunks)).toString()).toContain('chunk-2')
  })
})

describe.runIf(isV2 && hasZstd)('zstd middleware (#7)', () => {
  function appWith(middleware: ReturnType<typeof compression>): SuperTest<Test> {
    const app = new H3()
    app.use(middleware)
    app.get('/', () => html)
    return supertest(toNodeHandler(app))
  }

  it('compresses with zstd when enabled via options', async () => {
    const result = await appWith(compression({ zstd: true }))
      .get('/')
      .set('Accept-Encoding', 'zstd, gzip')
      .buffer()
      .parse(rawParser)

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('zstd')
    expect(zlib.zstdDecompressSync(result.body).toString()).toEqual(html)
  })

  it('streams zstd when enabled via options', async () => {
    const result = await appWith(compressionStream({ zstd: true }))
      .get('/')
      .set('Accept-Encoding', 'zstd, gzip')
      .buffer()
      .parse(rawParser)

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('zstd')
    expect(zlib.zstdDecompressSync(result.body).toString()).toEqual(html)
  })

  it('forces zstd without the flag when passed as a method', async () => {
    const result = await appWith(compression('zstd'))
      .get('/')
      .set('Accept-Encoding', 'zstd')
      .buffer()
      .parse(rawParser)

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('zstd')
    expect(zlib.zstdDecompressSync(result.body).toString()).toEqual(html)
  })

  it('still accepts a plain method string (backwards compatible)', async () => {
    const result = await appWith(compression('gzip')).get('/').set('Accept-Encoding', 'gzip')

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('gzip')
    expect(result.text).toEqual(html)
  })
})
