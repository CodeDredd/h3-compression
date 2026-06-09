import { Buffer } from 'node:buffer'
import zlib from 'node:zlib'
import type { SuperTest, Test } from 'supertest'
import supertest from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import * as h3 from 'h3'
import { useCompression, useCompressionStream } from '../src'
import { isV1 } from './_version'

// superagent does not auto-decode brotli, so read the raw bytes ourselves.
function rawParser(res: any, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

// `createApp` / `eventHandler` / `toNodeListener` exist in both h3 versions, but
// the `onBeforeResponse` app hook only works in v1.
const { createApp, eventHandler, toNodeListener } = h3 as typeof import('h3')

const html = '<h1>Hello World</h1>'
const json = { message: 'hello world', items: [1, 2, 3, 4, 5] }

function appWith(hook: typeof useCompression) {
  const app = createApp({ debug: true, onBeforeResponse: hook })
  app.use('/', eventHandler(() => html))
  return supertest(toNodeListener(app))
}

function jsonAppWith(hook: typeof useCompression) {
  const app = createApp({ debug: true, onBeforeResponse: hook })
  app.use('/api', eventHandler(() => json))
  return supertest(toNodeListener(app))
}

describe.runIf(isV1)('useCompression (h3 v1 app hook)', () => {
  let request: SuperTest<Test>

  beforeEach(() => {
    request = appWith(useCompression)
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
    const result = await request.get('/').set('Accept-Encoding', 'br')

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('br')
  })
})

describe.runIf(isV1)('useCompression with JSON body (h3 v1 app hook)', () => {
  // Regression test for #8: /server/api JSON responses are objects in the
  // `beforeResponse` hook, not strings, and were not compressed.
  it('compresses an object (JSON) body with gzip', async () => {
    const request = jsonAppWith(useCompression)
    const result = await request.get('/api').set('Accept-Encoding', 'gzip')

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('gzip')
    expect(result.headers['content-type']).toContain('application/json')
    expect(result.body).toEqual(json)
  })

  it('compresses an object (JSON) body with brotli', async () => {
    const request = jsonAppWith(useCompression)
    const result = await request
      .get('/api')
      .set('Accept-Encoding', 'br')
      .buffer(true)
      .parse(rawParser)

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('br')
    expect(result.headers['content-type']).toContain('application/json')
    expect(JSON.parse(zlib.brotliDecompressSync(result.body).toString())).toEqual(json)
  })
})

describe.runIf(isV1)('useCompressionStream (h3 v1 app hook)', () => {
  let request: SuperTest<Test>

  beforeEach(() => {
    request = appWith(useCompressionStream)
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
})
