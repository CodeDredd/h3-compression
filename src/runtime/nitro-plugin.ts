import type { H3Event } from 'h3'

// Self-referencing import rather than `../helper`: this file is shipped as a
// standalone module under `dist/runtime/`, where a relative path out of the
// directory would not resolve against the bundled `dist/index.mjs`.
import type { Compression, RenderResponse, StreamCompression } from 'h3-compression'
import { compress, compressStream, getAnyCompression, getStreamCompression } from 'h3-compression'
import type { NuxtCompressionOptions } from './types'

/**
 * The subset of the Nitro app this plugin touches. Typed structurally so the
 * runtime carries no Nitro import — `defineNitroPlugin` is an identity
 * function whose import path has moved between Nitro majors, and the plugin
 * contract is just "default-export a function taking the nitro app".
 */
export interface NitroAppLike {
  hooks: {
    hook: (name: string, handler: (...args: any[]) => unknown) => unknown
  }
}

/**
 * Nitro passes the event as the second element for `render:response` and as
 * the first for `beforeResponse`, so both hooks are normalised before use.
 */
export type HookResponse = Partial<RenderResponse> & { headers?: Record<string, any> }

export const DEFAULT_CONTENT_TYPES = [
  'text/',
  'application/json',
  'application/javascript',
  'application/xml',
  'image/svg+xml',
]

export const DEFAULT_EXCLUDE = ['/_nuxt', '/__nuxt']

/**
 * Resolves the request path the exclusion list is matched against.
 *
 * h3 v2 exposes `event.url` (a `URL`) and keeps `path` only as a deprecated
 * getter, so that is read first. On h3 v1 a prefix-mounted handler
 * (`app.use('/prefix', handler)`) rewrites `event.path` to the *remainder*,
 * which would silently defeat prefix exclusions — the node adapter keeps the
 * untouched path on `req.originalUrl`, so prefer that when it is there.
 * @param { H3Event } event - A H3 event object.
 * @returns { string }
 */
export function getPath(event: H3Event): string {
  const url = (event as unknown as { url?: URL }).url
  if (url && typeof url === 'object' && typeof url.pathname === 'string')
    return url.pathname

  const originalUrl = (event as unknown as { node?: { req?: { originalUrl?: string } } })
    .node?.req?.originalUrl
  if (typeof originalUrl === 'string')
    return originalUrl.split('?')[0]

  const path = (event as unknown as { path?: string }).path
  return typeof path === 'string' ? path.split('?')[0] : '/'
}

/**
 * Reads the response content type from whichever shape the hook provided.
 * `render:response` carries a plain header record, `beforeResponse` may carry
 * none at all — in which case the already-set response headers are used.
 * @param { H3Event } event - A H3 event object.
 * @param { HookResponse } response - The response object handed over by the hook.
 * @returns { string }
 */
export function getContentType(event: H3Event, response: HookResponse): string {
  const headers = response.headers
  if (headers) {
    const direct = headers['content-type'] ?? headers['Content-Type']
    if (typeof direct === 'string')
      return direct
  }

  const resHeaders = (event as unknown as { res?: { headers?: Headers } }).res?.headers
  return resHeaders?.get?.('content-type') ?? ''
}

/**
 * Decides whether a response should be compressed at all. Exported so the
 * filtering can be tested without booting Nitro.
 * @param { H3Event } event - A H3 event object.
 * @param { HookResponse } response - The response object handed over by the hook.
 * @param { NuxtCompressionOptions } options - The resolved module options.
 * @returns { boolean }
 */
export function shouldCompress(
  event: H3Event,
  response: HookResponse,
  options: NuxtCompressionOptions,
): boolean {
  if (options.enabled === false)
    return false

  const exclude = options.exclude ?? DEFAULT_EXCLUDE
  const path = getPath(event)
  if (exclude.some(prefix => path.startsWith(prefix)))
    return false

  const contentTypes = options.contentTypes ?? DEFAULT_CONTENT_TYPES
  if (contentTypes.length === 0)
    return true

  const contentType = getContentType(event, response)
  // An unset content type means the handler returned a plain object, which
  // h3 serializes as JSON — compressible, so don't filter it out.
  if (!contentType)
    return true

  return contentTypes.some(type => contentType.startsWith(type))
}

/**
 * Runs the configured compression against one hook payload.
 * @param { H3Event } event - A H3 event object.
 * @param { HookResponse } response - The response object handed over by the hook.
 * @param { NuxtCompressionOptions } options - The resolved module options.
 * @returns { Promise<void> }
 */
export async function applyCompression(
  event: H3Event,
  response: HookResponse,
  options: NuxtCompressionOptions,
): Promise<void> {
  if (!shouldCompress(event, response, options))
    return

  if (options.encoding === 'stream') {
    const method = (options.method as StreamCompression | undefined)
      ?? getStreamCompression(event, { brotli: options.brotli, zstd: options.zstd })

    if (method)
      await compressStream(event, response, method)

    return
  }

  const method = (options.method as Compression | undefined)
    ?? getAnyCompression(event, { zstd: options.zstd })

  if (method)
    await compress(event, response, method, { minSize: options.threshold })
}

/**
 * Builds the Nitro plugin. The Nuxt module generates a one-line file that
 * calls this with the resolved options, so nothing has to be read from
 * auto-imported globals or virtual modules at runtime.
 * @param { NuxtCompressionOptions } options - The resolved module options.
 * @returns { (nitro: NitroAppLike) => void }
 */
export function createCompressionPlugin(options: NuxtCompressionOptions) {
  return (nitro: NitroAppLike): void => {
    if (options.enabled === false)
      return

    // Freshly rendered SSR pages.
    nitro.hooks.hook('render:response', async (response: HookResponse, context: { event: H3Event }) => {
      await applyCompression(context.event, response, options)
    })

    // Cached (swr / isr) routes and `/server/api` handlers never reach
    // `render:response` — they go through `beforeResponse` instead.
    if (options.routeRules !== false) {
      nitro.hooks.hook('beforeResponse', async (event: H3Event, response: HookResponse) => {
        await applyCompression(event, response, options)
      })
    }
  }
}
