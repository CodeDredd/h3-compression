import { Buffer } from 'node:buffer'
import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import * as h3 from 'h3'
import {
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

  it('picks the best stream compression accepted', async () => {
    const event = eventFor('gzip, deflate')
    const response = { body: html }

    await useCompressionStream(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(zlib.gunzipSync(await readStream(response.body as unknown as ReadableStream)).toString()).toEqual(html)
  })
})
