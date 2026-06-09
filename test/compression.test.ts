import type { Buffer } from 'node:buffer'
import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import * as h3 from 'h3'
import {
  useBrotliCompression,
  useCompression,
  useDeflateCompression,
  useGZipCompression,
} from '../src'
import { isV2 } from './_version'

// `mockEvent` only exists in h3 v2 — access it lazily so this file still loads
// (but is skipped) under h3 v1.
const { mockEvent } = h3 as typeof import('h3')

const html = '<h1>Hello World</h1>'

function eventFor(encoding: string) {
  return mockEvent('/', { headers: { 'accept-encoding': encoding } })
}

const decoders: Record<string, (input: Buffer) => Buffer> = {
  gzip: zlib.gunzipSync,
  deflate: zlib.inflateSync,
  br: zlib.brotliDecompressSync,
}

describe.runIf(isV2)('useCompression (mutable response / nitro path)', () => {
  it('compresses the body with gzip', async () => {
    const event = eventFor('gzip')
    const response = { body: html }

    await useGZipCompression(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(decoders.gzip(response.body as Buffer).toString()).toEqual(html)
  })

  it('compresses an object (JSON) body and sets the content-type (#8)', async () => {
    const event = eventFor('gzip')
    const json = { message: 'hello world', items: [1, 2, 3] }
    const response: { body: unknown } = { body: json }

    await useGZipCompression(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(event.res.headers.get('content-type')).toContain('application/json')
    expect(JSON.parse(decoders.gzip(response.body as Buffer).toString())).toEqual(json)
  })

  it('compresses the body with deflate', async () => {
    const event = eventFor('deflate')
    const response = { body: html }

    await useDeflateCompression(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('deflate')
    expect(decoders.deflate(response.body as Buffer).toString()).toEqual(html)
  })

  it('compresses the body with brotli', async () => {
    const event = eventFor('br')
    const response = { body: html }

    await useBrotliCompression(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('br')
    expect(decoders.br(response.body as Buffer).toString()).toEqual(html)
  })

  it('picks the best accepted compression', async () => {
    const event = eventFor('gzip, deflate, br')
    const response = { body: html }

    await useCompression(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('br')
    expect(decoders.br(response.body as Buffer).toString()).toEqual(html)
  })

  it('does nothing when no compression is accepted', async () => {
    const event = eventFor('identity')
    const response = { body: html }

    await useCompression(event, response)

    expect(event.res.headers.get('content-encoding')).toBeNull()
    expect(response.body).toEqual(html)
  })
})
