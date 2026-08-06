import { Buffer } from 'node:buffer'
import zlib from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import * as h3 from 'h3'
import {
  DEFAULT_CONTENT_TYPES,
  DEFAULT_EXCLUDE,
  applyCompression,
  createCompressionPlugin,
  getContentType,
  getPath,
  shouldCompress,
} from '../src/runtime/nitro-plugin'
import type { NuxtCompressionOptions } from '../src/runtime/types'
import { isV2 } from './_version'

// `mockEvent` only exists in h3 v2 — access it lazily so this file still loads
// (but is skipped) under h3 v1.
const { mockEvent } = h3 as typeof import('h3')

const html = '<h1>Hello World</h1>'.repeat(20)

function eventFor(path = '/', encoding = 'gzip') {
  return mockEvent(path, { headers: { 'accept-encoding': encoding } })
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

describe.runIf(isV2)('nuxt plugin — path handling (#22)', () => {
  it('reads the pathname from the h3 v2 url object', () => {
    expect(getPath(eventFor('/api/items?page=2'))).toEqual('/api/items')
  })

  it('falls back to the h3 v1 `path` property', () => {
    const v1Event = { path: '/legacy/route?x=1' } as any

    expect(getPath(v1Event)).toEqual('/legacy/route')
  })

  it('prefers the untouched originalUrl over a prefix-stripped path (#22)', () => {
    // h3 v1 rewrites `event.path` to the remainder for prefix-mounted
    // handlers, which would defeat the `/_nuxt` exclusion.
    const v1Event = { path: '/', node: { req: { originalUrl: '/_nuxt/entry.js?v=1' } } } as any

    expect(getPath(v1Event)).toEqual('/_nuxt/entry.js')
    expect(shouldCompress(v1Event, {}, {})).toBe(false)
  })

  it('degrades to "/" when neither is present', () => {
    expect(getPath({} as any)).toEqual('/')
  })
})

describe.runIf(isV2)('nuxt plugin — content type handling (#22)', () => {
  it('prefers the header record handed over by the hook', () => {
    const event = eventFor()

    expect(getContentType(event, { headers: { 'content-type': 'text/html' } })).toEqual('text/html')
  })

  it('accepts the capitalised header key nitro sometimes uses', () => {
    const event = eventFor()

    expect(getContentType(event, { headers: { 'Content-Type': 'application/json' } })).toEqual('application/json')
  })

  it('falls back to the response headers already set on the event', () => {
    const event = eventFor()
    event.res.headers.set('content-type', 'text/plain')

    expect(getContentType(event, {})).toEqual('text/plain')
  })
})

describe.runIf(isV2)('nuxt plugin — shouldCompress (#22)', () => {
  it('skips nuxt internal routes by default', () => {
    for (const path of DEFAULT_EXCLUDE) {
      const event = eventFor(`${path}/entry.js`)

      expect(shouldCompress(event, { headers: { 'content-type': 'text/javascript' } }, {})).toBe(false)
    }
  })

  it('compresses a normal html route', () => {
    const event = eventFor('/about')

    expect(shouldCompress(event, { headers: { 'content-type': 'text/html' } }, {})).toBe(true)
  })

  it('skips content types outside the allow list', () => {
    const event = eventFor('/logo.png')

    expect(shouldCompress(event, { headers: { 'content-type': 'image/png' } }, {})).toBe(false)
  })

  it('covers every default content type', () => {
    for (const type of DEFAULT_CONTENT_TYPES) {
      const event = eventFor('/x')

      expect(shouldCompress(event, { headers: { 'content-type': type } }, {})).toBe(true)
    }
  })

  it('treats a missing content type as compressible (object body → JSON)', () => {
    const event = eventFor('/api/items')

    expect(shouldCompress(event, {}, {})).toBe(true)
  })

  it('compresses every content type when the list is emptied', () => {
    const event = eventFor('/logo.png')

    expect(shouldCompress(event, { headers: { 'content-type': 'image/png' } }, { contentTypes: [] })).toBe(true)
  })

  it('honours a custom exclude list instead of the defaults', () => {
    const options: NuxtCompressionOptions = { exclude: ['/private'] }

    expect(shouldCompress(eventFor('/private/x'), {}, options)).toBe(false)
    // The defaults no longer apply once overridden.
    expect(shouldCompress(eventFor('/_nuxt/x'), {}, options)).toBe(true)
  })

  it('returns false when disabled', () => {
    expect(shouldCompress(eventFor('/about'), {}, { enabled: false })).toBe(false)
  })
})

describe.runIf(isV2)('nuxt plugin — applyCompression (#22)', () => {
  it('compresses an allowed response with the negotiated encoding', async () => {
    const event = eventFor('/about')
    const response: { body: unknown; headers: Record<string, string> } = {
      body: html,
      headers: { 'content-type': 'text/html' },
    }

    await applyCompression(event, response, {})

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(zlib.gunzipSync(response.body as Buffer).toString()).toEqual(html)
  })

  it('leaves an excluded response untouched', async () => {
    const event = eventFor('/_nuxt/entry.js')
    const response: { body: unknown; headers: Record<string, string> } = {
      body: html,
      headers: { 'content-type': 'text/javascript' },
    }

    await applyCompression(event, response, {})

    expect(event.res.headers.get('content-encoding')).toBeNull()
    expect(response.body).toEqual(html)
  })

  it('skips bodies below the threshold', async () => {
    const event = eventFor('/about')
    const response: { body: unknown; headers: Record<string, string> } = {
      body: 'tiny',
      headers: { 'content-type': 'text/html' },
    }

    await applyCompression(event, response, { threshold: 1024 })

    expect(event.res.headers.get('content-encoding')).toBeNull()
    expect(response.body).toEqual('tiny')
  })

  it('compresses bodies at or above the threshold', async () => {
    const event = eventFor('/about')
    const response: { body: unknown; headers: Record<string, string> } = {
      body: html,
      headers: { 'content-type': 'text/html' },
    }

    await applyCompression(event, response, { threshold: 8 })

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(zlib.gunzipSync(response.body as Buffer).toString()).toEqual(html)
  })

  it('uses the stream path when encoding is "stream"', async () => {
    const event = eventFor('/about')
    const response: { body: unknown; headers: Record<string, string> } = {
      body: html,
      headers: { 'content-type': 'text/html' },
    }

    await applyCompression(event, response, { encoding: 'stream' })

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(zlib.gunzipSync(await readStream(response.body as ReadableStream)).toString()).toEqual(html)
  })

  it('picks brotli on the stream path only when enabled', async () => {
    const withoutFlag = eventFor('/about', 'br, gzip')
    await applyCompression(withoutFlag, { body: html, headers: { 'content-type': 'text/html' } }, { encoding: 'stream' })
    expect(withoutFlag.res.headers.get('content-encoding')).toEqual('gzip')

    const withFlag = eventFor('/about', 'br, gzip')
    const response: { body: unknown } = { body: html }
    await applyCompression(withFlag, { ...response, headers: { 'content-type': 'text/html' } }, { encoding: 'stream', brotli: true })
    expect(withFlag.res.headers.get('content-encoding')).toEqual('br')
  })

  it('honours a forced method over negotiation', async () => {
    const event = eventFor('/about', 'gzip, deflate')
    const response: { body: unknown; headers: Record<string, string> } = {
      body: html,
      headers: { 'content-type': 'text/html' },
    }

    await applyCompression(event, response, { method: 'deflate' })

    expect(event.res.headers.get('content-encoding')).toEqual('deflate')
    expect(zlib.inflateSync(response.body as Buffer).toString()).toEqual(html)
  })
})

describe.runIf(isV2)('nuxt plugin — hook wiring (#22)', () => {
  function fakeNitro() {
    const hooks: Record<string, (...args: any[]) => unknown> = {}
    return {
      hooks: { hook: vi.fn((name: string, fn: any) => { hooks[name] = fn }) },
      registered: hooks,
    }
  }

  it('attaches to both hooks by default', () => {
    const nitro = fakeNitro()

    createCompressionPlugin({})(nitro)

    expect(Object.keys(nitro.registered).sort()).toEqual(['beforeResponse', 'render:response'])
  })

  it('skips beforeResponse when routeRules is off', () => {
    const nitro = fakeNitro()

    createCompressionPlugin({ routeRules: false })(nitro)

    expect(Object.keys(nitro.registered)).toEqual(['render:response'])
  })

  it('registers nothing when disabled', () => {
    const nitro = fakeNitro()

    createCompressionPlugin({ enabled: false })(nitro)

    expect(nitro.hooks.hook).not.toHaveBeenCalled()
  })

  it('compresses through the render:response hook', async () => {
    const nitro = fakeNitro()
    createCompressionPlugin({})(nitro)

    const event = eventFor('/about')
    const response: { body: unknown; headers: Record<string, string> } = {
      body: html,
      headers: { 'content-type': 'text/html' },
    }

    await nitro.registered['render:response'](response, { event })

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(zlib.gunzipSync(response.body as Buffer).toString()).toEqual(html)
  })

  it('compresses through the beforeResponse hook (cached routes, /server/api)', async () => {
    const nitro = fakeNitro()
    createCompressionPlugin({})(nitro)

    const event = eventFor('/api/items')
    const response: { body: unknown } = { body: { items: [1, 2, 3], message: html } }

    await nitro.registered.beforeResponse(event, response)

    expect(event.res.headers.get('content-encoding')).toEqual('gzip')
    expect(JSON.parse(zlib.gunzipSync(response.body as Buffer).toString())).toEqual({ items: [1, 2, 3], message: html })
  })
})
