import type { SuperTest, Test } from 'supertest'
import supertest from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { H3, toNodeHandler } from 'h3'
import { compression, compressionStream } from '../src'

const html = '<h1>Hello World</h1>'

describe('compression middleware (h3 v2)', () => {
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

describe('compressionStream middleware (h3 v2)', () => {
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

  it('falls back to gzip when brotli is the only listed but unsupported by streams', async () => {
    const result = await request.get('/').set('Accept-Encoding', 'br, gzip')

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('gzip')
    expect(result.text).toEqual(html)
  })
})
