import { Buffer } from 'node:buffer'
import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import * as h3 from 'h3'
import {
  useBrotliCompressionStream,
  useCompressionStream,
  useDeflateCompressionStream,
  useGZipCompressionStream,
} from '../src'
import { isV2 } from './_version'

// `mockEvent` only exists in h3 v2 — access it lazily so this file still loads
// (but is skipped) under h3 v1.
const { mockEvent } = h3 as typeof import('h3')

const html = '<h1>Hello World</h1>'

function eventFor(encoding: string) {
  return mockEvent('/', { headers: { 'accept-encoding': encoding } })
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

describe.runIf(isV2)('useCompressionStream (mutable response / nitro path)', () => {
  it('compresses the body stream with gzip', async () => {
    const event = eventFor('gzip')
    const response = { body: html }

    await useGZipCompressionStream(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(zlib.gunzipSync(await readStream(response.body as unknown as ReadableStream)).toString()).toEqual(html)
  })

  it('compresses the body stream with deflate', async () => {
    const event = eventFor('deflate')
    const response = { body: html }

    await useDeflateCompressionStream(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('deflate')
    expect(zlib.inflateSync(await readStream(response.body as unknown as ReadableStream)).toString()).toEqual(html)
  })

  it('compresses the body stream with brotli', async () => {
    const event = eventFor('br')
    const response = { body: html }

    await useBrotliCompressionStream(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('br')
    expect(zlib.brotliDecompressSync(await readStream(response.body as unknown as ReadableStream)).toString()).toEqual(html)
  })

  it('picks the best stream compression accepted', async () => {
    const event = eventFor('gzip, deflate')
    const response = { body: html }

    await useCompressionStream(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(zlib.gunzipSync(await readStream(response.body as unknown as ReadableStream)).toString()).toEqual(html)
  })

  it('ignores brotli by default and falls back to gzip (#19)', async () => {
    const event = eventFor('br, gzip, deflate')
    const response = { body: html }

    await useCompressionStream(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(zlib.gunzipSync(await readStream(response.body as unknown as ReadableStream)).toString()).toEqual(html)
  })

  it('picks brotli when it is enabled via options (#19)', async () => {
    const event = eventFor('br, gzip, deflate')
    const response = { body: html }

    await useCompressionStream(event, response, { brotli: true })

    expect(event.res.headers.get('content-encoding')).toEqual('br')
    expect(zlib.brotliDecompressSync(await readStream(response.body as unknown as ReadableStream)).toString()).toEqual(html)
  })

  it('still falls back to gzip with brotli enabled but not accepted (#19)', async () => {
    const event = eventFor('gzip')
    const response = { body: html }

    await useCompressionStream(event, response, { brotli: true })

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(zlib.gunzipSync(await readStream(response.body as unknown as ReadableStream)).toString()).toEqual(html)
  })

  it('keeps the brotli stream chunked instead of buffering the whole body (#19)', async () => {
    const event = eventFor('br')
    // A source that yields several chunks over time — with zlib's default
    // flush mode brotli would emit a single chunk only once it closed.
    const source = new ReadableStream({
      async pull(controller) {
        for (let i = 0; i < 3; i++) {
          controller.enqueue(new TextEncoder().encode(`chunk-${i}-${'x'.repeat(64)}`))
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        controller.close()
      },
    })
    const response = { body: source }

    await useBrotliCompressionStream(event, response as any)

    const chunks: Buffer[] = []
    const reader = (response.body as unknown as ReadableStream).getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      chunks.push(Buffer.from(value))
    }

    expect(chunks.length).toBeGreaterThan(1)
    expect(zlib.brotliDecompressSync(Buffer.concat(chunks)).toString()).toContain('chunk-2')
  })
})
