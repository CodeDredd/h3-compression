import type { SuperTest, Test } from 'supertest'
import supertest from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import type { App } from 'h3'
import { createApp, eventHandler, toNodeListener } from 'h3'
import { useCompression } from '../src'

describe('use compression', () => {
  let app: App
  let request: SuperTest<Test>

  beforeEach(() => {
    app = createApp({ debug: true, onBeforeResponse: useCompression })
    app.use('/', eventHandler({
      handler: () => {
        return '<h1>Hello World</h1>'
      },
    }))
    request = supertest(toNodeListener(app))
  })

  it('returns 200 OK with gzip compression', async () => {
    const result = await request
      .get('/')
      .set('Accept-Encoding', 'gzip')

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('gzip')
  })

  it('returns 200 OK with deflate compression', async () => {
    const result = await request
      .get('/')
      .set('Accept-Encoding', 'deflate')

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('deflate')
  })

  it('returns 200 OK with brotli compression', async () => {
    const result = await request
      .get('/')
      .set('Accept-Encoding', 'br')

    expect(result.status).toEqual(200)
    expect(result.headers['content-encoding']).toEqual('br')
  })
})
