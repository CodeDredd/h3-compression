import * as h3 from 'h3'

// h3 v2 added `toResponse` and removed the v1-only `send` util.
export const isV2 = typeof (h3 as { toResponse?: unknown }).toResponse === 'function'
export const isV1 = !isV2
