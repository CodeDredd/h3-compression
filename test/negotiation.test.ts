import { Buffer } from 'node:buffer'
import zlib from 'node:zlib'
import supertest from 'supertest'
import { describe, expect, it } from 'vitest'
import * as h3 from 'h3'
import {
  compress,
  compressStream,
  compression,
  compressionStream,
  getAnyCompression,
  getStreamCompression,
  isZstdSupported,
  useCompression,
  useCompressionStream,
  useGZipCompression,
} from '../src'
import { applyCompression } from '../src/runtime/nitro-plugin'
import { isV1, isV2 } from './_version'

// Regression tests for #25: `Accept-Encoding` was matched by substring, so
// quality values (including `q=0`) were ignored, and `Vary: Accept-Encoding`
// was never set.

const { createApp, eventHandler, mockEvent, toNodeListener, H3 } = h3 as typeof import('h3')

const hasZstd = isZstdSupported()
const html = `<h1>${'Hello world! '.repeat(100)}</h1>`

function eventFor(encoding?: string) {
  return mockEvent('/', { headers: encoding === undefined ? {} : { 'accept-encoding': encoding } })
}

describe.runIf(isV2)('Accept-Encoding negotiation (#25)', () => {
  it.each([
    ['br;q=0, gzip', 'gzip'],
    ['gzip;q=0', undefined],
    ['gzip;q=0.1, deflate;q=0.9', 'deflate'],
    ['gzip, deflate, br', 'br'],
    ['gzip;q=1.0, br;q=0.5', 'gzip'],
    ['BR, GZIP', 'br'],
    [' gzip ; q=0.5 , deflate ; q=0.4 ', 'gzip'],
    ['*', 'br'],
    ['*;q=0.5, gzip', 'gzip'],
    ['br;q=0, *', 'gzip'],
    ['*;q=0, deflate', 'deflate'],
    ['x-gzip', 'gzip'],
    ['gzip;q=abc, deflate', 'deflate'],
    ['gzip;q=', undefined],
    ['deflate-raw', undefined],
    ['identity', undefined],
    ['', undefined],
  ])('getAnyCompression(%j) -> %s', (header, expected) => {
    expect(getAnyCompression(eventFor(header))).toEqual(expected)
  })

  it('does not compress without an Accept-Encoding header', () => {
    expect(getAnyCompression(eventFor())).toBeUndefined()
    expect(getStreamCompression(eventFor())).toBeUndefined()
  })

  it.each([
    ['br, gzip', {}, 'gzip'],
    ['br;q=1, gzip;q=0.5', {}, 'gzip'],
    ['br;q=1, gzip;q=0.5', { brotli: true }, 'br'],
    ['br;q=0.5, gzip', { brotli: true }, 'gzip'],
    ['gzip;q=0, deflate;q=0.2', {}, 'deflate'],
    ['gzip;q=0', {}, undefined],
  ] as const)('getStreamCompression(%j, %j) -> %s', (header, options, expected) => {
    expect(getStreamCompression(eventFor(header), options)).toEqual(expected)
  })

  it.runIf(hasZstd)('honours quality values for zstd', () => {
    expect(getAnyCompression(eventFor('zstd;q=0, br'), { zstd: true })).toEqual('br')
    expect(getAnyCompression(eventFor('zstd;q=0.5, gzip'), { zstd: true })).toEqual('gzip')
    expect(getAnyCompression(eventFor('zstd, br'), { zstd: true })).toEqual('zstd')
    expect(getStreamCompression(eventFor('zstd;q=0, gzip'), { zstd: true })).toEqual('gzip')
  })
})

describe.runIf(isV2)('Vary: Accept-Encoding on the hook path (#25)', () => {
  it('is set on a compressed response', async () => {
    const event = eventFor('gzip')
    const response = { body: html }

    await useCompression(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(event.res.headers.get('vary')).toEqual('Accept-Encoding')
  })

  it('is set when nothing acceptable was offered', async () => {
    const event = eventFor('gzip;q=0')
    const response = { body: html }

    await useCompression(event, response)

    expect(event.res.headers.get('content-encoding')).toBeNull()
    expect(event.res.headers.get('vary')).toEqual('Accept-Encoding')
    expect(response.body).toEqual(html)
  })

  it('keeps existing values and does not duplicate itself', async () => {
    const event = eventFor('gzip')
    event.res.headers.set('vary', 'Origin')
    const response = { body: html }

    await useCompression(event, response)
    await useCompression(event, response)

    expect(event.res.headers.get('vary')).toEqual('Origin, Accept-Encoding')
  })

  it('leaves `Vary: *` and an existing accept-encoding entry alone', async () => {
    const star = eventFor('gzip')
    star.res.headers.set('vary', '*')
    await useCompression(star, { body: html })
    expect(star.res.headers.get('vary')).toEqual('*')

    const listed = eventFor('gzip')
    listed.res.headers.set('vary', 'origin, accept-encoding')
    await useCompression(listed, { body: html })
    expect(listed.res.headers.get('vary')).toEqual('origin, accept-encoding')
  })

  it('updates a Vary in the render:response header record', async () => {
    const event = eventFor('gzip')
    const response = { body: html, headers: { 'Vary': 'Cookie', 'Content-Type': 'text/html' } }

    await useCompression(event, response)

    expect(response.headers.Vary).toEqual('Cookie, Accept-Encoding')
  })

  it('is not set for responses that are never compressed', async () => {
    const encoded = eventFor('gzip')
    encoded.res.headers.set('content-encoding', 'br')
    await useCompression(encoded, { body: html })
    expect(encoded.res.headers.get('vary')).toBeNull()

    const empty = eventFor('gzip')
    await useCompression(empty, { body: '' })
    expect(empty.res.headers.get('vary')).toBeNull()
    expect(empty.res.headers.get('content-encoding')).toBeNull()

    const small = eventFor('gzip')
    await compress(small, { body: html }, undefined, { minSize: 1_000_000 })
    expect(small.res.headers.get('vary')).toBeNull()
  })

  it('is set by a forced method the client rejects', async () => {
    const event = eventFor('gzip;q=0, deflate')
    const response = { body: html }

    await useGZipCompression(event, response)

    expect(event.res.headers.get('content-encoding')).toBeNull()
    expect(event.res.headers.get('vary')).toEqual('Accept-Encoding')
    expect(response.body).toEqual(html)
  })

  it('is set on the stream path, compressed or not', async () => {
    const compressed = eventFor('br;q=0, gzip')
    const response: { body: unknown } = { body: html }
    await useCompressionStream(compressed, response, { brotli: true })
    expect(compressed.res.headers.get('content-encoding')).toEqual('gzip')
    expect(compressed.res.headers.get('vary')).toEqual('Accept-Encoding')

    const rejected = eventFor('gzip;q=0')
    const untouched = { body: html }
    await compressStream(rejected, untouched, 'gzip')
    expect(rejected.res.headers.get('content-encoding')).toBeNull()
    expect(rejected.res.headers.get('vary')).toEqual('Accept-Encoding')
    expect(untouched.body).toEqual(html)
  })

  it('skips empty bodies on the stream path', async () => {
    const event = eventFor('gzip')
    const response = { body: undefined }

    await useCompressionStream(event, response)

    expect(response.body).toBeUndefined()
    expect(event.res.headers.get('content-encoding')).toBeNull()
    expect(event.res.headers.get('vary')).toBeNull()
  })

  it('applies to the nuxt plugin', async () => {
    const event = eventFor('br;q=0, gzip')
    const response = { body: html, headers: { 'content-type': 'text/html' } }

    await applyCompression(event, response, {})

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(event.res.headers.get('vary')).toEqual('Accept-Encoding')
    expect(zlib.gunzipSync(response.body as unknown as Buffer).toString()).toEqual(html)
  })
})

describe.runIf(isV2)('negotiation on the h3 v2 middleware (#25)', () => {
  function appWith(middleware: ReturnType<typeof compression>, vary?: string) {
    const app = new H3()
    app.use(middleware)
    app.get('/', (event) => {
      if (vary)
        event.res.headers.set('vary', vary)
      return html
    })
    app.get('/empty', () => null)
    app.get('/no-content', () => new Response(null, { status: 204 }))
    return app
  }

  async function get(app: InstanceType<typeof H3>, encoding: string, path = '/') {
    return app.fetch(new Request(`http://localhost${path}`, { headers: { 'accept-encoding': encoding } }))
  }

  // The reproduction from the issue.
  it.each([
    ['compression()', () => compression(), 'br;q=0, gzip', 'gzip'],
    ['compression()', () => compression(), 'gzip;q=0', null],
    ['compression()', () => compression(), 'gzip;q=0.1, deflate;q=0.9', 'deflate'],
    ['compressionStream()', () => compressionStream(), 'br;q=0, gzip', 'gzip'],
    ['compressionStream()', () => compressionStream(), 'gzip;q=0', null],
    ['compressionStream()', () => compressionStream(), 'gzip;q=0.1, deflate;q=0.9', 'deflate'],
  ] as const)('%s with %j -> %s', async (_name, middleware, encoding, expected) => {
    const res = await get(appWith(middleware()), encoding)

    expect(res.headers.get('content-encoding')).toEqual(expected)
    expect(res.headers.get('vary')).toEqual('Accept-Encoding')

    const body = Buffer.from(await res.arrayBuffer())
    const decoded = expected === 'gzip'
      ? zlib.gunzipSync(body)
      : expected === 'deflate' ? zlib.inflateSync(body) : body
    expect(decoded.toString()).toEqual(html)
  })

  it('keeps a Vary set by the handler', async () => {
    for (const middleware of [compression(), compressionStream()]) {
      const res = await get(appWith(middleware, 'Origin'), 'gzip')

      expect(res.headers.get('vary')).toEqual('Origin, Accept-Encoding')
    }
  })

  it('does not add Vary for a forced method, which ignores Accept-Encoding', async () => {
    const res = await get(appWith(compression('gzip')), 'deflate')

    expect(res.headers.get('content-encoding')).toEqual('gzip')
    expect(res.headers.get('vary')).toBeNull()
  })

  it('passes bodyless responses through', async () => {
    for (const middleware of [compression(), compressionStream()]) {
      for (const path of ['/empty', '/no-content']) {
        const res = await get(appWith(middleware), 'gzip', path)

        expect(res.headers.get('content-encoding')).toBeNull()
        expect(res.headers.get('vary')).toBeNull()
        expect((await res.arrayBuffer()).byteLength).toEqual(0)
      }
    }
  })
})

describe.runIf(isV1)('negotiation on the h3 v1 app hook (#25)', () => {
  function appWith(hook: (event: any, response: any) => unknown) {
    const app = createApp({ onBeforeResponse: hook })
    app.use('/', eventHandler(() => html))
    return supertest(toNodeListener(app))
  }

  for (const [name, hook] of [
    ['useCompression', useCompression],
    ['useCompressionStream', (event: any, response: any) => useCompressionStream(event, response, { brotli: true })],
    ['nuxt plugin', (event: any, response: any) => applyCompression(event, response, {})],
  ] as const) {
    it(`${name} skips an encoding rejected with q=0`, async () => {
      const result = await appWith(hook).get('/').set('Accept-Encoding', 'br;q=0, gzip')

      expect(result.headers['content-encoding']).toEqual('gzip')
      expect(result.headers.vary).toEqual('Accept-Encoding')
      expect(result.text).toEqual(html)
    })

    it(`${name} does not compress when every encoding is rejected`, async () => {
      const result = await appWith(hook).get('/').set('Accept-Encoding', 'gzip;q=0, br;q=0')

      expect(result.headers['content-encoding']).toBeUndefined()
      expect(result.headers.vary).toEqual('Accept-Encoding')
      expect(result.text).toEqual(html)
    })
  }

  it('picks the highest quality value', async () => {
    const result = await appWith(useCompression).get('/').set('Accept-Encoding', 'gzip;q=0.1, deflate;q=0.9')

    expect(result.headers['content-encoding']).toEqual('deflate')
    expect(result.text).toEqual(html)
  })
})
