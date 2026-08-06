// A `/server/api` route: goes through nitro's `beforeResponse` hook, not
// `render:response`. The module wires both, so this gets compressed too.
export default defineEventHandler(() => ({
  items: Array.from({ length: 50 }, (_, i) => ({ id: i, name: `Item ${i}` })),
}))
