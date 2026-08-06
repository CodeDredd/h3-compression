import { Buffer } from 'node:buffer'
import zlib from 'node:zlib'
import type { SuperTest, Test } from 'supertest'
import supertest from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import * as h3 from 'h3'
import { compression, compressionStream } from '../src'
import { isV2 } from './_version'

// superagent does not auto-decode brotli, so read the raw bytes ourselves.
function rawParser(res: any, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

// `H3` and `toNodeHandler` only exist in h3 v2 — access them lazily so this
// file still loads (but is skipped) under h3 v1.
const { H3, toNodeHandler } = h3 as typeof import('h3')

const html = '<h1>Hello World</h1>'

describe.runIf(isV2)('compression middleware (h3 v2)', () => {
  let request: SuperTest<Test>

  beforeEach(() => {
    const app = new H3()
    app.use(compression())
    app.get('/', () => html)
    request = supertest(toNodeHandler(app))
  })

  it('returns 200 OK with gzip compression', async () => {
    const result = await request.get('/').set('Accept-Encoding', 'gzip')

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('gzip')
    expect(result.text).toEqual(html)
  })

  it('returns 200 OK with deflate compression', async () => {
    const result = await request.get('/').set('Accept-Encoding', 'deflate')

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('deflate')
    expect(result.text).toEqual(html)
  })

  it('returns 200 OK with brotli compression', async () => {
    // supertest/superagent does not auto-decode brotli, so only the header is asserted here.
    const result = await request.get('/').set('Accept-Encoding', 'br')

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('br')
  })

  it('does not compress when no supported encoding is accepted', async () => {
    const result = await request.get('/').set('Accept-Encoding', 'identity')

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toBeUndefined()
    expect(result.text).toEqual(html)
  })
})

describe.runIf(isV2)('compressionStream middleware (h3 v2)', () => {
  let request: SuperTest<Test>

  beforeEach(() => {
    const app = new H3()
    app.use(compressionStream())
    app.get('/', () => html)
    request = supertest(toNodeHandler(app))
  })

  it('returns 200 OK with gzip compression stream', async () => {
    const result = await request.get('/').set('Accept-Encoding', 'gzip')

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('gzip')
    expect(result.text).toEqual(html)
  })

  it('returns 200 OK with deflate compression stream', async () => {
    const result = await request.get('/').set('Accept-Encoding', 'deflate')

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('deflate')
    expect(result.text).toEqual(html)
  })

  it('does not pick brotli unless it is enabled (#19)', async () => {
    const result = await request.get('/').set('Accept-Encoding', 'br, gzip')

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('gzip')
    expect(result.text).toEqual(html)
  })

  it('does not compress when no supported encoding is accepted', async () => {
    const result = await request.get('/').set('Accept-Encoding', 'identity')

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toBeUndefined()
    expect(result.text).toEqual(html)
  })
})

describe.runIf(isV2)('compressionStream middleware with brotli (h3 v2, #19)', () => {
  function appWith(options: Parameters<typeof compressionStream>[0]) {
    const app = new H3()
    app.use(compressionStream(options))
    app.get('/', () => html)
    return supertest(toNodeHandler(app))
  }

  it('picks brotli when enabled via options', async () => {
    const result = await appWith({ brotli: true })
      .get('/')
      .set('Accept-Encoding', 'br, gzip')
      .buffer()
      .parse(rawParser)

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('br')
    expect(zlib.brotliDecompressSync(result.body).toString()).toEqual(html)
  })

  it('forces brotli without the flag when passed as a method', async () => {
    const result = await appWith('br')
      .get('/')
      .set('Accept-Encoding', 'br')
      .buffer()
      .parse(rawParser)

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('br')
    expect(zlib.brotliDecompressSync(result.body).toString()).toEqual(html)
  })

  it('falls back to gzip when brotli is enabled but not accepted', async () => {
    const result = await appWith({ brotli: true }).get('/').set('Accept-Encoding', 'gzip')

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('gzip')
    expect(result.text).toEqual(html)
  })
})
