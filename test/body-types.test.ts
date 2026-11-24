import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import zlib from 'node:zlib'
import * as h3 from 'h3'
import supertest from 'supertest'
import { describe, expect, it } from 'vitest'
import { compress, compressStream, useCompression, useCompressionStream } from '../src'
import { applyCompression } from '../src/runtime/nitro-plugin'
import { isV1, isV2 } from './_version'

// The hook path hands over whatever the handler returned. Only JSON-like
// values may be serialized; streams, blobs and responses must either be
// streamed as they are or left alone — never replaced by `[object Object]`,
// `1,2` or `{"_events":…}`.

const { createApp, eventHandler, mockEvent, toNodeListener } = h3 as typeof import('h3')

const json = {
  message: 'hello world',
  items: [1, 2, 3],
}
const text = 'Hello world! '.repeat(50)

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

function eventFor(encoding = 'gzip') {
  return mockEvent('/', {
    headers: { 'accept-encoding': encoding },
  })
}

describe.runIf(isV2)('stream path body types', () => {
  it.each([
    ['an object', json],
    [
      'an array',
      [1, 2, 3],
    ],
    ['a number', 42],
  ])('serializes %s as JSON', async (_name, body) => {
    const event = eventFor()
    const response: { body: unknown } = { body }

    await useCompressionStream(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(event.res.headers.get('content-type')).toEqual('application/json')
    expect(JSON.parse(zlib.gunzipSync(await readStream(response.body as ReadableStream)).toString())).toEqual(body)
  })

  it('streams a node stream', async () => {
    const event = eventFor()
    const response: { body: unknown } = {
      body: Readable.from([
        text.slice(0, 100),
        text.slice(100),
      ]),
    }

    await useCompressionStream(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(zlib.gunzipSync(await readStream(response.body as ReadableStream)).toString()).toEqual(text)
  })

  it('streams a blob', async () => {
    const event = eventFor()
    const response: { body: unknown } = {
      body: new Blob([text]),
    }

    await useCompressionStream(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(zlib.gunzipSync(await readStream(response.body as ReadableStream)).toString()).toEqual(text)
  })

  it('does not touch a node stream it does not compress', async () => {
    const event = eventFor('identity')
    const stream = Readable.from([text])
    const response: { body: unknown } = { body: stream }

    await compressStream(event, response, 'gzip')

    expect(response.body).toBe(stream)
    expect(stream.readableFlowing).toBeNull()
    expect(event.res.headers.get('content-encoding')).toBeNull()
  })

  it('leaves a Response body alone', async () => {
    const event = eventFor()
    const body = new Response(text)
    const response: { body: unknown } = { body }

    await useCompressionStream(event, response)

    expect(response.body).toBe(body)
    expect(event.res.headers.get('content-encoding')).toBeNull()
  })
})

describe.runIf(isV2)('buffered path body types', () => {
  it.each([
    [
      'a node stream',
      () => Readable.from([text]),
    ],
    [
      'a web stream',
      () => new Response(text).body,
    ],
    [
      'a blob',
      () => new Blob([text]),
    ],
    [
      'a Response',
      () => new Response(text),
    ],
    [
      'an error',
      () => new Error('boom'),
    ],
  ])('leaves %s alone instead of serializing it', async (_name, create) => {
    const event = eventFor()
    const body = create()
    const response: { body: unknown } = { body }

    await useCompression(event, response)

    expect(response.body).toBe(body)
    expect(event.res.headers.get('content-encoding')).toBeNull()
    expect(event.res.headers.get('vary')).toBeNull()
  })

  it('still serializes JSON bodies', async () => {
    const event = eventFor()
    const response: { body: unknown } = { body: json }

    await compress(event, response)

    expect(event.res.headers.get('content-type')).toEqual('application/json')
    expect(JSON.parse(zlib.gunzipSync(response.body as Buffer).toString())).toEqual(json)
  })
})

describe.runIf(isV1)('body types on the h3 v1 app hook', () => {
  function appWith(hook: (event: any, response: any) => unknown) {
    const app = createApp({ onBeforeResponse: hook })
    app.use('/api', eventHandler(() => json))
    app.use('/stream', eventHandler(() => Readable.from([text])))
    return supertest(toNodeListener(app))
  }

  it('the nuxt plugin in stream mode compresses a JSON api route', async () => {
    const result = await appWith((event, response) => applyCompression(event, response, { encoding: 'stream' }))
      .get('/api')
      .set('Accept-Encoding', 'gzip')

    expect(result.headers['content-encoding']).toEqual('gzip')
    expect(result.headers['content-type']).toContain('application/json')
    expect(result.body).toEqual(json)
  })

  it('useCompression leaves a node stream intact', async () => {
    const result = await appWith(useCompression).get('/stream').set('Accept-Encoding', 'gzip')

    expect(result.headers['content-encoding']).toBeUndefined()
    expect(result.text).toEqual(text)
  })

  it('useCompressionStream compresses a node stream', async () => {
    const result = await appWith(useCompressionStream).get('/stream').set('Accept-Encoding', 'gzip')

    expect(result.headers['content-encoding']).toEqual('gzip')
    expect(result.text).toEqual(text)
  })
})
