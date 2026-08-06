// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },

  modules: ['h3-compression/nuxt'],

  compression: {
    // Defaults shown for illustration — none of these are required.
    encoding: 'zlib',
    threshold: 1024,
  },
})
